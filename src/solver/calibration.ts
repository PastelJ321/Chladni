import type { Config, ModalResult } from '../experiment/types';
import { cloneConfig, configKey, validateConfig } from '../experiment/config';
import { solvePlate } from './modal';
export type CalibrationParameter = 'kz' | 'rotationScale';
export interface ResonanceObservation {
  id: string;
  mode: number;
  frequency: number;
  role: 'fit' | 'validation';
  uncertaintyHz?: number;
  source: string;
}
export interface CalibrationRequest {
  config: Config;
  parameter: CalibrationParameter;
  bounds: [number, number];
  observations: ResonanceObservation[];
}
export interface CalibrationError extends ResonanceObservation {
  beforeHz: number;
  afterHz: number;
  beforeErrorHz: number;
  afterErrorHz: number;
  beforeAbsoluteErrorHz: number;
  afterAbsoluteErrorHz: number;
  beforeRelative: number;
  afterRelative: number;
}
export interface CalibrationReport {
  id: string;
  created: string;
  source: 'user-resonance-fit';
  originalKey: string;
  original: Config;
  calibrated: Config;
  parameter: CalibrationParameter;
  bounds: [number, number];
  value: number;
  errors: CalibrationError[];
  trainingRmsRelative: number;
  validationRmsRelative: number | null;
  evaluations: number;
  boundaryOptimum: boolean;
  limitations: string[];
}
function candidate(request: CalibrationRequest, value: number) {
  const c = cloneConfig(request.config),
    q = c.plate.connection!;
  value = Math.max(request.bounds[0], Math.min(request.bounds[1], value));
  if (request.parameter === 'kz') q.kz = value;
  else {
    q.krx *= value;
    q.kry *= value;
  }
  validateConfig(c);
  return c;
}
/** A single parameter is fitted. Held-out observations never enter the objective or search. */
export function calibrateConnection(
  request: CalibrationRequest,
  progress: (v: number) => void = () => {},
): CalibrationReport {
  validateConfig(request.config);
  const { bounds, observations } = request;
  if (!request.config.plate.connection?.enabled) throw Error('유연 연결부를 먼저 설정하세요.');
  if (
    !['kz', 'rotationScale'].includes(request.parameter) ||
    !bounds.every(Number.isFinite) ||
    bounds[0] <= 0 ||
    bounds[1] <= bounds[0]
  )
    throw Error('양수인 강성 탐색 구간을 지정하세요.');
  if (
    !Array.isArray(observations) ||
    observations.length > 100 ||
    observations.some(
      (o) =>
        !Number.isInteger(o.mode) ||
        o.mode < 1 ||
        o.mode > 24 ||
        !Number.isFinite(o.frequency) ||
        o.frequency <= 0 ||
        !['fit', 'validation'].includes(o.role) ||
        !o.source.trim() ||
        (o.uncertaintyHz !== undefined &&
          (!Number.isFinite(o.uncertaintyHz) || o.uncertaintyHz <= 0)),
    )
  )
    throw Error('모드 번호·실측 주파수·출처를 확인하세요.');
  const training = observations.filter((o) => o.role === 'fit');
  if (training.length < 2 || new Set(training.map((o) => o.mode)).size < 2)
    throw Error('서로 다른 모드의 보정 관측값이 2개 이상 필요합니다.');
  candidate(request, bounds[0]);
  candidate(request, bounds[1]);
  const original = solvePlate(request.config.plate),
    cache = new Map<number, { modal: ModalResult; score: number }>();
  let evaluations = 0;
  const evaluate = (logValue: number) => {
    let result = cache.get(logValue);
    if (result) return result;
    const value = Math.exp(logValue),
      modal = solvePlate(candidate(request, value).plate);
    if (observations.some((o) => o.mode > modal.frequencies.length))
      throw Error('계산된 모드 수보다 큰 모드 번호입니다.');
    const score =
      training.reduce(
        (sum, o) =>
          sum +
          ((modal.frequencies[o.mode - 1] - o.frequency) / (o.uncertaintyHz ?? o.frequency)) ** 2,
        0,
      ) / training.length;
    if (!Number.isFinite(score))
      throw Error('보정 응답이 유한하지 않습니다. 탐색 범위를 줄이세요.');
    result = { modal, score };
    cache.set(logValue, result);
    evaluations++;
    progress(Math.min(0.97, evaluations / 27));
    return result;
  };
  const logs = Array.from(
      { length: 9 },
      (_, i) => Math.log(bounds[0]) + ((Math.log(bounds[1]) - Math.log(bounds[0])) * i) / 8,
    ),
    coarse = logs.map((log) => evaluate(log));
  const sensitivity = Math.max(
    ...training.map(
      (o) =>
        Math.abs(
          coarse[0].modal.frequencies[o.mode - 1] - coarse[8].modal.frequencies[o.mode - 1],
        ) / o.frequency,
    ),
  );
  if (sensitivity < 1e-4)
    throw Error(
      '선택 모드가 이 강성에 거의 반응하지 않습니다. 모드 대응과 보정 대상을 확인하세요.',
    );
  let best = coarse.reduce((a, v, i) => (v.score < coarse[a].score ? i : a), 0),
    left = logs[Math.max(0, best - 1)],
    right = logs[Math.min(8, best + 1)];
  const ratio = (Math.sqrt(5) - 1) / 2;
  let c = right - ratio * (right - left),
    d = left + ratio * (right - left),
    fc = evaluate(c),
    fd = evaluate(d);
  for (let i = 0; i < 12; i++) {
    if (fc.score < fd.score) {
      right = d;
      d = c;
      fd = fc;
      c = right - ratio * (right - left);
      fc = evaluate(c);
    } else {
      left = c;
      c = d;
      fc = fd;
      d = left + ratio * (right - left);
      fd = evaluate(d);
    }
  }
  const optimum = [...cache.entries()].reduce((a, v) => (v[1].score < a[1].score ? v : a)),
    value = Math.max(bounds[0], Math.min(bounds[1], Math.exp(optimum[0]))),
    calibrated = candidate(request, value);
  calibrated.plate.connection!.status = 'calibrated';
  calibrated.plate.connection!.reference = `사용자 공진 자료 보정 · ${training
    .map((o) => o.source)
    .filter((s, i, all) => all.indexOf(s) === i)
    .join(', ')}`;
  const errors = observations.map((o) => {
    const beforeHz = original.frequencies[o.mode - 1],
      afterHz = optimum[1].modal.frequencies[o.mode - 1];
    return {
      ...o,
      beforeHz,
      afterHz,
      beforeErrorHz: beforeHz - o.frequency,
      afterErrorHz: afterHz - o.frequency,
      beforeAbsoluteErrorHz: Math.abs(beforeHz - o.frequency),
      afterAbsoluteErrorHz: Math.abs(afterHz - o.frequency),
      beforeRelative: (beforeHz - o.frequency) / o.frequency,
      afterRelative: (afterHz - o.frequency) / o.frequency,
    };
  });
  const rms = (role: ResonanceObservation['role']) => {
    const rows = errors.filter((e) => e.role === role);
    return rows.length
      ? Math.sqrt(rows.reduce((s, r) => s + r.afterRelative ** 2, 0) / rows.length)
      : null;
  };
  progress(1);
  return {
    id: crypto.randomUUID(),
    created: new Date().toISOString(),
    source: 'user-resonance-fit',
    originalKey: configKey(request.config),
    original: cloneConfig(request.config),
    calibrated,
    parameter: request.parameter,
    bounds: [...bounds],
    value,
    errors,
    trainingRmsRelative: rms('fit')!,
    validationRmsRelative: rms('validation'),
    evaluations,
    boundaryOptimum:
      Math.abs(Math.log(value / bounds[0])) < 0.001 ||
      Math.abs(Math.log(value / bounds[1])) < 0.001,
    limitations: [
      '1개 강성 변수만 추정. 구동 전달함수·마찰은 보정하지 않음.',
      '모드 번호는 사용자가 대응. 모드 교차 및 형상 일치는 자동 검증하지 않음.',
      '실측 공진 피크를 무감쇠 고유주파수의 근사로 취급. 강한 감쇠/중첩 공진에는 부적합.',
      '검증 관측은 최적화에 사용하지 않음. 독립성은 사용자 실험 기록으로 확인.',
    ],
  };
}
/** Small damping, isolated SDOF peak approximation; not used in the stiffness-frequency fit. */
export function halfPowerDamping(f0: number, low: number, high: number) {
  if (![f0, low, high].every(Number.isFinite) || low <= 0 || low >= f0 || high <= f0)
    throw Error('f₁ < f₀ < f₂인 양의 반전력 주파수를 입력하세요.');
  const zeta = (high - low) / (2 * f0);
  if (zeta > 0.1 || zeta < 0.001)
    throw Error('이 근사는 감쇠비 0.001–0.1의 고립 공진에만 사용하세요.');
  return zeta;
}
