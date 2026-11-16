import { seededRandom } from '../concept/physics';
import type { Config, Field, GrainFrame, ModalResult, Run } from '../experiment/types';
import { configKey, particleGroup } from '../experiment/config';
import { responseField, sampleGrid } from '../solver/response';
export function initialParticles(c: Config) {
  const g = c.grains,
    rand = seededRandom(g.seed),
    positions: number[] = [],
    species: number[] = [],
    diameters: number[] = [],
    masses: number[] = [];
  for (let i = 0; i < g.count; i++) {
    const salt = g.kind === 'salt' || (g.kind === 'mixture' && rand() < g.ratio);
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
    positions.push(Math.max(0.005, Math.min(0.995, x)), Math.max(0.005, Math.min(0.995, y)));
  }
  return { positions, species, diameters, masses };
}
export function simulateParticles(
  c: Config,
  modal: ModalResult,
  progress: (v: number) => void = () => {},
): Run {
  const start = performance.now(),
    initial = initialParticles(c),
    g = c.grains,
    dt = 1 / 120;
  const positions = initial.positions.slice(),
    vx = new Float64Array(g.count),
    vy = new Float64Array(g.count),
    distance = new Array<number>(g.count).fill(0),
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
  const gamma = fields.map((f) =>
    f.amplitude.map((v) => ((v * (2 * Math.PI * f.frequency) ** 2) / 9.80665) ** 2),
  );
  const frames: GrainFrame[] = [
    { time: 0, positions: positions.slice(), distance: distance.slice() },
  ];
  const steps = Math.round(c.drive.duration / dt);
  for (let step = 1; step <= steps; step++) {
    const fieldIndex = (step / steps) * (fields.length - 1),
      lo = Math.round(fieldIndex),
      hi = lo,
      blend = 0;
    const sample = (x: number, y: number) =>
      sampleGrid(gamma[lo], 25, x, y) * (1 - blend) + sampleGrid(gamma[hi], 25, x, y) * blend;
    for (let i = 0; i < g.count; i++) {
      const x = positions[i * 2],
        y = positions[i * 2 + 1],
        h = 0.008,
        energy = sample(x, y),
        gate = Math.max(0, Math.sqrt(energy) - 1) / (1 + Math.sqrt(energy));
      const gradX = (sample(x + h, y) - sample(x - h, y)) / (2 * h * c.plate.width),
        gradY = (sample(x, y + h) - sample(x, y - h)) / (2 * h * c.plate.height);
      const group = particleGroup(g, initial.species[i] as 0 | 1);
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
    if (step % 6 === 0 || step === steps)
      frames.push({ time: step * dt, positions: positions.slice(), distance: distance.slice() });
    if (step % 48 === 0) progress(step / steps);
  }
  return {
    source: 'approximation',
    key: configKey(c),
    config: structuredClone(c),
    fields,
    frames,
    diameters: initial.diameters,
    species: initial.species,
    masses: initial.masses,
    lost: 0,
    dt,
    elapsedMs: performance.now() - start,
  };
}
export function frameAt(run: Run, time: number): GrainFrame {
  const index = Math.min(run.frames.length - 1, Math.max(0, Math.round(time / 0.05)));
  return run.frames[index];
}

export function fieldAtRun(run: Run, time: number): Field {
  return run.fields[
    Math.min(
      run.fields.length - 1,
      Math.max(0, Math.round((time / run.config.drive.duration) * (run.fields.length - 1))),
    )
  ];
}
