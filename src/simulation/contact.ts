import type { Config, Field, ModalResult, Run } from '../experiment/types';
import { configKey, particleGroup } from '../experiment/config';
import { responseField, sampleGrid } from '../solver/response';
interface Initial {
  positions: number[];
  diameters: number[];
  species: number[];
  masses: number[];
}
type Vec3 = [number, number, number];
const G = 9.80665;
/** Only integration quality changes; the directly integrated count is never silently reduced. */
export function contactBudget(c: Config, periodSamples = 32) {
  if (![32, 64, 128].includes(periodSamples))
    throw Error('접촉 적분은 주기당 32·64·128 표본을 사용하세요.');
  const frequency =
    c.drive.signal === 'sweep' ? Math.max(c.drive.start, c.drive.end) : c.drive.frequency;
  const dt = Math.min(1 / 480, 1 / (periodSamples * frequency)),
    steps = Math.ceil(c.drive.duration / dt);
  return {
    dt: c.drive.duration / steps,
    steps,
    limit: Math.min(2000, Math.floor(20_000_000 / steps)),
  };
}
/** Per-unit-mass impulse for a solid sphere; normal restitution and Coulomb-limited contact slip.
 * Dissipation is measured in the instantaneous plate rest frame, including tangential friction.
 */
export function impact(
  v: Vec3,
  omega: Vec3,
  normal: Vec3,
  plateVelocity: number,
  radius: number,
  restitution: number,
  mu: number,
) {
  const length = Math.hypot(...normal);
  if (
    ![...v, ...omega, ...normal, plateVelocity, radius, restitution, mu].every(Number.isFinite) ||
    radius <= 0 ||
    length < 1e-12 ||
    restitution < 0 ||
    restitution > 1 ||
    mu < 0
  )
    throw Error('접촉 충격의 반지름·법선·반발·마찰 조건을 확인하세요.');
  const n = normal.map((q) => q / length) as Vec3,
    rel: Vec3 = [v[0], v[1] - plateVelocity, v[2]],
    vn = rel[0] * n[0] + rel[1] * n[1] + rel[2] * n[2];
  if (vn >= 0) return { v, omega, dissipation: 0 };
  const jn = -(1 + restitution) * vn,
    r: Vec3 = [-radius * n[0], -radius * n[1], -radius * n[2]];
  const slip = [
    rel[0] - vn * n[0] + omega[1] * r[2] - omega[2] * r[1],
    rel[1] - vn * n[1] + omega[2] * r[0] - omega[0] * r[2],
    rel[2] - vn * n[2] + omega[0] * r[1] - omega[1] * r[0],
  ];
  const speed = Math.hypot(...slip),
    jt = Math.min((speed * 2) / 7, mu * jn),
    s = speed > 1e-15 ? -jt / speed : 0,
    j = [slip[0] * s, slip[1] * s, slip[2] * s],
    out = v.map((q, i) => q + jn * n[i] + j[i]) as Vec3,
    inertia = 0.4 * radius * radius,
    spin: Vec3 = [
      omega[0] + (r[1] * j[2] - r[2] * j[1]) / inertia,
      omega[1] + (r[2] * j[0] - r[0] * j[2]) / inertia,
      omega[2] + (r[0] * j[1] - r[1] * j[0]) / inertia,
    ];
  const energy = (velocity: Vec3, angular: Vec3) =>
    0.5 * (velocity[0] ** 2 + (velocity[1] - plateVelocity) ** 2 + velocity[2] ** 2) +
    0.5 * inertia * angular.reduce((sum, x) => sum + x * x, 0);
  return { v: out, omega: spin, dissipation: Math.max(0, energy(v, omega) - energy(out, spin)) };
}
export function simulateContact(
  c: Config,
  modal: ModalResult,
  initial: Initial,
  progress: (v: number) => void,
): Run {
  const budget = contactBudget(c);
  if (c.grains.count > budget.limit)
    throw Error(
      `접촉 해석은 현재 조건에서 ${budget.limit.toLocaleString()}개 이하를 사용하세요. 1주기 32회 적분·계산량 제한입니다.`,
    );
  const fields = Array.from({ length: c.drive.signal === 'sweep' ? 33 : 1 }, (_, i) =>
    responseField(
      modal,
      c,
      c.drive.signal === 'sweep'
        ? c.drive.start + ((c.drive.end - c.drive.start) * i) / 32
        : c.drive.frequency,
      25,
    ),
  );
  return integrateContactFields(c, fields, initial, progress);
}
/** Prescribed-field entry supports analytic numerical benchmarks. The UI only passes actual FEM fields.
 * 3D sphere contact, independent grains, no rolling resistance or resolved airflow/particle interactions.
 */
export function integrateContactFields(
  c: Config,
  fields: Field[],
  initial: Initial,
  progress: (v: number) => void = () => {},
  periodSamples = 32,
): Run {
  const begin = performance.now(),
    budget = contactBudget(c, periodSamples),
    count = c.grains.count;
  if (count > budget.limit)
    throw Error(
      `접촉 해석은 현재 조건에서 ${budget.limit.toLocaleString()}개 이하를 사용하세요. 1주기 ${periodSamples}회 적분·계산량 제한입니다.`,
    );
  if (
    !fields.length ||
    fields.some(
      (f) =>
        f.size !== fields[0].size ||
        f.size < 2 ||
        f.size > 100 ||
        !Number.isFinite(f.frequency) ||
        f.frequency < 0 ||
        [f.real, f.imag, f.amplitude].some(
          (a) => a.length !== f.size ** 2 || !a.every(Number.isFinite),
        ),
    )
  )
    throw Error('접촉 해석의 진동장을 확인하세요.');
  if (
    initial.positions.length !== count * 2 ||
    [initial.diameters, initial.species, initial.masses].some((a) => a.length !== count) ||
    initial.positions.some((x) => !Number.isFinite(x) || x < 0 || x > 1) ||
    initial.diameters.some((d) => !Number.isFinite(d) || d <= 0) ||
    initial.masses.some((m) => !Number.isFinite(m) || m <= 0) ||
    initial.species.some((s) => s !== 0 && s !== 1)
  )
    throw Error('접촉 해석의 초기 입자 자료를 확인하세요.');
  const dt = budget.dt,
    steps = budget.steps,
    size = fields[0].size,
    cells = size * size,
    positions = Float64Array.from(initial.positions),
    height = new Float64Array(count),
    vx = new Float64Array(count),
    vy = new Float64Array(count),
    vz = new Float64Array(count),
    wx = new Float64Array(count),
    wy = new Float64Array(count),
    wz = new Float64Array(count),
    distance = new Float64Array(count),
    gap = new Float64Array(count),
    peakGap = new Float64Array(count),
    real = new Float64Array(cells),
    imag = new Float64Array(cells),
    realRate = new Float64Array(cells),
    imagRate = new Float64Array(cells);
  const stride = Math.max(
    1,
    Math.ceil(1 / (120 * dt)),
    Math.ceil((steps * count * 4 * 4) / (96 * 1024 * 1024)),
  );
  let impacts = 0,
    energyDissipated = 0,
    maxPenetration = 0,
    maxGamma = 0;
  const updateField = (fraction: number) => {
    const index = fraction * (fields.length - 1),
      a = fields[Math.floor(index)],
      b = fields[Math.min(fields.length - 1, Math.floor(index) + 1)],
      blend = index % 1,
      rate = a === b ? 0 : (fields.length - 1) / c.drive.duration;
    for (let j = 0; j < cells; j++) {
      real[j] = a.real[j] + (b.real[j] - a.real[j]) * blend;
      imag[j] = a.imag[j] + (b.imag[j] - a.imag[j]) * blend;
      realRate[j] = (b.real[j] - a.real[j]) * rate;
      imagRate[j] = (b.imag[j] - a.imag[j]) * rate;
    }
    return a.frequency + (b.frequency - a.frequency) * blend;
  };
  const surface = (x: number, z: number, cos: number, sin: number) =>
    sampleGrid(real, size, x, z) * cos - sampleGrid(imag, size, x, z) * sin;
  const normal = (x: number, z: number, cos: number, sin: number): Vec3 => {
    const delta = 0.005,
      xa = Math.max(0, x - delta),
      xb = Math.min(1, x + delta),
      za = Math.max(0, z - delta),
      zb = Math.min(1, z + delta),
      sx = (surface(xb, z, cos, sin) - surface(xa, z, cos, sin)) / ((xb - xa) * c.plate.width),
      sz = (surface(x, zb, cos, sin) - surface(x, za, cos, sin)) / ((zb - za) * c.plate.height),
      norm = Math.hypot(sx, 1, sz);
    return [-sx / norm, 1 / norm, -sz / norm];
  };
  const firstFrequency = updateField(0);
  for (let i = 0; i < count; i++)
    height[i] =
      surface(positions[i * 2], positions[i * 2 + 1], 1, 0) +
      initial.diameters[i] / (2 * normal(positions[i * 2], positions[i * 2 + 1], 1, 0)[1]);
  const frames: Run['frames'] = [
    {
      time: 0,
      positions: Float32Array.from(positions),
      distance: Float32Array.from(distance),
      heights: new Float32Array(count),
    },
  ];
  if (fields.length === 1)
    for (let j = 0; j < cells; j++)
      maxGamma = Math.max(
        maxGamma,
        ((2 * Math.PI * firstFrequency) ** 2 * Math.hypot(real[j], imag[j])) / G,
      );
  for (let step = 1; step <= steps; step++) {
    const t = step * dt,
      f = fields.length > 1 ? updateField(step / steps) : firstFrequency,
      w = 2 * Math.PI * f,
      phase =
        2 *
        Math.PI *
        (c.drive.signal === 'sweep'
          ? c.drive.start * t + (0.5 * (c.drive.end - c.drive.start) * t * t) / c.drive.duration
          : f * t),
      cos = Math.cos(phase),
      sin = Math.sin(phase);
    if (fields.length > 1) {
      const wRate = (2 * Math.PI * (c.drive.end - c.drive.start)) / c.drive.duration;
      for (let j = 0; j < cells; j++)
        maxGamma = Math.max(
          maxGamma,
          Math.abs(
            -w * w * (real[j] * cos - imag[j] * sin) -
              2 * w * (realRate[j] * sin + imagRate[j] * cos) -
              wRate * (real[j] * sin + imag[j] * cos),
          ) / G,
        );
    }
    for (let i = 0; i < count; i++) {
      const group = particleGroup(c.grains, initial.species[i] as 0 | 1),
        r = initial.diameters[i] / 2,
        oldX = positions[i * 2],
        oldZ = positions[i * 2 + 1],
        drag = c.grains.stillAirDrag
          ? Math.exp(
              -dt /
                Math.max(
                  1e-8,
                  (group.density * initial.diameters[i] ** 2 * group.shape) / (18 * 1.81e-5),
                ),
            )
          : 1;
      vx[i] *= drag;
      vz[i] *= drag;
      vy[i] = vy[i] * drag - G * dt;
      let x = oldX + (vx[i] * dt) / c.plate.width,
        z = oldZ + (vz[i] * dt) / c.plate.height;
      const rx = r / c.plate.width,
        rz = r / c.plate.height;
      if (x < rx || x > 1 - rx) {
        x = Math.max(rx, Math.min(1 - rx, x));
        vx[i] *= -0.2;
      }
      if (z < rz || z > 1 - rz) {
        z = Math.max(rz, Math.min(1 - rz, z));
        vz[i] *= -0.2;
      }
      height[i] += vy[i] * dt;
      const h = surface(x, z, cos, sin),
        n = normal(x, z, cos, sin),
        surfaceY = h + r / n[1],
        penetration = surfaceY - height[i];
      if (penetration > 0) {
        maxPenetration = Math.max(maxPenetration, penetration);
        height[i] = surfaceY;
        const plateV =
            -w * (sampleGrid(real, size, x, z) * sin + sampleGrid(imag, size, x, z) * cos) +
            sampleGrid(realRate, size, x, z) * cos -
            sampleGrid(imagRate, size, x, z) * sin,
          relative = vx[i] * n[0] + (vy[i] - plateV) * n[1] + vz[i] * n[2],
          bounce = relative < -Math.max(0.001, 2 * G * dt),
          e = bounce ? (group.restitution ?? 0.4) : 0,
          result = impact(
            [vx[i], vy[i], vz[i]],
            [wx[i], wy[i], wz[i]],
            n,
            plateV,
            r,
            e,
            group.friction,
          );
        [vx[i], vy[i], vz[i]] = result.v;
        [wx[i], wy[i], wz[i]] = result.omega;
        if (bounce) impacts++;
        energyDissipated += result.dissipation * initial.masses[i];
      }
      gap[i] = Math.max(0, height[i] - surfaceY);
      peakGap[i] = Math.max(peakGap[i], gap[i]);
      positions[i * 2] = x;
      positions[i * 2 + 1] = z;
      distance[i] += Math.hypot((x - oldX) * c.plate.width, (z - oldZ) * c.plate.height);
    }
    if (step % stride === 0 || step === steps)
      frames.push({
        time: t,
        positions: Float32Array.from(positions),
        distance: Float32Array.from(distance),
        heights: Float32Array.from(gap),
      });
    if (step % Math.max(1, Math.floor(steps / 100)) === 0) progress(step / steps);
  }
  const movingCount = distance.reduce((n, d, i) => n + (d > 1e-7 || peakGap[i] > 1e-7 ? 1 : 0), 0);
  return {
    source: 'approximation',
    model: 'impact-contact',
    key: configKey(c),
    config: structuredClone(c),
    fields,
    frames,
    diameters: initial.diameters,
    species: initial.species,
    masses: initial.masses,
    lost: 0,
    dt,
    recordHz: 1 / (stride * dt),
    precision: 'float32',
    elapsedMs: performance.now() - begin,
    diagnostics: {
      impacts,
      energyDissipated,
      particleInteractions: false,
      stillAirDrag: !!c.grains.stillAirDrag,
      maxPenetration,
      substeps: steps,
    },
    motion: {
      state:
        (c.drive.kind === 'base' ? c.drive.displacement : c.drive.force) === 0
          ? 'undriven'
          : movingCount
            ? 'moving'
            : 'stationary',
      maxGamma,
      movingCount,
      maxDistance: distance.reduce((m, d) => Math.max(m, d), 0),
      totalMass: initial.masses.reduce((a, b) => a + b, 0),
    },
  };
}
