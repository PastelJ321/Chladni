import { seededRandom } from '../concept/physics';
import type { Config, Field, GrainFrame, ModalResult, Run } from '../experiment/types';
import { configKey, particleGroup } from '../experiment/config';
import { responseField, sampleGrid } from '../solver/response';
import { numberRatio, pendingParticles } from '../particles/presets';
import { simulateContact } from './contact';
export function initialParticles(c: Config) {
  const g = c.grains,
    rand = seededRandom(g.seed),
    positions: number[] = [],
    species: number[] = [],
    diameters: number[] = [],
    masses: number[] = [];
  const ratio = numberRatio(g);
  for (let i = 0; i < g.count; i++) {
    const salt = g.kind === 'salt' || (g.kind === 'mixture' && rand() < ratio);
    species.push(salt ? 1 : 0);
    const group = particleGroup(g, salt ? 1 : 0);
    const diameter = group.diameter * (1 + group.spread * (2 * rand() - 1));
    diameters.push(diameter);
    masses.push((group.density * Math.PI * diameter ** 3) / 6);
    let x = rand(),
      y = rand();
    if (g.distribution !== 'uniform') {
      const spot =
        g.distribution === 'paint' && g.spots.length ? g.spots[i % g.spots.length] : [0.5, 0.5];
      const angle = rand() * 2 * Math.PI,
        r = Math.sqrt(rand()) * 0.06;
      x = spot[0] + Math.cos(angle) * r;
      y = spot[1] + Math.sin(angle) * r;
    }
    const marginX = Math.max(0.005, diameter / (2 * c.plate.width)),
      marginY = Math.max(0.005, diameter / (2 * c.plate.height));
    positions.push(
      Math.max(marginX, Math.min(1 - marginX, x)),
      Math.max(marginY, Math.min(1 - marginY, y)),
    );
  }
  return { positions, species, diameters, masses };
}
export function simulateParticles(
  c: Config,
  modal: ModalResult,
  progress: (v: number) => void = () => {},
): Run {
  if (pendingParticles(c.grains)) throw Error('선택한 입자의 평균 입경과 입자 밀도를 입력하세요.');
  if (c.grains.model === 'contact') return simulateContact(c, modal, initialParticles(c), progress);
  const start = performance.now(),
    initial = initialParticles(c),
    g = c.grains,
    groups = [particleGroup(c.grains, 0), particleGroup(c.grains, 1)],
    dt = 1 / 120;
  const positions = Float64Array.from(initial.positions),
    vx = new Float64Array(g.count),
    vy = new Float64Array(g.count),
    distance = new Float64Array(g.count),
    rand = seededRandom(g.seed ^ 0xa731);
  // Quasi-steady harmonic fields; a sweep interpolates 33 frequency states.
  const fields: Field[] = Array.from({ length: c.drive.signal === 'sweep' ? 33 : 1 }, (_, i) =>
    responseField(
      modal,
      c,
      c.drive.signal === 'sweep'
        ? c.drive.start + ((c.drive.end - c.drive.start) * i) / 32
        : c.drive.frequency,
      25,
    ),
  );
  const energyGrid = new Float64Array(625);
  const frames: GrainFrame[] = [
    { time: 0, positions: Float32Array.from(positions), distance: Float32Array.from(distance) },
  ];
  const steps = Math.round(c.drive.duration / dt);
  // 96 MiB recording budget; integration accuracy is unchanged. Actual recording rate is stored.
  const stride = Math.max(6, Math.ceil((steps * g.count * 3 * 4) / (96 * 1024 * 1024)));
  let maxGamma = 0;
  for (let step = 1; step <= steps; step++) {
    const fieldIndex = (step / steps) * (fields.length - 1),
      lo = Math.floor(fieldIndex),
      hi = Math.min(fields.length - 1, lo + 1),
      blend = fieldIndex - lo;
    const a = fields[lo],
      b = fields[hi],
      frequency = a.frequency + (b.frequency - a.frequency) * blend;
    const factor = (2 * Math.PI * frequency) ** 4 / 9.80665 ** 2;
    for (let j = 0; j < 625; j++) {
      const re = a.real[j] + (b.real[j] - a.real[j]) * blend,
        im = a.imag[j] + (b.imag[j] - a.imag[j]) * blend;
      energyGrid[j] = (re * re + im * im) * factor;
      maxGamma = Math.max(maxGamma, Math.sqrt(energyGrid[j]));
    }
    const sample = (x: number, y: number) => sampleGrid(energyGrid, 25, x, y);
    for (let i = 0; i < g.count; i++) {
      const x = positions[i * 2],
        y = positions[i * 2 + 1],
        h = 0.008,
        energy = sample(x, y),
        gate = Math.max(0, Math.sqrt(energy) - 1) / (1 + Math.sqrt(energy));
      const gradX = (sample(x + h, y) - sample(x - h, y)) / (2 * h * c.plate.width),
        gradY = (sample(x, y + h) - sample(x, y - h)) / (2 * h * c.plate.height);
      const group = groups[initial.species[i]];
      const mobility =
        (((g.transport * initial.diameters[i] ** 2) / (group.friction + 0.1)) * gate) / group.shape;
      let tx = -mobility * gradX,
        ty = -mobility * gradY;
      const speed = Math.hypot(tx, ty);
      if (speed > 0.03) {
        tx *= 0.03 / speed;
        ty *= 0.03 / speed;
      }
      // Stokes relaxation only: density enters drag/inertia, not a fictitious dry segregation law.
      const rho = group.density,
        tau = ((rho * initial.diameters[i] ** 2) / (18 * 1.81e-5)) * group.shape;
      const relaxation = 1 - Math.exp(-dt / Math.max(0.005, tau));
      vx[i] += (tx - vx[i]) * relaxation;
      vy[i] += (ty - vy[i]) * relaxation;
      const jitter = initial.diameters[i] * gate * 0.06 * Math.sqrt(dt);
      let nx = x + (vx[i] * dt + (rand() - 0.5) * jitter) / c.plate.width,
        ny = y + (vy[i] * dt + (rand() - 0.5) * jitter) / c.plate.height;
      const rx = initial.diameters[i] / (2 * c.plate.width),
        ry = initial.diameters[i] / (2 * c.plate.height);
      if (nx < rx || nx > 1 - rx) {
        vx[i] *= -0.2;
        nx = Math.max(rx, Math.min(1 - rx, nx));
      }
      if (ny < ry || ny > 1 - ry) {
        vy[i] *= -0.2;
        ny = Math.max(ry, Math.min(1 - ry, ny));
      }
      distance[i] += Math.hypot((nx - x) * c.plate.width, (ny - y) * c.plate.height);
      positions[i * 2] = nx;
      positions[i * 2 + 1] = ny;
    }
    if (step % stride === 0 || step === steps)
      frames.push({
        time: step * dt,
        positions: Float32Array.from(positions),
        distance: Float32Array.from(distance),
      });
    if (step % 48 === 0) progress(step / steps);
  }
  return {
    source: 'approximation',
    model: 'cycle-averaged-drift',
    key: configKey(c),
    config: structuredClone(c),
    fields,
    frames,
    diameters: initial.diameters,
    species: initial.species,
    masses: initial.masses,
    lost: 0,
    dt,
    recordHz: 120 / stride,
    precision: 'float32',
    motion: {
      state:
        (c.drive.kind === 'base' ? c.drive.displacement : c.drive.force) === 0
          ? 'undriven'
          : maxGamma <= 1
            ? 'below-threshold'
            : distance.some((v) => v > 1e-7)
              ? 'moving'
              : 'stationary',
      maxGamma,
      movingCount: distance.reduce((n, d) => n + (d > 1e-7 ? 1 : 0), 0),
      maxDistance: distance.reduce((m, d) => Math.max(m, d), 0),
      totalMass: initial.masses.reduce((a, b) => a + b, 0),
    },
    elapsedMs: performance.now() - start,
  };
}
/** Bracket actual timestamps, including nonuniform final checkpoints. No source frame is modified. */
export function framePair(run: Run, time: number) {
  const t = Math.max(0, Math.min(run.frames.at(-1)!.time, Number.isFinite(time) ? time : 0));
  let lo = 0,
    hi = run.frames.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (run.frames[mid].time <= t) lo = mid;
    else hi = mid;
  }
  if (t >= run.frames[hi].time) lo = hi;
  const a = run.frames[lo],
    b = run.frames[Math.min(run.frames.length - 1, lo + 1)];
  return { a, b, index: lo, alpha: a === b ? 0 : (t - a.time) / (b.time - a.time), time: t };
}
export function frameAt(run: Run, time: number, out?: GrainFrame): GrainFrame {
  const p = framePair(run, time);
  if (p.alpha === 0) return p.a;
  const f = out ?? {
    time: p.time,
    positions: new Float32Array(p.a.positions.length),
    distance: new Float32Array(p.a.distance.length),
  };
  f.time = p.time;
  for (let i = 0; i < f.positions.length; i++)
    f.positions[i] = p.a.positions[i] + (p.b.positions[i] - p.a.positions[i]) * p.alpha;
  for (let i = 0; i < f.distance.length; i++)
    f.distance[i] = p.a.distance[i] + (p.b.distance[i] - p.a.distance[i]) * p.alpha;
  if (p.a.heights && p.b.heights) {
    f.heights ??= new Float32Array(p.a.heights.length);
    for (let i = 0; i < f.heights.length; i++)
      f.heights[i] = p.a.heights[i] + (p.b.heights[i] - p.a.heights[i]) * p.alpha;
  }
  return f;
}
export function interpolateField(a: Field, b: Field, t: number): Field {
  if (t <= 0 || a === b) return a;
  if (t >= 1) return b;
  const real = a.real.map((v, i) => v + (b.real[i] - v) * t),
    imag = a.imag.map((v, i) => v + (b.imag[i] - v) * t),
    amplitude = real.map((v, i) => Math.hypot(v, imag[i]));
  return {
    ...a,
    frequency: a.frequency + (b.frequency - a.frequency) * t,
    real,
    imag,
    amplitude,
    peak: Math.max(...amplitude),
  };
}
export function fieldAtRun(run: Run, time: number): Field {
  const index =
      Math.max(0, Math.min(1, time / run.config.drive.duration)) * (run.fields.length - 1),
    lo = Math.floor(index);
  return interpolateField(
    run.fields[lo],
    run.fields[Math.min(run.fields.length - 1, lo + 1)],
    index - lo,
  );
}
