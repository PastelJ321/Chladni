export type SequenceId = 'reveal' | 'exploded' | 'resonance' | 'formation' | 'comparison' | 'macro';
export type Vec3 = [number, number, number];

export interface CameraPose {
  position: number[];
  target: number[];
  up?: number[];
  fov?: number;
  focus?: number;
}

export interface PartPose {
  offset: Vec3;
  rotation: Vec3;
}

export interface InstrumentFraming {
  plateY: number;
  scale: number;
}

export interface DirectorFrame {
  camera: CameraPose | null;
  parts: Record<string, PartPose> | null;
  layer?: 'material' | 'amplitude' | 'contour' | 'trace';
  gain?: number;
  phase: number;
  runProgress: number | null;
  region: boolean;
}

export const SEQUENCES: {
  id: SequenceId;
  label: string;
  duration: number;
  requires: 'none' | 'field' | 'run' | 'media';
}[] = [
  { id: 'reveal', label: '장비 전경', duration: 9, requires: 'none' },
  { id: 'exploded', label: '정밀 분해 · 조립', duration: 18, requires: 'none' },
  { id: 'resonance', label: '공진과 모드', duration: 12, requires: 'field' },
  { id: 'formation', label: '입자 이동 관찰', duration: 14, requires: 'run' },
  { id: 'macro', label: '입자 매크로', duration: 10, requires: 'none' },
  { id: 'comparison', label: '실측과 비교', duration: 10, requires: 'media' },
];

export const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * t * (10 + t * (-15 + 6 * t));
};

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

const pose = (x = 0, y = 0, z = 0, ry = 0): PartPose => ({
  offset: [x === 0 ? 0 : x, y === 0 ? 0 : y, z === 0 ? 0 : z],
  rotation: [0, ry === 0 ? 0 : ry, 0],
});

/**
 * Mechanical contact-graph order:
 * 1) Axial bolt unthreading before lateral clearance
 * 2) Upper washer lifts clear
 * 3) Plate + resting particles elevate cleanly
 * 4) Lower washer & vibration coupler clear speaker cone throat
 * 5) Speaker transducer internal stack separates (surround -> cone -> coil/spider -> basket -> magnet)
 * No synthetic overshoot or elastic bounce; exact [0, 0, 0] reassembly at progress === 0.
 */
export function explodedParts(progress: number): Record<string, PartPose> {
  const step = (start: number, end: number) => smooth((progress - start) / (end - start));
  const release = step(0, 0.12),
    boltLift = step(0.12, 0.3),
    boltShift = step(0.18, 0.38),
    plate = step(0.18, 0.64),
    adapter = step(0.4, 0.86),
    surround = step(0.56, 0.96),
    cone = step(0.6, 0.98),
    coil = step(0.64, 1.0),
    frame = step(0.68, 1.0),
    magnet = step(0.7, 1.0);
  return {
    bolt: pose(0.34 * boltShift, 0.104 * release + 2.616 * boltLift, 0, -Math.PI * 16 * release),
    washerTop: pose(0, 2.34 * step(0.08, 0.36)),
    plate: pose(0, 1.82 * plate),
    washerBottom: pose(0, 1.38 * step(0.3, 0.7)),
    coupler: pose(0, 0.84 * adapter),
    speaker: pose(),
    frame: pose(0, 0.12 * frame),
    magnet: pose(0, -0.045 * magnet),
    coil: pose(0, 0.27 * coil),
    cone: pose(0, 0.48 * cone),
    surround: pose(0, 0.57 * surround),
    particles: pose(0, 1.82 * plate),
    support: pose(),
  };
}

/**
 * Orbital spherical-arc interpolation around target prevents linear camera chords from clipping
 * through the aluminum plate or speaker assembly while keeping smooth C² acceleration/deceleration.
 */
function mixOrbital(
  posA: number[],
  tgtA: number[],
  posB: number[],
  tgtB: number[],
  p: number,
  target: number[],
): number[] {
  if (p <= 0) return posA.slice();
  if (p >= 1) return posB.slice();
  const oxA = posA[0] - tgtA[0],
    oyA = posA[1] - tgtA[1],
    ozA = posA[2] - tgtA[2];
  const oxB = posB[0] - tgtB[0],
    oyB = posB[1] - tgtB[1],
    ozB = posB[2] - tgtB[2];
  const rA = Math.hypot(oxA, oyA, ozA),
    rB = Math.hypot(oxB, oyB, ozB);
  const hA = Math.hypot(oxA, ozA),
    hB = Math.hypot(oxB, ozB);
  // Fall back to smooth cartesian interpolation near zenith (top-down views) to avoid azimuth singularity
  if (hA < 0.35 || hB < 0.35 || rA < 0.2 || rB < 0.2) return mix(posA, posB, p);
  const azA = Math.atan2(oxA, ozA),
    azB = Math.atan2(oxB, ozB);
  let dAz = azB - azA;
  while (dAz > Math.PI) dAz -= Math.PI * 2;
  while (dAz < -Math.PI) dAz += Math.PI * 2;
  const elA = Math.atan2(oyA, hA),
    elB = Math.atan2(oyB, hB);
  const az = azA + dAz * p,
    el = elA + (elB - elA) * p,
    r = rA + (rB - rA) * p;
  const ch = Math.cos(el) * r;
  return [
    target[0] + Math.sin(az) * ch,
    target[1] + Math.sin(el) * r,
    target[2] + Math.cos(az) * ch,
  ];
}

function track(
  t: number,
  points: { t: number; position: Vec3; target: Vec3; fov: number }[],
  origin: CameraPose,
  framing: InstrumentFraming,
): CameraPose {
  const frames = [
    {
      t: 0,
      position: origin.position as Vec3,
      target: origin.target as Vec3,
      fov: origin.fov ?? 31,
    },
    ...points.map((frame) => {
      const target: Vec3 = [
        frame.target[0] * framing.scale,
        frame.target[1] + framing.plateY - 2.24,
        frame.target[2] * framing.scale,
      ];
      const macro = Math.hypot(...frame.position.map((v, i) => v - frame.target[i])) < 2;
      const fit = macro ? 1 : Math.max(1, framing.scale);
      return {
        ...frame,
        target,
        position: target.map((v, i) => v + (frame.position[i] - frame.target[i]) * fit) as Vec3,
      };
    }),
  ];
  for (let i = 1; i < frames.length; i++)
    if (t <= frames[i].t) {
      const a = frames[i - 1],
        b = frames[i],
        span = Math.max(1e-6, b.t - a.t),
        p = smooth((t - a.t) / span);
      const target = mix(a.target, b.target, p),
        position = mixOrbital(a.position, a.target, b.position, b.target, p, target);
      return {
        position,
        target,
        up: [0, 1, 0],
        fov: a.fov + (b.fov - a.fov) * p,
        focus: Math.hypot(...position.map((v, j) => v - target[j])),
      };
    }
  const end = frames.at(-1)!;
  return {
    ...end,
    up: [0, 1, 0],
    focus: Math.hypot(...end.position.map((v, j) => v - end.target[j])),
  };
}

export class AnimationDirector {
  id: SequenceId | null = null;
  time = 0;
  playing = false;
  cameraEnabled = true;
  origin: CameraPose = { position: [4.5, 4.1, 6.4], target: [0, 1.38, 0], fov: 31 };
  reason = '';
  revision = 0;
  framing: InstrumentFraming = { plateY: 2.24, scale: 1 };

  get duration() {
    return SEQUENCES.find((s) => s.id === this.id)?.duration ?? 0;
  }

  start(id: SequenceId, origin: CameraPose) {
    this.id = id;
    this.time = 0;
    this.origin = structuredClone(origin);
    this.playing = true;
    this.cameraEnabled = true;
    this.reason = '';
    this.revision++;
  }

  pause() {
    this.playing = false;
    this.revision++;
  }

  resume(direction = 1) {
    if (this.id) {
      if (direction > 0 && this.time >= this.duration) this.time = 0;
      if (direction < 0 && this.time <= 0) this.time = this.duration;
      this.playing = true;
      this.reason = '';
      this.revision++;
    }
  }

  seek(t: number) {
    this.time = Math.max(0, Math.min(this.duration, t));
    this.playing = false;
    this.reason = '';
    this.revision++;
  }

  interrupt() {
    if (this.id) {
      this.playing = false;
      this.cameraEnabled = false;
      this.reason = '직접 조작';
      this.revision++;
    }
  }

  stop() {
    this.id = null;
    this.time = 0;
    this.playing = false;
    this.cameraEnabled = false;
    this.reason = '';
    this.revision++;
  }

  tick(dt: number, speed = 1) {
    if (this.playing) {
      this.time = Math.max(0, Math.min(this.duration, this.time + Math.max(0, dt) * speed));
      if ((speed > 0 && this.time === this.duration) || (speed < 0 && this.time === 0))
        this.playing = false;
      this.revision++;
    }
  }

  sample(): DirectorFrame | null {
    if (!this.id) return null;
    const t = this.time,
      p = t / this.duration;
    let camera: CameraPose,
      parts: DirectorFrame['parts'] = null,
      layer: DirectorFrame['layer'] = 'material',
      runProgress: number | null = null,
      gain: number | undefined,
      region = false;

    switch (this.id) {
      case 'reveal':
        // Sculptural low rim-lit plate silhouette -> sweep revealing transducer & coupler -> balanced hero hold
        camera = track(
          t,
          [
            { t: 2.6, position: [5.7, 2.75, 3.6], target: [0, 1.82, 0], fov: 27 },
            { t: 6.2, position: [3.2, 3.25, 6.2], target: [0, 1.24, 0], fov: 29 },
            { t: 9.0, position: [4.5, 4.1, 6.4], target: [0, 1.38, 0], fov: 31 },
          ],
          this.origin,
          this.framing,
        );
        break;

      case 'exploded': {
        // Staged disassembly (0..36%) -> inspection plateau (36..60%) -> exact mechanical reassembly (60..100%)
        const progress = p < 0.36 ? smooth(p / 0.36) : p < 0.6 ? 1 : 1 - smooth((p - 0.6) / 0.4);
        parts = explodedParts(progress);
        camera = track(
          t,
          [
            { t: 5.5, position: [6.8, 7.1, 8.9], target: [0, 2.85, 0], fov: 31 },
            { t: 11.2, position: [3.4, 5.8, 9.8], target: [0, 2.65, 0], fov: 30 },
            { t: 18.0, position: [4.5, 4.1, 6.4], target: [0, 1.38, 0], fov: 31 },
          ],
          this.origin,
          this.framing,
        );
        break;
      }

      case 'resonance':
        // Oblique 3/4 view emphasizing physical plate deflection -> overhead analytical amplitude & nodal contours
        camera = track(
          t,
          [
            { t: 3.4, position: [4.1, 3.7, 5.3], target: [0, 2.15, 0], fov: 30 },
            { t: 8.6, position: [0.02, 10.6, 0.08], target: [0, 2.24, 0], fov: 30 },
            { t: 12.0, position: [0.02, 10.6, 0.08], target: [0, 2.24, 0], fov: 30 },
          ],
          this.origin,
          this.framing,
        );
        layer = p < 0.3 ? 'material' : p < 0.72 ? 'amplitude' : 'contour';
        gain = 1200 * smooth(p / 0.34);
        break;

      case 'macro':
        // Mid-plate context -> silky telephoto macro push-in -> grazing crystal inspection hold (target locked at t=9)
        camera = track(
          t,
          [
            { t: 3.0, position: [2.4, 3.85, 3.1], target: [0.35, 2.252, 0.35], fov: 30 },
            { t: 6.8, position: [0.95, 2.74, 1.38], target: [0.55, 2.252, 0.55], fov: 27 },
            { t: 9.0, position: [0.84, 2.64, 1.22], target: [0.55, 2.252, 0.55], fov: 25 },
            { t: 10.0, position: [0.84, 2.64, 1.22], target: [0.55, 2.252, 0.55], fov: 25 },
          ],
          this.origin,
          this.framing,
        );
        gain = 1;
        break;

      case 'formation':
        camera = track(
          t,
          [
            { t: 2.8, position: [0.04, 9.6, 0.08], target: [0, 2.24, 0], fov: 30 },
            { t: 9.2, position: [0.04, 9.2, 0.08], target: [0, 2.24, 0], fov: 30 },
            { t: 13.0, position: [0.88, 2.68, 1.28], target: [0.55, 2.252, 0.55], fov: 26 },
          ],
          this.origin,
          this.framing,
        );
        runProgress = smooth(Math.min(1, p / 0.8));
        layer = p > 0.46 && p < 0.68 ? 'trace' : 'material';
        gain = 1 + 199 * (1 - smooth((p - 0.38) / 0.34));
        region = p > 0.62;
        break;

      case 'comparison':
        // Disciplined overhead alignment for side-by-side / overlay scientific comparison
        camera = track(
          t,
          [
            { t: 2.6, position: [0.02, 10.0, 0.05], target: [0, 2.24, 0], fov: 30 },
            { t: 10.0, position: [0.02, 10.0, 0.05], target: [0, 2.24, 0], fov: 30 },
          ],
          this.origin,
          this.framing,
        );
        runProgress = p;
        break;
    }

    return {
      camera: this.cameraEnabled ? camera : null,
      parts,
      layer,
      gain,
      phase: Math.sin(p * Math.PI) * t * Math.PI,
      runProgress,
      region,
    };
  }
}
