import { MODES, type Mode, type ParticleKind } from './catalog';

// Visual surrogate, not an eigen-solution of the center-driven free-edge plate.
// Normalized coordinates [-1, 1], antisymmetric cosine superposition.
export function field(x: number, z: number, mode: Pick<Mode, 'm' | 'n'>) {
  const a = ((x + 1) * Math.PI) / 2;
  const b = ((z + 1) * Math.PI) / 2;
  return (
    (Math.cos(mode.m * a) * Math.cos(mode.n * b) - Math.cos(mode.n * a) * Math.cos(mode.m * b)) / 2
  );
}

export function gradient(x: number, z: number, mode: Pick<Mode, 'm' | 'n'>) {
  const a = ((x + 1) * Math.PI) / 2,
    b = ((z + 1) * Math.PI) / 2;
  const k = Math.PI / 4;
  return [
    k *
      (-mode.m * Math.sin(mode.m * a) * Math.cos(mode.n * b) +
        mode.n * Math.sin(mode.n * a) * Math.cos(mode.m * b)),
    k *
      (-mode.n * Math.cos(mode.m * a) * Math.sin(mode.n * b) +
        mode.m * Math.cos(mode.n * a) * Math.sin(mode.m * b)),
  ] as const;
}

export function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export function response(frequency: number, modeFrequency: number) {
  // Dimensionless damped response, normalized at resonance; Q is illustrative.
  const ratio = frequency / modeFrequency;
  const damping = 0.07;
  return Math.min(
    1,
    (2 * damping) / Math.sqrt((1 - ratio * ratio) ** 2 + (2 * damping * ratio) ** 2),
  );
}

export interface ParticleData {
  count: number;
  frames: number;
  positions: Float32Array;
  seeds: Float32Array;
  species: Uint8Array;
}

export const PARTICLE_COUNT = 7200;
export const PARTICLE_FRAMES = 81;
export function buildParticles(
  modeIndex: number,
  kind: ParticleKind,
  inverse = false,
  count = PARTICLE_COUNT,
): ParticleData {
  const mode = MODES[modeIndex];
  const random = seededRandom(240519);
  const frames = PARTICLE_FRAMES;
  const positions = new Float32Array(count * frames * 2);
  const seeds = new Float32Array(count * 3);
  const species = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    let x = (random() * 2 - 1) * 0.97,
      z = (random() * 2 - 1) * 0.97;
    if (Math.hypot(x, z) < 0.07) x += 0.1;
    seeds.set([random(), random(), random()], i * 3);
    species[i] = kind === 'salt' ? 1 : kind === 'mixture' ? i % 2 : 0;
    for (let frame = 0; frame < frames; frame++) {
      positions.set([x, z], (frame * count + i) * 2);
      const w = field(x, z, mode);
      const [gx, gz] = gradient(x, z, mode);
      const length = gx * gx + gz * gz + 0.04;
      const mobility = (species[i] ? 0.72 : 1) * (0.7 + seeds[i * 3] * 0.6);
      const dir = inverse ? -1 : 1;
      const target = (seeds[i * 3 + 1] - 0.5) * 0.03;
      const drift = inverse
        ? -0.008 * mobility * w
        : (0.46 * mobility * dir * (w - target)) / length;
      const noise = Math.abs(w) * 0.011 * (1 - frame / frames);
      x = Math.max(-0.975, Math.min(0.975, x - gx * drift + (random() - 0.5) * noise));
      z = Math.max(-0.975, Math.min(0.975, z - gz * drift + (random() - 0.5) * noise));
      if (Math.hypot(x, z) < 0.055) {
        x += 0.055;
        z += 0.025;
      }
    }
  }
  return { count, frames, positions, seeds, species };
}

export function particleAt(
  data: ParticleData,
  index: number,
  progress: number,
): readonly [number, number] {
  const frame = Math.max(0, Math.min(data.frames - 1, progress * (data.frames - 1)));
  const low = Math.floor(frame),
    high = Math.min(data.frames - 1, low + 1),
    mix = frame - low;
  const a = (low * data.count + index) * 2,
    b = (high * data.count + index) * 2;
  return [
    data.positions[a] + (data.positions[b] - data.positions[a]) * mix,
    data.positions[a + 1] + (data.positions[b + 1] - data.positions[a + 1]) * mix,
  ];
}

// Marching squares. Zero lines and amplitude contours share the analytic field.
export function contours(modeIndex: number, level: number, absolute = false, resolution = 92) {
  const segments: number[] = [];
  const mode = MODES[modeIndex];
  for (let zi = 0; zi < resolution; zi++)
    for (let xi = 0; xi < resolution; xi++) {
      const x = -1 + (xi * 2) / resolution,
        z = -1 + (zi * 2) / resolution,
        d = 2 / resolution;
      const points = [
        [x, z],
        [x + d, z],
        [x + d, z + d],
        [x, z + d],
      ];
      const values = points.map(
        ([px, pz]) => (absolute ? Math.abs(field(px, pz, mode)) : field(px, pz, mode)) - level,
      );
      const hits: number[][] = [];
      for (let e = 0; e < 4; e++) {
        const next = (e + 1) % 4,
          va = values[e],
          vb = values[next];
        if (va > 0 !== vb > 0) {
          const t = va / (va - vb);
          hits.push([
            points[e][0] + (points[next][0] - points[e][0]) * t,
            points[e][1] + (points[next][1] - points[e][1]) * t,
          ]);
        }
      }
      for (let p = 0; p + 1 < hits.length; p += 2) segments.push(...hits[p], ...hits[p + 1]);
    }
  return segments;
}
