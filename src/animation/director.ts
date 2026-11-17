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
// Contact graph order: release bolt/upper washer, lift plate, lower washer and adapter.
export function explodedParts(progress: number): Record<string, PartPose> {
  const step = (start: number, end: number) => smooth((progress - start) / (end - start));
  const release = step(0, 0.12),
    plate = step(0.18, 0.65),
    adapter = step(0.4, 0.88),
    driver = step(0.58, 1);
  return {
    bolt: pose(
      0.34 * step(0.18, 0.38),
      0.104 * release + 2.596 * step(0.12, 0.3),
      0,
      -Math.PI * 16 * release,
    ),
    washerTop: pose(0, 2.32 * step(0.08, 0.36)),
    plate: pose(0, 1.78 * plate),
    washerBottom: pose(0, 1.37 * step(0.3, 0.7)),
    coupler: pose(0, 0.83 * adapter),
    speaker: pose(),
    frame: pose(0, 0.12 * driver),
    magnet: pose(0, -0.04 * driver),
    coil: pose(0, 0.26 * driver),
    cone: pose(0, 0.48 * driver),
    surround: pose(0, 0.53 * driver),
    particles: pose(0, 1.78 * plate),
    support: pose(),
  };
}
function track(
  t: number,
  points: { t: number; position: Vec3; target: Vec3; fov: number }[],
  origin: CameraPose,
): CameraPose {
  const frames = [
    {
      t: 0,
      position: origin.position as Vec3,
      target: origin.target as Vec3,
      fov: origin.fov ?? 32,
    },
    ...points,
  ];
  for (let i = 1; i < frames.length; i++)
    if (t <= frames[i].t) {
      const a = frames[i - 1],
        b = frames[i],
        p = smooth((t - a.t) / (b.t - a.t));
      const position = mix(a.position, b.position, p),
        target = mix(a.target, b.target, p);
      return {
        position,
        target,
        up: [0, 1, 0],
        fov: a.fov + (b.fov - a.fov) * p,
        focus: Math.hypot(...position.map((v, j) => v - target[j])),
      };
    }
  return { ...frames.at(-1)!, up: [0, 1, 0] };
}
export class AnimationDirector {
  id: SequenceId | null = null;
  time = 0;
  playing = false;
  cameraEnabled = true;
  origin: CameraPose = { position: [5.2, 5, 6.9], target: [0, 1.4, 0], fov: 32 };
  reason = '';
  revision = 0;
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
        camera = track(
          t,
          [
            { t: 5, position: [5, 4.3, 6.4], target: [0, 1.4, 0], fov: 30 },
            { t: 8, position: [4.6, 4.7, 6], target: [0, 1.55, 0], fov: 31 },
          ],
          this.origin,
        );
        break;
      case 'exploded': {
        const progress = p < 0.36 ? smooth(p / 0.36) : p < 0.58 ? 1 : 1 - smooth((p - 0.58) / 0.42);
        parts = explodedParts(progress);
        camera = track(
          t,
          [
            { t: 5, position: [6.8, 7.2, 9], target: [0, 2.9, 0], fov: 32 },
            { t: 11, position: [5.4, 6.2, 8.5], target: [0, 2.8, 0], fov: 32 },
            { t: 18, position: [5, 4.8, 6.5], target: [0, 1.5, 0], fov: 32 },
          ],
          this.origin,
        );
        break;
      }
      case 'resonance':
        camera = track(
          t,
          [
            { t: 3, position: [4.2, 4.8, 5.9], target: [0, 2.1, 0], fov: 32 },
            { t: 9, position: [0.02, 11.4, 0.12], target: [0, 2.24, 0], fov: 31 },
          ],
          this.origin,
        );
        layer = p < 0.28 ? 'material' : p < 0.7 ? 'amplitude' : 'contour';
        gain = 1200 * smooth(p / 0.35);
        break;
      case 'macro':
        camera = track(
          t,
          [
            { t: 6, position: [0.68, 2.48, 0.92], target: [0.55, 2.252, 0.55], fov: 32 },
            { t: 9, position: [0.65, 2.46, 0.89], target: [0.55, 2.252, 0.55], fov: 32 },
          ],
          this.origin,
        );
        gain = 1;
        break;
      case 'formation':
        camera = track(
          t,
          [
            { t: 3, position: [0.05, 9.4, 0.09], target: [0, 2.24, 0], fov: 31 },
            { t: 11, position: [0.68, 2.48, 0.92], target: [0.55, 2.252, 0.55], fov: 32 },
          ],
          this.origin,
        );
        runProgress = smooth(Math.min(1, p / 0.82));
        layer = p > 0.5 && p < 0.72 ? 'trace' : 'material';
        gain = 1 + 199 * (1 - smooth((p - 0.35) / 0.35));
        region = p > 0.64;
        break;
      case 'comparison':
        camera = track(
          t,
          [{ t: 3, position: [0.04, 10, 0.08], target: [0, 2.24, 0], fov: 31 }],
          this.origin,
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
