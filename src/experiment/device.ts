import type { Config, Plate } from './types';
import type { InstrumentAssetManifest } from '../scene/assetContract';
import { validateInstrumentAssetManifest } from '../scene/assetContract';

export type MeasurementSource = 'measured' | 'estimated' | 'default' | 'unknown';
export interface Measurement {
  value: number | null;
  source: MeasurementSource;
  uncertainty: number | null;
  unit: string;
  reference: string;
  range?: [number, number];
}
export interface DeviceEvidence {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  dataUrl?: string;
}
export interface DeviceObservation {
  id: string;
  particle: string;
  frequency: Measurement;
  description: string;
  reproduced: 'yes' | 'no' | 'unconfirmed';
  date: string | null;
  source: 'user-report' | 'observation';
}
export interface DeviceProfile {
  schema: 'chladni/device/1';
  id: string;
  name: string;
  kind: 'as-built' | 'proposal' | 'ideal';
  construction: 'adhesive' | 'bolted';
  date: string | null;
  calculationAssumption: 'ideal-reference' | 'compliant';
  plate: {
    width: Measurement;
    height: Measurement;
    thickness: Measurement;
    mass: Measurement;
    material: string;
    reference: string;
  };
  speaker: {
    model: string;
    reference: string;
    power: Measurement;
    impedance: Measurement;
    diameter: Measurement;
  };
  connector: {
    length: Measurement;
    width: Measurement;
    depth: Measurement;
    positionX: Measurement;
    positionY: Measurement;
    kz: Measurement;
    krx: Measurement;
    kry: Measurement;
    cz: Measurement;
    crx: Measurement;
    cry: Measurement;
    mass: Measurement;
    contactWidth: Measurement;
    contactHeight: Measurement;
    attachment: string;
  };
  support: string;
  tiltX: Measurement;
  tiltY: Measurement;
  notes: string;
  evidence: DeviceEvidence[];
  observations: DeviceObservation[];
  asset?: {
    file: Omit<DeviceEvidence, 'id' | 'dataUrl'>;
    manifest: InstrumentAssetManifest;
  };
}

export const DEVICE_PRESETS = [
  { id: 'current', label: '현재 실험 장치', kind: 'as-built' },
  { id: 'reinforced', label: '연결부 보강 설계', kind: 'proposal' },
  { id: 'ideal', label: '이상 체결 장치', kind: 'ideal' },
] as const;

export function measurement(
  unit: string,
  value: number | null = null,
  source: MeasurementSource = 'unknown',
  reference = '',
): Measurement {
  return { value, source, uncertainty: null, unit, reference };
}

/** Only user-supplied observations are populated. Unknown apparatus dimensions stay null. */
export function createDeviceProfile(id: string = 'current', plate?: Plate): DeviceProfile {
  const ideal = id === 'ideal',
    proposal = id === 'reinforced';
  const knownDesign = (unit: string, value: number) =>
    measurement(unit, value, 'default', '계산 설계 프리셋 · 실측 아님');
  const result: DeviceProfile = {
    schema: 'chladni/device/1',
    id,
    name: DEVICE_PRESETS.find((p) => p.id === id)?.label ?? '사용자 장치',
    kind: ideal ? 'ideal' : proposal ? 'proposal' : 'as-built',
    construction: ideal ? 'bolted' : 'adhesive',
    date: null,
    calculationAssumption: 'ideal-reference',
    plate: {
      width: ideal ? knownDesign('m', plate?.width ?? 0.3) : measurement('m'),
      height: ideal ? knownDesign('m', plate?.height ?? 0.3) : measurement('m'),
      thickness: ideal ? knownDesign('m', plate?.thickness ?? 0.002) : measurement('m'),
      mass: measurement('kg'),
      material: 'aluminum',
      reference: '사용자 제공: 알루미늄판 · 규격 미제공',
    },
    speaker: {
      model: '',
      reference: '',
      power: measurement('W'),
      impedance: measurement('Ω'),
      diameter: measurement('m'),
    },
    connector: {
      length: measurement('m'),
      width: measurement('m'),
      depth: measurement('m'),
      positionX: measurement('Lx'),
      positionY: measurement('Ly'),
      kz: measurement('N/m'),
      krx: measurement('N·m/rad'),
      kry: measurement('N·m/rad'),
      cz: measurement('N·s/m'),
      crx: measurement('N·m·s/rad'),
      cry: measurement('N·m·s/rad'),
      mass: measurement('kg'),
      contactWidth: measurement('m'),
      contactHeight: measurement('m'),
      attachment: ideal
        ? '볼트·와셔 체결 개념'
        : proposal
          ? '접착 보강 검토안 · 제작/성능 미확인'
          : '우드락·테이프 임시 연결 · 판 관통 구멍 없음',
    },
    support: ideal ? '이상적인 중앙 지지 개념' : '상세 규격 미기록',
    tiltX: measurement('deg'),
    tiltY: measurement('deg'),
    notes: '',
    evidence: [],
    observations: [],
  };
  if (!ideal && !proposal)
    result.observations = [
      {
        id: 'reported-sugar-100hz',
        particle: '설탕',
        frequency: measurement('Hz', 100, 'estimated', '사용자 제공 예비실험 기록 · 신호원 설정값'),
        description: '중앙 사각형과 X자 패턴을 한 차례 관찰. 연결부 불안정 이후 재현하지 못함.',
        reproduced: 'no',
        date: null,
        source: 'user-report',
      },
      {
        id: 'reported-tea-instability',
        particle: '녹차분말',
        frequency: measurement('Hz'),
        description: '최근 실험에서 연결부의 구조적 불안정성을 관찰. 주파수·입경·측정값 미제공.',
        reproduced: 'unconfirmed',
        date: null,
        source: 'user-report',
      },
    ];
  return result;
}

export function allDeviceMeasurements(p: DeviceProfile): Measurement[] {
  return [
    p.plate.width,
    p.plate.height,
    p.plate.thickness,
    p.plate.mass,
    p.speaker.power,
    p.speaker.impedance,
    p.speaker.diameter,
    ...(
      [
        'length',
        'width',
        'depth',
        'positionX',
        'positionY',
        'kz',
        'krx',
        'kry',
        'cz',
        'crx',
        'cry',
        'mass',
        'contactWidth',
        'contactHeight',
      ] as const
    ).map((k) => p.connector[k]),
    p.tiltX,
    p.tiltY,
    ...p.observations.map((o) => o.frequency),
  ];
}
export function validateDeviceProfile(value: unknown): asserts value is DeviceProfile {
  const p = value as DeviceProfile;
  if (
    !p ||
    p.schema !== 'chladni/device/1' ||
    !['as-built', 'proposal', 'ideal'].includes(p.kind) ||
    !['adhesive', 'bolted'].includes(p.construction) ||
    !['ideal-reference', 'compliant'].includes(p.calculationAssumption) ||
    typeof p.id !== 'string' ||
    typeof p.name !== 'string' ||
    p.name.length > 120 ||
    !p.plate ||
    !p.connector ||
    !p.speaker ||
    !['aluminum', 'steel', 'brass'].includes(p.plate.material) ||
    !Array.isArray(p.observations) ||
    p.observations.length > 100 ||
    !Array.isArray(p.evidence) ||
    p.evidence.length > 6
  )
    throw Error('장치 프로필 형식이 올바르지 않습니다.');
  for (const m of allDeviceMeasurements(p)) {
    if (
      !m ||
      !['measured', 'estimated', 'default', 'unknown'].includes(m.source) ||
      (m.value !== null && !Number.isFinite(m.value)) ||
      (m.uncertainty !== null && (!Number.isFinite(m.uncertainty) || m.uncertainty < 0)) ||
      typeof m.unit !== 'string' ||
      typeof m.reference !== 'string' ||
      (m.source === 'unknown' && m.value !== null) ||
      (m.source === 'measured' && (m.value === null || !m.reference.trim())) ||
      (m.range &&
        (!Array.isArray(m.range) ||
          m.range.length !== 2 ||
          !m.range.every(Number.isFinite) ||
          m.range[0] > m.range[1] ||
          (m.value !== null && (m.value < m.range[0] || m.value > m.range[1]))))
    )
      throw Error('장치 측정값·출처·불확도를 확인하세요. 실측값에는 측정 방법을 기록하세요.');
  }
  for (const m of [
    p.plate.width,
    p.plate.height,
    p.plate.thickness,
    p.plate.mass,
    p.connector.length,
    p.connector.width,
    p.connector.depth,
    p.connector.contactWidth,
    p.connector.contactHeight,
  ])
    if (m.value !== null && m.value <= 0) throw Error('장치 길이와 질량은 양수로 입력하세요.');
  for (const m of [
    p.connector.kz,
    p.connector.krx,
    p.connector.kry,
    p.connector.cz,
    p.connector.crx,
    p.connector.cry,
    p.connector.mass,
  ])
    if (m.value !== null && m.value < 0) throw Error('연결부 강성·감쇠·질량은 음수일 수 없습니다.');
  for (const m of [p.connector.positionX, p.connector.positionY])
    if (m.value !== null && (m.value < 0 || m.value > 1))
      throw Error('연결 위치는 0–1 사이입니다.');
  if (p.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(p.date))
    throw Error('장치 기록 날짜를 확인하세요.');
  for (const e of p.evidence)
    if (
      typeof e.name !== 'string' ||
      !Number.isFinite(e.size) ||
      e.size < 0 ||
      (e.dataUrl &&
        (!/^data:image\/(png|jpeg|webp);base64,/.test(e.dataUrl) || e.dataUrl.length > 3_000_000))
    )
      throw Error('장치 사진이 올바르지 않습니다.');
  for (const o of p.observations)
    if (
      typeof o.id !== 'string' ||
      typeof o.description !== 'string' ||
      o.description.length > 20000 ||
      typeof o.particle !== 'string' ||
      !['yes', 'no', 'unconfirmed'].includes(o.reproduced) ||
      !['user-report', 'observation'].includes(o.source) ||
      (o.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(o.date))
    )
      throw Error('장치 관찰 기록이 올바르지 않습니다.');
  if (p.asset) {
    validateInstrumentAssetManifest(p.asset.manifest);
    const f = p.asset.file;
    if (
      !f ||
      typeof f.name !== 'string' ||
      !Number.isFinite(f.size) ||
      f.size < 0 ||
      f.size > 32 * 1024 * 1024 ||
      !Number.isFinite(f.lastModified) ||
      typeof f.type !== 'string'
    )
      throw Error('장치 모델의 파일 참조가 올바르지 않습니다.');
  }
}

export function deviceCalculationStatus(p: DeviceProfile, connection?: Plate['connection']) {
  return {
    label:
      p.calculationAssumption === 'compliant'
        ? connection?.status === 'calibrated'
          ? '등가 연결부 · 보정 적용'
          : connection?.status === 'measured'
            ? '실측 연결부 · 선형 근사'
            : '등가 연결부 · 미보정'
        : '이상 고정 기준 · 실물 연결부 미반영',
    excluded: [
      '스피커 전기·기계 전달함수',
      '접착 파손·기울기·비대칭',
      '임시 지지부의 비선형 흔들림',
    ],
  };
}
/** Only quantities actually mapped into the plate solve; notes and evidence never replace a fit. */
export function devicePhysicsKey(p: DeviceProfile) {
  return JSON.stringify([
    p.calculationAssumption,
    p.plate.material,
    ...(['width', 'height', 'thickness', 'mass'] as const).map((k) => p.plate[k].value),
    ...(
      [
        'positionX',
        'positionY',
        'kz',
        'krx',
        'kry',
        'cz',
        'crx',
        'cry',
        'mass',
        'contactWidth',
        'contactHeight',
      ] as const
    ).map((k) => p.connector[k].value),
  ]);
}
export function applyDeviceProfile(config: Config, profile: DeviceProfile): Config {
  validateDeviceProfile(profile);
  const next: Config = structuredClone(config);
  next.device = structuredClone(profile);
  const library = new Map((config.deviceLibrary ?? []).map((p) => [p.id, p]));
  if (config.device) library.set(config.device.id, config.device);
  library.set(profile.id, profile);
  if (library.size > 8) throw Error('장치 프로필은 세션당 최대 8개입니다.');
  next.deviceLibrary = Array.from(library.values(), (p) => structuredClone(p));
  for (const key of ['width', 'height', 'thickness'] as const)
    if (profile.plate[key].value !== null) next.plate[key] = profile.plate[key].value;
  // Constitutive values are material design presets, independent of the evidence record.
  const materials = {
    aluminum: { young: 69e9, poisson: 0.33, density: 2700 },
    steel: { young: 200e9, poisson: 0.3, density: 7850 },
    brass: { young: 100e9, poisson: 0.34, density: 8500 },
  };
  if (next.plate.material !== profile.plate.material)
    Object.assign(next.plate, materials[profile.plate.material as keyof typeof materials]);
  // A measured plate mass defines an effective uniform density. No geometry is inferred from mass alone.
  if (profile.plate.mass.value !== null)
    next.plate.density =
      profile.plate.mass.value / (next.plate.width * next.plate.height * next.plate.thickness);
  else if (
    config.device?.plate.mass.value !== null &&
    config.device?.plate.mass.value !== undefined
  )
    next.plate.density = materials[profile.plate.material as keyof typeof materials].density;
  next.plate.material = profile.plate.material;
  if (profile.connector.positionX.value !== null)
    next.plate.supportX = profile.connector.positionX.value;
  if (profile.connector.positionY.value !== null)
    next.plate.supportY = profile.connector.positionY.value;
  next.plate.boundary = 'center';
  delete next.plate.connection;
  if (profile.calculationAssumption === 'compliant') {
    const c = profile.connector;
    if (
      ![c.kz, c.krx, c.kry, c.contactWidth, c.contactHeight].every(
        (m) => m.value !== null && m.value > 0,
      )
    )
      throw Error(
        '유연 연결부에는 수직·회전 강성과 접촉 가로·세로의 추정값 또는 실측값이 필요합니다.',
      );
    const used = [c.kz, c.krx, c.kry, c.cz, c.crx, c.cry, c.mass, c.contactWidth, c.contactHeight];
    next.plate.connection = {
      enabled: true,
      kz: c.kz.value!,
      krx: c.krx.value!,
      kry: c.kry.value!,
      cz: c.cz.value ?? 0,
      crx: c.crx.value ?? 0,
      cry: c.cry.value ?? 0,
      mass: c.mass.value ?? 0,
      width: c.contactWidth.value!,
      height: c.contactHeight.value!,
      status: used.every((m) => m.source === 'measured') ? 'measured' : 'estimated',
      reference:
        used
          .filter((m) => m.value !== null)
          .map((m) => `${m.unit}: ${m.reference || m.source}`)
          .join('; ') +
        (used.some((m) => m.value === null) ? '; 미입력 감쇠·질량 효과 제외(0)' : ''),
      ranges: Object.fromEntries(
        (['kz', 'krx', 'kry', 'cz', 'mass'] as const)
          .filter((k) => c[k].range)
          .map((k) => [k, c[k].range!]),
      ),
    };
    if (
      config.device &&
      devicePhysicsKey(config.device) === devicePhysicsKey(profile) &&
      config.plate.connection?.enabled
    )
      next.plate.connection = structuredClone(config.plate.connection);
  }
  return next;
}
