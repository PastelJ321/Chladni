import { useEffect, useRef, useState } from 'react';
import { cloneConfig, configKey, DEFAULT_CONFIG, validateConfig } from './config';
import type { Config, Field, ModalResult, RecordEntry, Run, Sweep } from './types';
export function useExperiment() {
  const [config, setConfig] = useState(() => cloneConfig(DEFAULT_CONFIG)),
    [modal, setModal] = useState<ModalResult | null>(null),
    [field, setField] = useState<Field | null>(null),
    [sweep, setSweep] = useState<Sweep | null>(null),
    [run, setRun] = useState<Run | null>(null),
    [records, setRecords] = useState<RecordEntry[]>([]);
  const [status, setStatus] = useState('계산 전'),
    [progress, setProgress] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1);
  const worker = useRef<Worker | null>(null),
    job = useRef(0),
    current = useRef(config);
  current.current = config;
  function cancel() {
    worker.current?.terminate();
    worker.current = null;
    job.current++;
    setBusy(false);
    setPlaying(false);
    setStatus('중지됨');
  }
  function request(kind: 'solve' | 'run', c = config) {
    cancel();
    const id = ++job.current;
    const w = new Worker(new URL('../solver/worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setBusy(true);
    setError('');
    setProgress(0);
    setStatus(kind === 'solve' ? '판 해석 중' : '입자 계산 중');
    w.onerror = () => {
      if (job.current === id) {
        setError('계산 작업을 시작하지 못했습니다.');
        setBusy(false);
      }
    };
    w.onmessage = (event) => {
      const data = event.data;
      if (data.id !== job.current || configKey(c) !== configKey(current.current)) return;
      if (data.kind === 'progress') {
        setStatus(data.stage);
        setProgress(data.value);
        return;
      }
      setBusy(false);
      setProgress(1);
      if (data.kind === 'error') {
        setError(data.message);
        setStatus('계산 중단');
        return;
      }
      if (data.kind === 'solved') {
        setModal(data.modal);
        setField(data.field);
        setSweep(data.sweep);
        setStatus('판 해석 완료');
      }
      if (data.kind === 'run') {
        setRun(data.run);
        setTime(0);
        setPlaying(true);
        setStatus('입자 계산 완료');
      }
      w.terminate();
      worker.current = null;
    };
    w.postMessage({ id, kind, config: c });
  }
  function change(next: Config) {
    try {
      validateConfig(next);
    } catch (err) {
      setError(String(err));
      return;
    }
    cancel();
    setError('');
    setConfig(cloneConfig(next));
    setField(null);
    setSweep(null);
    setModal(null);
    setRun(null);
    setTime(0);
    setStatus('조건 변경 · 재계산 필요');
  }
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    if (!playing || !run) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      if (document.hidden) {
        last = now;
        raf = requestAnimationFrame(tick);
        return;
      }
      const delta = Math.min(0.1, (now - last) / 1000) * speed;
      last = now;
      setTime((t) => {
        const next = Math.min(run.config.drive.duration, t + delta);
        if (next >= run.config.drive.duration) setPlaying(false);
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, run, speed]);
  function saveRecord() {
    if (!modal || !sweep) return;
    if (records.length >= 20) {
      setError('세션 내 실험 기록은 최대 20개입니다. JSON 저장 후 새 세션을 사용하세요.');
      return;
    }
    setRecords((r) => [
      ...r,
      {
        id: crypto.randomUUID(),
        name: `실험 ${String(r.length + 1).padStart(2, '0')}`,
        config: cloneConfig(config),
        modal,
        sweep,
        run,
        created: new Date().toISOString(),
      },
    ]);
  }
  function snapshot(): RecordEntry | null {
    return modal && sweep
      ? {
          id: 'active',
          name: '저장 시점 실험',
          config: cloneConfig(config),
          modal,
          sweep,
          run,
          created: new Date().toISOString(),
        }
      : null;
  }
  function loadRecord(r: RecordEntry) {
    cancel();
    setConfig(cloneConfig(r.config));
    setModal(r.modal);
    setSweep(r.sweep);
    setRun(r.run);
    setField(r.run?.fields[0] ?? null);
    setTime(0);
    setStatus('기록 불러옴 · 판 해석으로 장 갱신');
  }
  function selectFrequency(f: number) {
    const next = cloneConfig(config);
    next.drive.frequency = f;
    change(next);
    current.current = next;
    request('solve', next);
  }
  return {
    config,
    change,
    modal,
    field,
    sweep,
    run,
    records,
    setRecords,
    status,
    progress,
    busy,
    error,
    time,
    setTime,
    playing,
    setPlaying,
    speed,
    setSpeed,
    cancel,
    solve: () => request('solve'),
    simulate: () => request('run'),
    saveRecord,
    snapshot,
    loadRecord,
    selectFrequency,
  };
}
export type Experiment = ReturnType<typeof useExperiment>;
