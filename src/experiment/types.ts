export type Boundary = 'center' | 'simply-supported' | 'clamped' | 'cantilever';
export interface Plate {
  width: number;
  height: number;
  thickness: number;
  density: number;
  young: number;
  poisson: number;
  damping: number;
  boundary: Boundary;
  supportX: number;
  supportY: number;
  mesh: number;
  material: string;
}
export interface Drive {
  kind: 'base' | 'force';
  frequency: number;
  start: number;
  end: number;
  samples: number;
  force: number;
  displacement: number;
  x: number;
  y: number;
  duration: number;
  signal: 'sine' | 'sweep';
}
export type ParticleMaterialId = 'sand' | 'salt' | 'sugar' | 'glass' | 'custom';
export type NumericArray = number[] | Float32Array;
export interface ParticlePhysicalProperties {
  diameterMeters: number;
  density: number;
  shape: number;
  friction: number;
  species: ParticleMaterialId;
}
export interface ParticleVisualProperties {
  mode: 'actual' | 'observe';
  apparentSize: number;
  minimumPixelDiameter: number;
  displayMagnification: number;
  count: number;
  LOD: 'auto' | 'sprites';
  shadingMode: 'material' | 'species';
  overrides?: Partial<Record<'sand' | 'salt', { color: string; roughness: number }>>;
}
export interface ParticleGroup {
  material?: ParticleMaterialId;
  diameter: number;
  spread: number;
  density: number;
  friction: number;
  shape: number;
  sieve: string;
}
export interface Grains {
  groups?: { sand: ParticleGroup; salt: ParticleGroup }; // Absent in unchanged v0.2 records.

  kind: 'sand' | 'salt' | 'mixture';
  diameter: number;
  spread: number;
  density: number;
  saltDensity: number;
  shape: number;
  friction: number;
  count: number;
  seed: number;
  ratio: number;
  distribution: 'uniform' | 'spot' | 'paint';
  spots: [number, number][];
  transport: number;
}
export interface Config {
  plate: Plate;
  drive: Drive;
  grains: Grains;
}
export interface ModalResult {
  source: 'FEM';
  key: string;
  plate: Plate;
  frequencies: number[];
  vectors: number[][];
  baseParticipation: number[];
  freeDofs: number;
  residuals: number[];
  mass: number;
  support: [number, number];
  elapsedMs: number;
}
export interface Field {
  size: number;
  real: number[];
  imag: number[];
  amplitude: number[];
  peak: number;
  frequency: number;
  source: 'FEM';
  key: string;
}
export interface SweepPoint {
  frequency: number;
  rms: number;
}
export interface Sweep {
  points: SweepPoint[];
  peaks: SweepPoint[];
  source: 'FEM';
  key: string;
}
export interface GrainFrame {
  time: number;
  positions: NumericArray;
  distance: NumericArray;
}
export interface Run {
  key: string;
  source: 'approximation';
  config: Config;
  fields: Field[];
  frames: GrainFrame[];
  diameters: number[];
  species: number[];
  masses: number[];
  lost: number;
  recordHz?: number;
  precision?: 'float32';
  motion?: {
    state: 'undriven' | 'below-threshold' | 'stationary' | 'moving';
    maxGamma: number;
    movingCount: number;
    maxDistance: number;
    totalMass: number;
  };
  dt: number;
  elapsedMs: number;
}
export interface RecordEntry {
  id: string;
  name: string;
  config: Config;
  modal: ModalResult;
  sweep: Sweep;
  run: Run | null;
  created: string;
}
export type Workspace = 'experiment' | 'analyze' | 'device';
export type Layer =
  | 'material'
  | 'amplitude'
  | 'displacement'
  | 'velocity'
  | 'acceleration'
  | 'contour'
  | 'mesh'
  | 'trace'
  | 'density'
  | 'vector';
export interface ViewSettings {
  layer: Layer;
  camera: 'hero' | 'top' | 'macro';
  structure: 'assembled' | 'exploded' | 'assembly' | 'section' | 'cutaway' | 'ghost';
  sectionAxis: 'x' | 'y' | 'z';
  sectionPosition: number;
  explosion: number;
  assembly: number;
  gain: number;
  mode: number;
  showMode: boolean;
  particles: boolean;
  selected: string | null;
  quality: 'standard' | 'low';
  phase: number;
  particleVisual?: ParticleVisualProperties;
}
