import type { Config, ViewSettings, Grains, ParticleGroup } from './types';
import { createDeviceProfile, validateDeviceProfile } from './device';
export const MATERIALS = {
  aluminum: { label: '알루미늄', young: 69e9, density: 2700, poisson: 0.33 },
  steel: { label: '강철', young: 200e9, density: 7850, poisson: 0.3 },
  brass: { label: '황동', young: 100e9, density: 8500, poisson: 0.34 },
};
export const DEFAULT_CONFIG: Config = {
  device: createDeviceProfile('current'),
  plate: {
    width: 0.3,
    height: 0.3,
    thickness: 0.002,
    density: 2700,
    young: 69e9,
    poisson: 0.33,
    damping: 0.015,
    boundary: 'center',
    supportX: 0.5,
    supportY: 0.5,
    mesh: 6,
    material: 'aluminum',
  },
  drive: {
    kind: 'base',
    frequency: 300,
    start: 40,
    end: 1600,
    samples: 321,
    force: 0.1,
    displacement: 2e-6,
    x: 0.64,
    y: 0.51,
    duration: 8,
    signal: 'sine',
  },
  grains: {
    kind: 'mixture',
    groups: {
      sand: {
        diameter: 302.5e-6,
        spread: 105 / 605,
        density: 2650,
        friction: 0.35,
        shape: 1,
        sieve: '250–355',
      },
      salt: {
        diameter: 427.5e-6,
        spread: 145 / 855,
        density: 2160,
        friction: 0.3,
        shape: 1,
        sieve: '355–500',
      },
    },
    diameter: 0.00035,
    spread: 0.25,
    density: 2650,
    saltDensity: 2160,
    shape: 1,
    friction: 0.35,
    count: 20000,
    seed: 240519,
    ratio: 0.5,
    distribution: 'uniform',
    spots: [],
    transport: 8,
  },
};
export const DEFAULT_VIEW: ViewSettings = {
  layer: 'material',
  camera: 'hero',
  structure: 'assembled',
  sectionAxis: 'z',
  sectionPosition: 0,
  explosion: 1,
  assembly: 1,
  gain: 200,
  mode: 0,
  showMode: false,
  particles: true,
  selected: null,
  quality: 'standard',
  phase: 0,
  particleVisual: {
    mode: 'observe',
    apparentSize: 1,
    minimumPixelDiameter: 1.8,
    displayMagnification: 2.5,
    count: 0,
    LOD: 'auto',
    shadingMode: 'material',
  },
};
export const cloneConfig = (c: Config): Config => JSON.parse(JSON.stringify(c));
export const configKey = (c: Config) => {
  if (!c.device) return JSON.stringify(c); // archived v0.2–v0.4 keys stay byte-compatible
  const plate = { ...c.plate },
    grains = structuredClone(c.grains);
  if (plate.connection) {
    plate.connection = { ...plate.connection };
    delete plate.connection.ranges;
    plate.connection.reference = '';
    plate.connection.status = 'estimated';
  }
  if (grains.groups) for (const group of Object.values(grains.groups)) delete group.evidence;
  return JSON.stringify({ plate, drive: c.drive, grains });
};
// Only stiffness/mass/constraint inputs affect the eigensystem. Damping belongs to response.
export const plateKey = (p: Config['plate']) => {
  const key: unknown[] = [
    p.width,
    p.height,
    p.thickness,
    p.young,
    p.density,
    p.poisson,
    p.mesh,
    p.boundary,
    p.boundary === 'center' ? Math.round(p.supportX * p.mesh) : 0,
    p.boundary === 'center' ? Math.round(p.supportY * p.mesh) : 0,
  ];
  if (p.connection?.enabled) {
    const q = p.connection;
    key.push([
      'compliant-patch',
      p.supportX,
      p.supportY,
      q.kz,
      q.krx,
      q.kry,
      q.mass,
      q.width,
      q.height,
    ]);
  }
  return JSON.stringify(key);
};
export const legacyPlateKey = (p: Config['plate']) => JSON.stringify(p);
export const responseKey = (c: Config, frequency = c.drive.frequency) =>
  JSON.stringify([
    plateKey(c.plate),
    c.plate.damping,
    c.drive.kind,
    c.drive.kind === 'base' ? c.drive.displacement : c.drive.force,
    c.drive.kind === 'force' ? [c.drive.x, c.drive.y] : null,
    frequency,
    ...(c.plate.connection?.enabled
      ? [[c.plate.connection.cz, c.plate.connection.crx, c.plate.connection.cry]]
      : []),
  ]);
export const sweepKey = (c: Config) =>
  JSON.stringify([responseKey(c, 0), c.drive.start, c.drive.end, c.drive.samples]);
export function validateConfig(c: Config) {
  if (c.device) validateDeviceProfile(c.device);
  if (c.deviceLibrary) {
    if (!Array.isArray(c.deviceLibrary) || c.deviceLibrary.length > 8)
      throw Error('장치 프로필은 최대 8개입니다.');
    c.deviceLibrary.forEach(validateDeviceProfile);
  }
  const p = c?.plate,
    d = c?.drive,
    g = c?.grains;
  if (!p || !d || !g) throw Error('실험 조건이 누락되었습니다.');
  const within = (v: number, a: number, b: number) => Number.isFinite(v) && v >= a && v <= b;
  if (
    !within(p.width, 0.1, 0.6) ||
    !within(p.height, 0.1, 0.6) ||
    !within(p.thickness, 0.0005, 0.006) ||
    p.thickness / Math.min(p.width, p.height) > 0.04
  )
    throw Error('얇은 판 범위를 벗어났습니다. 두께/짧은 변 ≤ 0.04를 사용하세요.');
  if (
    !within(p.young, 1e9, 300e9) ||
    !within(p.density, 500, 20000) ||
    !within(p.poisson, 0.05, 0.45) ||
    !within(p.damping, 0.001, 0.2) ||
    ![4, 6, 8].includes(p.mesh) ||
    !['center', 'simply-supported', 'clamped', 'cantilever'].includes(p.boundary)
  )
    throw Error('판 물성 또는 메시 조건이 올바르지 않습니다.');
  const connection = p.connection;
  if (connection) {
    if (
      connection.enabled !== true ||
      p.boundary !== 'center' ||
      !within(connection.kz, 1, 1e10) ||
      !within(connection.krx, 1e-5, 1e7) ||
      !within(connection.kry, 1e-5, 1e7) ||
      !within(connection.cz, 0, 1e6) ||
      !within(connection.crx, 0, 1e5) ||
      !within(connection.cry, 0, 1e5) ||
      !within(connection.mass, 0, 5) ||
      !within(connection.width, 0.001, p.width) ||
      !within(connection.height, 0.001, p.height) ||
      !['estimated', 'measured', 'calibrated'].includes(connection.status) ||
      typeof connection.reference !== 'string' ||
      p.supportX * p.width < connection.width / 2 ||
      (1 - p.supportX) * p.width < connection.width / 2 ||
      p.supportY * p.height < connection.height / 2 ||
      (1 - p.supportY) * p.height < connection.height / 2
    )
      throw Error('연결부 강성·감쇠·접촉 영역을 확인하세요. 접촉 영역은 판 안에 있어야 합니다.');
    if (
      connection.ranges &&
      Object.entries(connection.ranges).some(
        ([key, range]) =>
          !['kz', 'krx', 'kry', 'cz', 'mass'].includes(key) ||
          !Array.isArray(range) ||
          range.length !== 2 ||
          !range.every(Number.isFinite) ||
          range[0] < 0 ||
          range[1] < range[0],
      )
    )
      throw Error('연결부 추정 범위를 확인하세요.');
  }
  if (
    ![p.supportX, p.supportY, d.x, d.y].every((v) => within(v, 0, 1)) ||
    !within(d.frequency, 1, 5000) ||
    !within(d.start, 1, 4999) ||
    !within(d.end, d.start + 1, 5000) ||
    !within(d.samples, 40, 600) ||
    !Number.isInteger(d.samples) ||
    !within(d.force, 0, 2) ||
    !within(d.displacement, 0, 20e-6) ||
    !within(d.duration, 0.5, 20) ||
    !['base', 'force'].includes(d.kind) ||
    !['sine', 'sweep'].includes(d.signal)
  )
    throw Error('구동 조건을 확인하세요.');
  if (g.groups)
    for (const group of [g.groups.sand, g.groups.salt]) {
      if (
        !group ||
        !within(group.diameter, 1e-6, 0.002) ||
        !within(group.spread, 0, 0.8) ||
        !within(group.density, 10, 10000) ||
        !within(group.friction, 0.05, 1) ||
        !within(group.shape, 0.5, 2) ||
        (group.material !== undefined &&
          !['sand', 'salt', 'sugar', 'tea', 'glass', 'custom'].includes(group.material)) ||
        (group.pending &&
          (!Array.isArray(group.pending) ||
            group.pending.some((k) => !['diameter', 'density'].includes(k)))) ||
        (group.restitution !== undefined && !within(group.restitution, 0, 1))
      )
        throw Error('입자군별 조건을 확인하세요.');
    }
  if (
    !within(g.count, 20, 50000) ||
    !Number.isInteger(g.count) ||
    (g.model !== undefined && !['drift', 'contact'].includes(g.model)) ||
    (g.ratioBasis !== undefined && !['count', 'mass'].includes(g.ratioBasis)) ||
    !within(g.diameter, 0.00005, 0.002) ||
    !within(g.spread, 0, 0.8) ||
    !within(g.density, 500, 10000) ||
    !within(g.saltDensity, 500, 10000) ||
    !within(g.shape, 0.5, 2) ||
    !within(g.friction, 0.05, 1) ||
    !within(g.ratio, 0, 1) ||
    !within(g.transport, 0, 40) ||
    !Number.isInteger(g.seed) ||
    !['sand', 'salt', 'mixture'].includes(g.kind) ||
    !['uniform', 'spot', 'paint'].includes(g.distribution) ||
    !Array.isArray(g.spots) ||
    g.spots.length > 200 ||
    !g.spots.every((s) => s.length === 2 && s.every((v) => within(v, 0, 1)))
  )
    throw Error('입자 조건을 확인하세요.');
}

export const SIEVE_RANGES = [
  [125, 250],
  [250, 355],
  [355, 500],
  [500, 710],
  [710, 1000],
] as const;
export function particleGroup(g: Grains, species: 0 | 1): ParticleGroup {
  return (
    g.groups?.[species ? 'salt' : 'sand'] ?? {
      diameter: g.diameter,
      spread: g.spread,
      density: species ? g.saltDensity : g.density,
      friction: g.friction,
      shape: g.shape,
      sieve: 'legacy',
    }
  );
}
export function independentGroups(g: Grains) {
  return { sand: { ...particleGroup(g, 0) }, salt: { ...particleGroup(g, 1) } };
}
export function sieveGroup(group: ParticleGroup, lower: number, upper: number): ParticleGroup {
  return {
    ...group,
    diameter: (lower + upper) * 0.5e-6,
    spread: (upper - lower) / (upper + lower),
    sieve: `${lower}–${upper}`,
    ...(group.pending ? { pending: group.pending.filter((k) => k !== 'diameter') } : {}),
  };
}
