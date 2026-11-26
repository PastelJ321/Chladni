export type Boundary = 'center' | 'simply-supported' | 'clamped' | 'cantilever';
export type ConnectionParameter = 'kz' | 'krx' | 'kry' | 'cz' | 'mass';
export interface PlateConnection {
  enabled: true;
  kz: number;
  krx: number;
  kry: number;
  cz: number;
  crx: number;
  cry: number;
  mass: number;
  width: number;
  height: number;
  status: 'estimated' | 'measured' | 'calibrated';
  reference: string;
  ranges?: Partial<Record<ConnectionParameter, [number, number]>>;
}
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
  connection?: PlateConnection;
  dampingSource?: {
    method: 'half-power';
    frequency: number;
    lowerHz: number;
    upperHz: number;
    reference: string;
  };
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
export type ParticleMaterialId = 'sand' | 'salt' | 'sugar' | 'tea' | 'glass' | 'custom';
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
  pending?: ('diameter' | 'density')[];
  evidence?: {
    size: 'measured' | 'estimated' | 'default';
    density: 'measured' | 'estimated' | 'default';
    reference: string;
  };
  restitution?: number;
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
  ratioBasis?: 'count' | 'mass';
  model?: 'drift' | 'contact';
  stillAirDrag?: boolean;
}
export interface Config {
  plate: Plate;
  drive: Drive;
  grains: Grains;
  device?: import('./device').DeviceProfile;
  deviceLibrary?: import('./device').DeviceProfile[];
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
  connector?: { displacement: number[]; rotationX: number[]; rotationY: number[] };
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
  heights?: NumericArray;
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
  model?: 'cycle-averaged-drift' | 'impact-contact';
  diagnostics?: {
    impacts: number;
    energyDissipated: number;
    particleInteractions: false;
    stillAirDrag: boolean;
    maxPenetration: number;
    substeps: number;
    maxHopHeight?: number;
  };
}
export interface RecordEntry {
  id: string;
  name: string;
  config: Config;
  modal: ModalResult;
  sweep: Sweep;
  run: Run | null;
  created: string;
  notes?: {
    observation: string;
    discrepancy: string;
    reproducibility: 'unknown' | 'single' | 'reproduced' | 'failed';
  };
  observations?: import('../analysis/observationTypes').ObservationSnapshot;
  calibration?: import('../solver/calibration').CalibrationReport;
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
  quality: 'high' | 'standard' | 'low';
  phase: number;
  particleVisual?: ParticleVisualProperties;
}
