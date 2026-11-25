import { useEffect, useRef, useState } from 'react';
import type { Config } from '../experiment/types';
import { cloneConfig, configKey, plateKey } from '../experiment/config';
import {
  halfPowerDamping,
  type CalibrationParameter,
  type CalibrationReport,
  type ResonanceObservation,
} from '../solver/calibration';
import { download } from '../io/session';
interface Row {
  id: string;
  mode: string;
  frequency: string;
  role: 'fit' | 'validation';
  uncertainty: string;
  source?: string;
}
const row = (n: number): Row => ({
  id: crypto.randomUUID(),
  mode: String(n),
  frequency: '',
  role: n > 2 ? 'validation' : 'fit',
  uncertainty: '',
});
export function CalibrationPanel({
  config,
  onApply,
  onReport,
  storedReport,
}: {
  config: Config;
  onApply: (c: Config) => void;
  onReport?: (r: CalibrationReport) => void;
  storedReport?: CalibrationReport | null;
}) {
  const [rows, setRows] = useState<Row[]>(() => [row(1), row(2)]),
    [source, setSource] = useState(''),
    [parameter, setParameter] = useState<CalibrationParameter>('kz'),
    [lower, setLower] = useState(''),
    [upper, setUpper] = useState(''),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(''),
    [report, setReport] = useState<CalibrationReport | null>(null),
    [half, setHalf] = useState({ frequency: '', low: '', high: '' });
  const worker = useRef<Worker | null>(null),
    key = configKey(config),
    latest = useRef(key),
    file = useRef<HTMLInputElement>(null);
  latest.current = key;
  useEffect(() => {
    setReport(storedReport ?? null);
    if (storedReport) {
      setParameter(storedReport.parameter);
      setLower(String(storedReport.bounds[0]));
      setUpper(String(storedReport.bounds[1]));
      setRows(
        storedReport.errors.map((o) => ({
          id: o.id,
          mode: String(o.mode),
          frequency: String(o.frequency),
          role: o.role,
          uncertainty: o.uncertaintyHz === undefined ? '' : String(o.uncertaintyHz),
          source: o.source,
        })),
      );
      setSource(storedReport.errors[0]?.source ?? '');
    }
  }, [storedReport]);
  const cancel = () => {
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
  };
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    if (worker.current) {
      cancel();
      setError('조건이 변경되어 보정을 중단했습니다.');
    }
  }, [key]);
  const edit = (id: string, patch: Partial<Row>) =>
    setRows((all) => all.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  async function loadCSV(f?: File) {
    if (!f) return;
    try {
      if (f.size > 100000) throw Error('100 kB 이하 관측 CSV를 선택하세요.');
      const lines = (await f.text()).trim().split(/\r?\n/),
        header = lines.shift()!.replace(/\s/g, '');
      if (!['mode,frequency_hz,role', 'mode,frequency_hz,role,uncertainty_hz'].includes(header))
        throw Error('CSV 헤더: mode,frequency_hz,role,uncertainty_hz');
      const next = lines.map((line, i) => {
        const [mode, frequency, role, uncertainty = ''] = line.split(',').map((x) => x.trim());
        if (
          !mode ||
          !frequency ||
          !['fit', 'validation'].includes(role) ||
          !Number.isFinite(+frequency) ||
          +frequency <= 0
        )
          throw Error(`${i + 2}행의 관측값을 확인하세요.`);
        return {
          id: crypto.randomUUID(),
          mode,
          frequency,
          role: role as Row['role'],
          uncertainty,
          source: f.name,
        };
      });
      if (next.length > 100 || !next.length) throw Error('관측값은 1–100개를 입력하세요.');
      setRows(next);
      setSource((current) => (current.trim() ? current : f.name));
      setError('');
    } catch (e) {
      setError(String(e));
    }
  }
  function execute() {
    cancel();
    setError('');
    try {
      if (!lower.trim() || !upper.trim()) throw Error('강성 탐색 구간을 입력하세요.');
      if (rows.some((r) => !r.frequency.trim() || !r.mode.trim()))
        throw Error('빈 관측 행을 입력하거나 삭제하세요.');
      const observations: ResonanceObservation[] = rows.map((r) => ({
        id: r.id,
        mode: +r.mode,
        frequency: +r.frequency,
        role: r.role,
        ...(r.uncertainty ? { uncertaintyHz: +r.uncertainty } : {}),
        source:
          r.source && source.trim() && r.source !== source
            ? `${source} / ${r.source}`
            : (r.source ?? source),
      }));
      if (observations.some((o) => !o.source.trim())) throw Error('실측 자료의 출처를 입력하세요.');
      const origin = key,
        w = new Worker(new URL('../solver/calibrationWorker.ts', import.meta.url), {
          type: 'module',
        });
      worker.current = w;
      setBusy(true);
      setProgress(0);
      w.onmessage = (event) => {
        if (worker.current !== w || latest.current !== origin) return;
        const data = event.data;
        if (data.kind === 'progress') {
          setProgress(data.value);
          return;
        }
        cancel();
        if (data.kind === 'error') setError(data.message);
        else {
          setReport(data.result);
          onReport?.(data.result);
        }
      };
      w.onerror = () => {
        if (worker.current === w) {
          cancel();
          setError('보정 Worker를 실행하지 못했습니다.');
        }
      };
      w.postMessage({ config, parameter, bounds: [+lower, +upper], observations });
    } catch (e) {
      setError(String(e));
    }
  }
  function applyDamping() {
    try {
      if (!source.trim() || !Object.values(half).every((v) => v.trim()))
        throw Error('반전력 주파수와 자료 출처를 입력하세요.');
      const c = cloneConfig(config),
        frequency = +half.frequency,
        lowerHz = +half.low,
        upperHz = +half.high;
      c.plate.damping = halfPowerDamping(frequency, lowerHz, upperHz);
      c.plate.dampingSource = {
        method: 'half-power',
        frequency,
        lowerHz,
        upperHz,
        reference: source,
      };
      onApply(c);
      setError('');
    } catch (e) {
      setError(String(e));
    }
  }
  function applyPlate(plate: Config['plate']) {
    const c = cloneConfig(config);
    c.plate = structuredClone(plate);
    onApply(c);
  }
  return (
    <details className="calibration-panel">
      <summary>장치 응답 보정</summary>
      <p className="help">
        모드 번호를 직접 대응시킨 실측 주파수를 입력하세요. 강성 1개 변수만 보정하며 검증 행은
        계산에 사용하지 않습니다.
      </p>
      {!config.plate.connection && (
        <p className="help">강성 보정은 장치 프로필의 유연 연결부 설정이 필요합니다.</p>
      )}
      <label>
        자료 출처
        <input
          aria-label="보정 자료 출처"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="촬영·측정 기록 이름"
        />
      </label>
      <button onClick={() => file.current?.click()}>관측 주파수 CSV</button>
      <input
        hidden
        ref={file}
        type="file"
        accept=".csv"
        aria-label="보정 주파수 CSV"
        onChange={(e) => {
          void loadCSV(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <label>
        보정 변수
        <select
          aria-label="보정 변수"
          value={parameter}
          onChange={(e) => {
            setParameter(e.target.value as CalibrationParameter);
            setLower('');
            setUpper('');
          }}
        >
          <option value="kz">수직 강성 kz · N/m</option>
          <option value="rotationScale">두 회전 강성의 공통 배율</option>
        </select>
      </label>
      <div className="field-grid">
        <label>
          탐색 하한
          <input
            aria-label="강성 탐색 하한"
            type="number"
            value={lower}
            onChange={(e) => setLower(e.target.value)}
          />
        </label>
        <label>
          탐색 상한
          <input
            aria-label="강성 탐색 상한"
            type="number"
            value={upper}
            onChange={(e) => setUpper(e.target.value)}
          />
        </label>
      </div>
      <div className="calibration-rows">
        {rows.map((r) => (
          <div className="calibration-row" key={r.id}>
            <label>
              모드
              <input
                aria-label="관측 모드 번호"
                type="number"
                min="1"
                max="24"
                value={r.mode}
                onChange={(e) => edit(r.id, { mode: e.target.value })}
              />
            </label>
            <label>
              실측 Hz
              <input
                aria-label="관측 공진 주파수"
                type="number"
                value={r.frequency}
                onChange={(e) => edit(r.id, { frequency: e.target.value })}
              />
            </label>
            <label>
              불확도 ±Hz
              <input
                aria-label="주파수 불확도"
                type="number"
                value={r.uncertainty}
                onChange={(e) => edit(r.id, { uncertainty: e.target.value })}
                placeholder="미입력"
              />
            </label>
            <select
              aria-label="관측 용도"
              value={r.role}
              onChange={(e) => edit(r.id, { role: e.target.value as Row['role'] })}
            >
              <option value="fit">보정</option>
              <option value="validation">독립 검증</option>
            </select>
            <button
              aria-label="관측 행 삭제"
              onClick={() => setRows((all) => all.filter((v) => v.id !== r.id))}
            >
              삭제
            </button>
          </div>
        ))}
      </div>
      <button
        disabled={rows.length >= 100}
        onClick={() => setRows((all) => [...all, row(all.length + 1)])}
      >
        관측 행 추가
      </button>
      <button className="primary" disabled={busy || !config.plate.connection} onClick={execute}>
        강성 보정 계산
      </button>
      {busy && (
        <div role="status">
          보정 중 {Math.round(progress * 100)}% <button onClick={cancel}>보정 취소</button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {report && (
        <div className="calibration-result">
          <strong>
            보정값 {report.value.toPrecision(5)} {report.parameter === 'kz' ? 'N/m' : '×'}
          </strong>
          <p>
            보정 RMS {(report.trainingRmsRelative * 100).toFixed(2)}% · 검증{' '}
            {report.validationRmsRelative === null
              ? '자료 없음'
              : (report.validationRmsRelative * 100).toFixed(2) + '%'}
          </p>
          {report.boundaryOptimum && (
            <p className="help">탐색 경계의 해입니다. 범위와 식별 가능성을 다시 확인하세요.</p>
          )}
          <div className="calibration-table">
            <table>
              <thead>
                <tr>
                  <th>용도</th>
                  <th>모드</th>
                  <th>실측 Hz</th>
                  <th>원래 오차 Hz</th>
                  <th>보정 오차 Hz</th>
                  <th>보정 오차 %</th>
                </tr>
              </thead>
              <tbody>
                {report.errors.map((r) => (
                  <tr key={r.id}>
                    <td>{r.role === 'fit' ? '보정' : '검증'}</td>
                    <td>{r.mode}</td>
                    <td>{r.frequency}</td>
                    <td>{r.beforeErrorHz.toFixed(2)}</td>
                    <td>{r.afterErrorHz.toFixed(2)}</td>
                    <td>{(r.afterRelative * 100).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            disabled={key !== report.originalKey}
            onClick={() => applyPlate(report.calibrated.plate)}
          >
            보정 모델 적용
          </button>
          <button
            disabled={
              ![plateKey(report.original.plate), plateKey(report.calibrated.plate)].includes(
                plateKey(config.plate),
              )
            }
            onClick={() => applyPlate(report.original.plate)}
          >
            원래 모델 복원
          </button>
          <button
            onClick={() => download(JSON.stringify(report, null, 2), 'chladni-calibration.json')}
          >
            보정 근거 JSON
          </button>
          <p className="help">
            오차 = 계산 − 실측. 불확도 입력 시 역분산 가중, 미입력은 상대 오차로 평가합니다.
            고유모드 번호와 공진 피크의 대응은 자동 검증하지 않습니다.
          </p>
        </div>
      )}
      <details>
        <summary>고립 공진의 감쇠 추정</summary>
        <p className="help">
          진폭이 정점의 1/√2인 양쪽 주파수로 ζ≈(f₂−f₁)/(2f₀). 약한 감쇠의 고립된 단일 모드에만
          사용하세요.
        </p>
        {(
          [
            ['frequency', '정점 f₀'],
            ['low', '하측 f₁'],
            ['high', '상측 f₂'],
          ] as const
        ).map(([id, label]) => (
          <label key={id}>
            {label} Hz
            <input
              aria-label={label}
              type="number"
              value={half[id]}
              onChange={(e) => setHalf({ ...half, [id]: e.target.value })}
            />
          </label>
        ))}
        <button onClick={applyDamping}>근사 감쇠비 적용</button>
      </details>
    </details>
  );
}
