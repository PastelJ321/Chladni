import { useEffect, useRef, useState } from 'react';
import {
  cloneConfig,
  configKey,
  DEFAULT_CONFIG,
  validateConfig,
  plateKey,
  responseKey,
  sweepKey,
} from './config';
import type { Config, Field, ModalResult, RecordEntry, Run, Sweep } from './types';
import { SolverClient } from '../solver/client';
import type { JobKind } from '../solver/kernel';
import { responseField } from '../solver/response';
import { PlaybackClock } from '../simulation/clock';
export function useExperiment() {
  const [config, setConfig] = useState(() => cloneConfig(DEFAULT_CONFIG)),
    [modal, setModal] = useState<ModalResult | null>(null),
    [field, setField] = useState<Field | null>(null),
    [sweep, setSweep] = useState<Sweep | null>(null),
    [run, setRun] = useState<Run | null>(null),
    [records, setRecords] = useState<RecordEntry[]>([]);
  const [status, setStatus] = useState('스윕으로 공진점 찾기'),
    [progress, setProgress] = useState(0),
    [busy, setBusy] = useState(false),
    [busyKind, setBusyKind] = useState<JobKind | null>(null),
    [error, setError] = useState(''),
    [time, setDisplayTime] = useState(0),
    [playing, setPlayState] = useState(false),
    [speed, setRate] = useState(1);
  const client = useRef(new SolverClient()),
    clock = useRef(new PlaybackClock()),
    current = useRef(config),
    generation = useRef(0),
    pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopJob = () => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    generation.current++;
    client.current.cancel();
    setBusy(false);
    setBusyKind(null);
  };
  function setPlaying(p: boolean) {
    p ? clock.current.play() : clock.current.pause();
    setPlayState(p);
  }
  function setTime(t: number) {
    clock.current.seek(t);
    setDisplayTime(clock.current.sample());
  }
  function cancel() {
    stopJob();
    setPlaying(false);
    setStatus('중지됨');
  }
  async function request(kind: JobKind, c = current.current) {
    stopJob();
    setPlaying(false);
    const id = ++generation.current;
    setBusy(true);
    setBusyKind(kind);
    setError('');
    setProgress(0);
    setStatus(kind === 'run' ? '입자 계산 중' : kind === 'field' ? '응답 갱신 중' : '판 해석 중');
    try {
      const result = await client.current.request(kind, c, (stage, value) => {
        if (id === generation.current) {
          setStatus(stage);
          setProgress(value);
        }
      });
      if (id !== generation.current || configKey(c) !== configKey(current.current)) return;
      setModal(result.modal);
      setBusy(false);
      setBusyKind(null);
      setProgress(1);
      if (result.kind === 'run') {
        setRun(result.run);
        clock.current.duration = result.run.config.drive.duration;
        setTime(0);
        setPlaying(true);
        setStatus('입자 계산 완료');
      } else {
        setField(result.field);
        if (result.kind === 'solved') setSweep(result.sweep);
        setStatus('판 해석 완료');
      }
    } catch (e) {
      if (id !== generation.current) return;
      setBusy(false);
      setBusyKind(null);
      setError(String(e));
      setStatus('계산 오류');
    }
  }
  function change(next: Config) {
    try {
      validateConfig(next);
    } catch (e) {
      setError(String(e));
      return;
    }
    const prev = current.current;
    if (configKey(prev) === configKey(next)) {
      current.current = cloneConfig(next);
      setConfig(current.current);
      return;
    }
    stopJob();
    setPlaying(false);
    setError('');
    current.current = cloneConfig(next);
    setConfig(current.current);
    setRun(null);
    setTime(0);
    if (plateKey(prev.plate) !== plateKey(next.plate)) {
      setModal(null);
      setField(null);
      setSweep(null);
      setStatus('판 조건 변경 · 스윕 필요');
      return;
    }
    const responseChanged = responseKey(prev) !== responseKey(next),
      sweepChanged = sweepKey(prev) !== sweepKey(next);
    if (sweepChanged) setSweep(null);
    if (responseChanged) setField(null);
    if (modal && (responseChanged || sweepChanged || !field || !sweep)) {
      setBusy(true);
      setBusyKind('field');
      setStatus('응답 갱신 대기');
      pending.current = setTimeout(() => {
        pending.current = null;
        void request(sweepChanged || !sweep ? 'solve' : 'field', current.current);
      }, 160);
    } else setStatus(modal ? '입자 조건 변경 · 실행 준비' : '스윕으로 공진점 찾기');
  }
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
      client.current.dispose();
    },
    [],
  );
  useEffect(() => {
    if (!playing || !run) return;
    let raf = 0,
      last = 0,
      wasHidden = false;
    const visibility = () => {
      const now = performance.now();
      if (document.hidden && !wasHidden) clock.current.pause(now);
      if (!document.hidden && wasHidden) clock.current.play(now);
      wasHidden = document.hidden;
    };
    document.addEventListener('visibilitychange', visibility);
    visibility();
    const tick = (now: number) => {
      if (!document.hidden) {
        const t = clock.current.sample(now);
        if (now - last >= 32) {
          setDisplayTime(t);
          last = now;
        }
        if (t >= clock.current.duration) {
          clock.current.pause(now);
          setPlayState(false);
          setDisplayTime(t);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [playing, run]);
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
  function saveRecord(extra: Pick<RecordEntry, 'notes' | 'observations' | 'calibration'> = {}) {
    const r = snapshot();
    if (!r) return;
    if (records.length >= 20) {
      setError('기록은 최대 20개입니다. 파일로 저장하세요.');
      return;
    }
    setRecords((a) => [
      ...a,
      {
        ...r,
        ...extra,
        id: crypto.randomUUID(),
        name: `실험 ${String(a.length + 1).padStart(2, '0')}`,
      },
    ]);
  }
  function loadRecord(r: RecordEntry) {
    cancel();
    current.current = cloneConfig(r.config);
    setConfig(current.current);
    client.current.seed(r.modal);
    setModal(r.modal);
    setSweep(r.sweep);
    setRun(r.run);
    setField(responseField(r.modal, r.config));
    clock.current.duration = r.config.drive.duration;
    setTime(0);
    setStatus('기록 불러옴');
  }
  function loadConditions(next: Config) {
    validateConfig(next);
    stopJob();
    setPlaying(false);
    current.current = cloneConfig(next);
    setConfig(current.current);
    setModal(null);
    setField(null);
    setSweep(null);
    setRun(null);
    setError('');
    setProgress(0);
    clock.current.duration = next.drive.duration;
    setTime(0);
    setStatus('조건 불러옴 · 스윕 필요');
  }
  function selectFrequency(f: number) {
    const n = cloneConfig(current.current);
    n.drive.frequency = f;
    change(n);
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
    busyKind,
    error,
    time,
    setTime,
    playing,
    setPlaying,
    speed,
    setSpeed: (s: number) => {
      clock.current.speed(s);
      setRate(s);
    },
    cancel,
    solve: () => {
      void request('solve');
    },
    simulate: () => {
      void request('run');
    },
    saveRecord,
    snapshot,
    loadRecord,
    loadConditions,
    currentTime: () => clock.current.sample(),
    selectFrequency,
    clock: clock.current,
    cache: client.current.stats,
  };
}
export type Experiment = ReturnType<typeof useExperiment>;
