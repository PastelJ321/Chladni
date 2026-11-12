import type { Config, RecordEntry, Run, Sweep } from '../experiment/types';
import { validateConfig, configKey } from '../experiment/config';
export function download(data: Blob | string, name: string, type = 'application/json') {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function encodeSession(config: Config, records: RecordEntry[], active?: RecordEntry | null) {
  return JSON.stringify(
    {
      schema: 'chladni/2',
      config,
      records,
      ...(active ? { active } : {}),
      provenance: {
        plate: 'BFS Kirchhoff-Love FEM',
        particles: 'cycle-averaged approximation',
        calibrated: false,
      },
    },
    null,
    2,
  );
}
export function decodeSession(raw: string): {
  config: Config;
  records: RecordEntry[];
  active?: RecordEntry;
} {
  const data = JSON.parse(raw);
  if (data.schema !== 'chladni/2') throw Error('지원하지 않는 세션 형식입니다.');
  validateConfig(data.config);
  if (!Array.isArray(data.records) || data.records.length > 20)
    throw Error('기록 목록이 올바르지 않습니다.');
  for (const r of [...data.records, ...(data.active ? [data.active] : [])]) {
    validateConfig(r.config);
    if (
      r.modal?.source !== 'FEM' ||
      r.sweep?.source !== 'FEM' ||
      !Array.isArray(r.modal.frequencies) ||
      !r.modal.frequencies.every((v: number) => Number.isFinite(v) && v > 0) ||
      r.modal.key !== JSON.stringify(r.config.plate)
    )
      throw Error('해석 기록이 손상되었습니다.');
    const finite = (a: unknown, len?: number): a is number[] =>
      Array.isArray(a) &&
      (len === undefined || a.length === len) &&
      a.every((v) => Number.isFinite(v));
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
          (f: { positions: number[] }) =>
            !Array.isArray(f.positions) ||
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
          (f: { time: number; distance: unknown }) =>
            !Number.isFinite(f.time) || !finite(f.distance, r.config.grains.count),
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
  };
}
export function sweepCSV(s: Sweep) {
  return (
    'source,frequency_hz,relative_mass_rms_m\n' +
    s.points.map((p) => `FEM,${p.frequency},${p.rms}`).join('\n')
  );
}
export function particlesCSV(r: Run, time: number) {
  const f = r.frames.reduce((a, b) => (Math.abs(b.time - time) < Math.abs(a.time - time) ? b : a));
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
