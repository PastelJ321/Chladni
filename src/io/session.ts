import { jsonArrays, reviveArrays, packBinary, unpackBinary } from './arrays';
import { frameAt } from '../simulation/particles';
import type { Config, RecordEntry, Run, Sweep } from '../experiment/types';
import { validateConfig, configKey, plateKey, legacyPlateKey } from '../experiment/config';
import {
  validateObservationSnapshot,
  type ObservationSnapshot,
} from '../analysis/observationTypes';
import { validRegion, type AnalysisOptions } from '../analysis/metrics';
import { validateBookmarks, type Bookmark } from '../presentation/session';
import type { CalibrationReport } from '../solver/calibration';
import type { ViewSettings } from '../experiment/types';
export interface SessionExtras {
  observations?: ObservationSnapshot;
  analysis?: AnalysisOptions;
  calibration?: CalibrationReport | null;
  bookmarks?: Bookmark[];
  view?: ViewSettings;
}
function checkCalibration(r: CalibrationReport) {
  if (
    r.source !== 'user-resonance-fit' ||
    !Array.isArray(r.errors) ||
    r.errors.length > 100 ||
    !Number.isFinite(r.value)
  )
    throw Error('보정 기록을 확인하세요.');
  validateConfig(r.original);
  validateConfig(r.calibrated);
  if (
    r.originalKey !== configKey(r.original) ||
    r.errors.some(
      (o) =>
        !['fit', 'validation'].includes(o.role) ||
        !Number.isFinite(o.frequency) ||
        o.frequency <= 0 ||
        ![o.beforeHz, o.afterHz, o.afterErrorHz, o.afterRelative].every(Number.isFinite),
    )
  )
    throw Error('보정 데이터가 일치하지 않습니다.');
}
function checkExtras(x: SessionExtras) {
  if (x.observations) validateObservationSnapshot(x.observations);
  if (x.bookmarks) validateBookmarks(x.bookmarks);
  if (x.calibration) checkCalibration(x.calibration);
  if (
    x.analysis &&
    (!validRegion(x.analysis.roi) ||
      !['count', 'mass'].includes(x.analysis.basis) ||
      ![0, 1].includes(x.analysis.targetSpecies) ||
      !Number.isInteger(x.analysis.bins) ||
      x.analysis.bins < 2 ||
      x.analysis.bins > 64 ||
      !(
        x.analysis.nodeThreshold >= 0 &&
        x.analysis.nodeThreshold < x.analysis.antinodeThreshold &&
        x.analysis.antinodeThreshold <= 1
      ))
  )
    throw Error('분석 설정이 손상되었습니다.');
  if (
    x.view &&
    (!['hero', 'top', 'macro'].includes(x.view.camera) ||
      !Number.isFinite(x.view.gain) ||
      x.view.gain < 0 ||
      x.view.gain > 4000 ||
      !Number.isFinite(x.view.sectionPosition))
  )
    throw Error('화면 설정이 올바르지 않습니다.');
}
export function download(data: Blob | string, name: string, type = 'application/json') {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function sessionData(
  config: Config,
  records: RecordEntry[],
  active?: RecordEntry | null,
  extras?: SessionExtras,
) {
  return {
    schema: 'chladni/5',
    config,
    records,
    ...(active ? { active } : {}),
    ...(extras ? { extras } : {}),
    provenance: {
      plate: 'BFS Kirchhoff-Love FEM',
      particles:
        config.grains.model === 'contact'
          ? 'independent sphere contact approximation'
          : 'cycle-averaged approximation',
      calibrated: false,
      connectorParameterStatus: config.plate.connection?.status ?? 'ideal-reference',
      calibrationScope:
        'A fitted connector parameter does not validate the apparatus or particle separation model',
    },
  };
}
export function encodeSession(
  config: Config,
  records: RecordEntry[],
  active?: RecordEntry | null,
  extras?: SessionExtras,
) {
  return JSON.stringify(sessionData(config, records, active, extras), jsonArrays);
}
export function encodeBinarySession(
  config: Config,
  records: RecordEntry[],
  active?: RecordEntry | null,
  extras?: SessionExtras,
) {
  return packBinary(sessionData(config, records, active, extras));
}
export function decodeBinarySession(buffer: ArrayBuffer) {
  return validateSession(unpackBinary(buffer));
}
export function decodeSession(raw: string): {
  config: Config;
  records: RecordEntry[];
  active?: RecordEntry;
  extras?: SessionExtras;
} {
  return validateSession(JSON.parse(raw, reviveArrays));
}
function validateSession(value: unknown): {
  config: Config;
  records: RecordEntry[];
  active?: RecordEntry;
  extras?: SessionExtras;
} {
  const data = value as ReturnType<typeof sessionData>;
  if (!['chladni/2', 'chladni/3', 'chladni/4', 'chladni/5'].includes(data.schema))
    throw Error('지원하지 않는 세션 형식입니다.');
  validateConfig(data.config);
  if (data.extras) checkExtras(data.extras);
  if (!Array.isArray(data.records) || data.records.length > 20)
    throw Error('기록 목록이 올바르지 않습니다.');
  for (const r of [...data.records, ...(data.active ? [data.active] : [])]) {
    validateConfig(r.config);
    if (r.observations) validateObservationSnapshot(r.observations);
    if (r.calibration) checkCalibration(r.calibration);
    if (
      r.modal?.source !== 'FEM' ||
      r.sweep?.source !== 'FEM' ||
      !Array.isArray(r.modal.frequencies) ||
      !r.modal.frequencies.every((v: number) => Number.isFinite(v) && v > 0) ||
      ![plateKey(r.config.plate), legacyPlateKey(r.config.plate)].includes(r.modal.key)
    )
      throw Error('해석 기록이 손상되었습니다.');
    const finite = (a: unknown, len?: number): a is number[] =>
      (Array.isArray(a) || a instanceof Float32Array) &&
      (len === undefined || a.length === len) &&
      a.every((v) => Number.isFinite(v));
    if (
      r.modal?.connector &&
      Object.values(r.modal.connector).some((a) => !finite(a, r.modal.frequencies.length))
    )
      throw Error('연결부 모드 배열이 손상되었습니다.');
    if (
      !finite(r.modal.baseParticipation, r.modal.frequencies.length) ||
      !Array.isArray(r.modal.vectors) ||
      r.modal.vectors.length !== r.modal.frequencies.length ||
      r.modal.vectors.some((v: unknown) => !finite(v, (r.config.plate.mesh + 1) ** 2 * 4)) ||
      !Array.isArray(r.sweep.points) ||
      !r.sweep.points.every(
        (p: { frequency: number; rms: number }) =>
          Number.isFinite(p.frequency) && Number.isFinite(p.rms) && p.rms >= 0,
      )
    )
      throw Error('해석 배열이 손상되었습니다.');
    if (
      r.run &&
      (r.run.key !== configKey(r.config) ||
        !Array.isArray(r.run.frames) ||
        r.run.frames.some(
          (f: { positions: number[] | Float32Array }) =>
            !(Array.isArray(f.positions) || f.positions instanceof Float32Array) ||
            f.positions.length !== r.config.grains.count * 2 ||
            f.positions.some((v) => !Number.isFinite(v) || v < 0 || v > 1),
        ))
    )
      throw Error('입자 기록이 손상되었습니다.');
    if (
      r.run &&
      (!finite(r.run.diameters, r.config.grains.count) ||
        !finite(r.run.species, r.config.grains.count) ||
        !finite(r.run.masses, r.config.grains.count) ||
        !r.run.frames.length ||
        !Array.isArray(r.run.fields) ||
        !r.run.fields.length ||
        r.run.frames.some(
          (f, index) =>
            !Number.isFinite(f.time) ||
            !finite(f.distance, r.config.grains.count) ||
            (index > 0 && f.time <= r.run!.frames[index - 1].time) ||
            (f.heights !== undefined &&
              (!finite(f.heights, r.config.grains.count) || f.heights.some((v) => v < 0))),
        ) ||
        r.run.fields.some(
          (f: {
            size: number;
            real: unknown;
            imag: unknown;
            amplitude: unknown;
            frequency: number;
          }) =>
            !Number.isInteger(f.size) ||
            f.size < 2 ||
            f.size > 100 ||
            !Number.isFinite(f.frequency) ||
            !finite(f.real, f.size * f.size) ||
            !finite(f.imag, f.size * f.size) ||
            !finite(f.amplitude, f.size * f.size),
        ))
    )
      throw Error('입자 계산장이 손상되었습니다.');
  }
  if (data.active && configKey(data.active.config) !== configKey(data.config))
    throw Error('활성 실험 조건이 일치하지 않습니다.');
  return {
    config: data.config,
    records: data.records,
    ...(data.active ? { active: data.active } : {}),
    ...(data.extras ? { extras: data.extras } : {}),
  };
}
export function sweepCSV(s: Sweep) {
  return (
    'source,frequency_hz,relative_mass_rms_m\n' +
    s.points.map((p) => `FEM,${p.frequency},${p.rms}`).join('\n')
  );
}
export function particlesCSV(r: Run, time: number) {
  const f = frameAt(r, time);
  return (
    'source,time_s,id,species,diameter_m,mass_kg,x_m,y_m,distance_m\n' +
    r.species
      .map(
        (s, i) =>
          `approximation,${f.time},${i},${s},${r.diameters[i]},${r.masses[i]},${f.positions[i * 2] * r.config.plate.width},${f.positions[i * 2 + 1] * r.config.plate.height},${f.distance[i]}`,
      )
      .join('\n')
  );
}
