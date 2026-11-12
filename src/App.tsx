import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Download,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Square,
  X,
  Layers,
  SlidersHorizontal,
  FlaskConical,
  ChartNoAxesCombined,
  BookOpen,
  Presentation,
  ChevronRight,
} from 'lucide-react';
import { useExperiment } from './experiment/useExperiment';
import { DEFAULT_VIEW, cloneConfig } from './experiment/config';
import type { Field, ViewSettings, Workspace } from './experiment/types';
import { ConfigurationPanel } from './ui/ConfigurationPanel';
import { AnalysisPanel } from './ui/AnalysisPanel';
import { ResponsePlot, type MeasuredPoint } from './ui/ResponsePlot';
import { StructureTools } from './ui/StructureTools';
import { LabViewport } from './render/LabViewport';
import { LabRenderer, type RenderData } from './render/LabRenderer';
import { layerLabels } from './render/layers';
import { responseField } from './solver/response';
import { sampleMode } from './solver/modal';
import { decodeSession, download, encodeSession, particlesCSV, sweepCSV } from './io/session';
import { PARTS } from './concept/catalog';
import { densityGrid } from './analysis/metrics';
import { fieldAtRun } from './simulation/particles';

const spaces: { id: Workspace; label: string; icon: typeof Camera }[] = [
  { id: 'design', label: '실험 설계', icon: SlidersHorizontal },
  { id: 'simulate', label: '가상실험', icon: FlaskConical },
  { id: 'analyze', label: '결과 분석', icon: ChartNoAxesCombined },
  { id: 'structure', label: '장비 구조', icon: Layers },
  { id: 'records', label: '연구 기록', icon: BookOpen },
  { id: 'present', label: '발표', icon: Presentation },
];
export default function App() {
  const e = useExperiment(),
    [space, setSpace] = useState<Workspace>('design'),
    [view, setView] = useState<ViewSettings>(DEFAULT_VIEW),
    [paint, setPaint] = useState(false),
    [animate, setAnimate] = useState(false),
    [comparison, setComparison] = useState(''),
    [toast, setToast] = useState(''),
    [mobile, setMobile] = useState(false),
    [about, setAbout] = useState(false);
  const [media, setMedia] = useState<{ url: string; name: string; type: string } | null>(null),
    [opacity, setOpacity] = useState(0.6),
    [sync, setSync] = useState(false),
    [offset, setOffset] = useState(0),
    [measuredHz, setMeasuredHz] = useState(''),
    [measured, setMeasured] = useState<MeasuredPoint[]>([]),
    [measuredName, setMeasuredName] = useState('');
  const api = useRef<LabRenderer | null>(null),
    sessionInput = useRef<HTMLInputElement>(null),
    mediaInput = useRef<HTMLInputElement>(null),
    csvInput = useRef<HTMLInputElement>(null),
    video = useRef<HTMLVideoElement>(null),
    savedView = useRef(view),
    configRef = useRef(e.config),
    dialog = useRef<HTMLDialogElement>(null);
  configRef.current = e.config;
  const previousSpace = useRef<Workspace>('simulate'),
    pose = useRef<ReturnType<LabRenderer['rig']['pose']> | null>(null),
    [bookmark, setBookmark] = useState<ReturnType<LabRenderer['rig']['pose']> | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (about) dialog.current?.showModal();
    else dialog.current?.close();
  }, [about]);
  useEffect(
    () => () => {
      if (media) URL.revokeObjectURL(media.url);
    },
    [media],
  );
  useEffect(() => {
    if (sync && video.current && Number.isFinite(video.current.duration))
      video.current.currentTime = Math.max(0, Math.min(video.current.duration, e.time + offset));
  }, [e.time, offset, sync]);
  useEffect(() => {
    if (space !== 'structure' || view.structure !== 'assembly' || !animate) return;
    const t = setInterval(
      () => setView((v) => ({ ...v, assembly: Math.min(1, v.assembly + 0.015 * e.speed) })),
      50,
    );
    return () => clearInterval(t);
  }, [space, view.structure, animate, e.speed]);
  function changeSpace(s: Workspace) {
    if (s === 'present') {
      savedView.current = view;
      previousSpace.current = space;
      pose.current = api.current?.rig.pose() ?? null;
      setAnimate(false);
    } else if (space === 'present') {
      setView(savedView.current);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (pose.current) api.current?.rig.restore(pose.current);
        }),
      );
    }
    setSpace(s);
    setMobile(false);
  }
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        if (space === 'present') changeSpace(previousSpace.current);
        setMobile(false);
      }
      if ((ev.target as HTMLElement).matches('input,select,textarea,button') || about) return;
      if (ev.code === 'Space') {
        ev.preventDefault();
        if (e.run) e.setPlaying(!e.playing);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  const displayField = useMemo(() => {
    if (!view.showMode || !e.modal) return e.run ? fieldAtRun(e.run, e.time) : e.field;
    const size = 41,
      real: number[] = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        real.push(
          sampleMode(
            e.modal,
            Math.min(view.mode, e.modal.frequencies.length - 1),
            x / (size - 1),
            y / (size - 1),
          ),
        );
    const peak = Math.max(...real.map(Math.abs));
    return {
      source: 'FEM',
      key: e.modal.key,
      size,
      real: real.map((v) => (v / peak) * 1e-6),
      imag: real.map(() => 0),
      amplitude: real.map((v) => Math.abs(v / peak) * 1e-6),
      peak: 1e-6,
      frequency: e.modal.frequencies[view.mode],
    } as Field;
  }, [
    view.showMode,
    view.mode,
    e.modal,
    e.field,
    e.run,
    e.time,
    e.config.drive.signal,
    e.config.drive.duration,
  ]);
  const units = view.layer === 'velocity' ? 'm/s' : view.layer === 'acceleration' ? 'm/s²' : 'µm';
  const legendMax = displayField
    ? displayField.peak *
      (view.layer === 'velocity'
        ? 2 * Math.PI * displayField.frequency
        : view.layer === 'acceleration'
          ? (2 * Math.PI * displayField.frequency) ** 2
          : 1e6)
    : 0;
  const densityMax =
    view.layer === 'density'
      ? Math.max(
          0,
          ...densityGrid(
            e.run
              ? e.run.frames[Math.min(e.run.frames.length - 1, Math.round(e.time / 0.05))].positions
              : [],
          ),
        )
      : 0;
  const compareRecord = e.records.find((r) => r.id === comparison);
  const compareField = useMemo(
    () => (compareRecord ? responseField(compareRecord.modal, compareRecord.config) : null),
    [compareRecord],
  );
  const base: RenderData = {
    config: e.config,
    modal: e.modal,
    field: displayField,
    run: e.run,
    time: e.time,
    view,
    animate,
    paint,
  };
  const renderData: RenderData =
    comparison === 'before' && e.run
      ? { ...base, time: 0, compare: { ...base, time: e.time } }
      : compareRecord
        ? {
            ...base,
            compare: {
              ...base,
              config: compareRecord.config,
              modal: compareRecord.modal,
              field: compareRecord.run
                ? fieldAtRun(
                    compareRecord.run,
                    Math.min(e.time, compareRecord.config.drive.duration),
                  )
                : compareField,
              run: compareRecord.run,
              time: Math.min(e.time, compareRecord.config.drive.duration),
            },
          }
        : base;
  const onPaint = (point: [number, number]) => {
    const c = cloneConfig(configRef.current);
    c.grains.distribution = 'paint';
    c.grains.spots = [...c.grains.spots, point].slice(-200);
    e.change(c);
  };
  async function capture() {
    const blob = await api.current?.capture();
    if (blob) {
      download(blob, 'chladni-v02.png');
      setToast('3D 장면 PNG 저장 완료');
    }
  }
  async function loadSession(file?: File) {
    if (!file) return;
    try {
      if (file.size > 60 * 1024 * 1024) throw Error('60 MB 이하의 세션을 선택하세요.');
      const data = decodeSession(await file.text());
      if (data.active) e.loadRecord(data.active);
      else e.change(data.config);
      e.setRecords(data.records);
      setToast('세션을 불러왔습니다. 판 해석으로 장을 갱신하세요.');
    } catch (err) {
      setToast(String(err));
    }
  }
  function loadMedia(file?: File) {
    if (!file) return;
    if (
      !/^(image\/(png|jpeg|webp)|video\/(mp4|webm|quicktime))$/.test(file.type) ||
      file.size > 250 * 1024 * 1024
    ) {
      setToast('250 MB 이하 이미지 또는 영상을 선택하세요.');
      return;
    }
    setMedia({ url: URL.createObjectURL(file), name: file.name, type: file.type });
  }
  async function loadMeasured(file?: File) {
    if (!file) return;
    try {
      const rows = (await file.text()).trim().split(/\r?\n/);
      if (rows[0].replace(/\s/g, '') !== 'frequency_hz,amplitude_um')
        throw Error('CSV 헤더: frequency_hz,amplitude_um');
      const points = rows
        .slice(1)
        .map((row) => {
          const [f, a] = row.split(',').map(Number);
          if (!Number.isFinite(f) || !Number.isFinite(a) || f <= 0 || a < 0)
            throw Error('실측 CSV 수치를 확인하세요.');
          return { frequency: f, amplitude: a * 1e-6 };
        })
        .sort((a, b) => a.frequency - b.frequency);
      setMeasured(points);
      setMeasuredName(file.name);
    } catch (err) {
      setToast(String(err));
    }
  }
  function extractFrame() {
    const v = video.current;
    if (!v) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext('2d')?.drawImage(v, 0, 0);
      canvas.toBlob((b) => {
        if (b) download(b, `measured-frame-${v.currentTime.toFixed(2)}s.png`);
      });
    } catch {
      setToast('이 영상의 프레임을 읽을 수 없습니다.');
    }
  }
  return (
    <div className={`laboratory ${space === 'present' ? 'presenting' : ''}`}>
      <header className="app-header">
        <div className="wordmark">
          Chladni <span>0.2</span>
          <small>by QuadraJ</small>
        </div>
        <div className="project-name">
          사각 진동판 실험<span>로컬 세션</span>
        </div>
        <div className="file-actions">
          <button onClick={() => sessionInput.current?.click()}>불러오기</button>
          <button
            onClick={() =>
              download(encodeSession(e.config, e.records, e.snapshot()), 'chladni-session-v2.json')
            }
          >
            <Download size={14} />
            JSON 저장
          </button>
          <button onClick={() => setAbout(true)}>모델 안내</button>
        </div>
      </header>
      <nav className="workspace-nav" aria-label="작업 공간">
        {spaces.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            aria-current={space === id ? 'page' : undefined}
            onClick={() => changeSpace(id)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
        <span className="nav-detail">
          BFS / Kirchhoff–Love <span>판 FEM · 입자 근사</span>
        </span>
      </nav>
      <div className="lab-layout">
        <div className={`settings-slot ${mobile ? 'mobile-open' : ''}`}>
          <button className="close-mobile" onClick={() => setMobile(false)} aria-label="설정 닫기">
            <X size={18} />
          </button>
          <ConfigurationPanel e={e} paint={paint} setPaint={setPaint} />
        </div>
        <main className="experiment-main">
          <div className="experiment-toolbar">
            <div>
              <span className="breadcrumb">
                실험 01 <ChevronRight size={12} /> {spaces.find((s) => s.id === space)?.label}
              </span>
              <h1>
                {space === 'design'
                  ? '실험을 구성하세요'
                  : space === 'simulate'
                    ? '진동과 입자 운동'
                    : space === 'analyze'
                      ? '계산 결과 분석'
                      : space === 'structure'
                        ? '장비의 연결 구조'
                        : space === 'records'
                          ? '기록과 실측 비교'
                          : '실험 발표'}
              </h1>
            </div>
            <div className="toolbar-actions">
              <button className="mobile-settings" onClick={() => setMobile(true)}>
                실험 조건
              </button>
              <button
                disabled={!e.modal || !e.sweep || e.busy}
                onClick={() => {
                  e.saveRecord();
                  setToast('조건과 계산 결과를 세션에 기록했습니다.');
                }}
              >
                실험 기록
              </button>
              <button
                className="primary"
                disabled={!e.modal || !e.field || e.busy}
                onClick={e.simulate}
              >
                <FlaskConical size={14} />
                입자 실험 실행
              </button>
            </div>
          </div>
          <section className="stage" aria-label="가상 실험실">
            <LabViewport
              data={renderData}
              api={api}
              onSelect={(id) => setView((v) => ({ ...v, selected: id }))}
              onPaint={onPaint}
            />
            <div className="stage-top">
              <span className="glass source-chip">
                {e.modal ? 'FEM 계산 결과' : '설계 미리보기'}
                <i />
                {view.showMode ? '고유모드 · 1 µm 정규화' : '강제응답'}
                {e.run && ' · 입자 근사'}
              </span>
              <span className="scene-dimensions">
                {(e.config.plate.width * 1000).toFixed(0)} ×{' '}
                {(e.config.plate.height * 1000).toFixed(0)} ×{' '}
                {(e.config.plate.thickness * 1000).toFixed(1)} mm <span>설계값</span>
              </span>
            </div>
            {paint && (
              <div className="paint-hint glass">
                판 위를 클릭해 입자를 뿌리세요 · {e.config.grains.spots.length}개 영역
              </div>
            )}
            {comparison && (
              <>
                <div className="compare-divider" />
                <span className="compare-caption left glass">
                  {comparison === 'before' ? '초기 상태' : '현재 실험'}
                </span>
                <span className="compare-caption right glass">
                  {comparison === 'before' ? '현재 시점' : compareRecord?.name}
                </span>
              </>
            )}
            {space === 'structure' && (
              <div className="floating-structure glass">
                <StructureTools view={view} setView={setView} />
              </div>
            )}
            {media && space === 'records' && (
              <div className="media-overlay" style={{ opacity }}>
                {media.type.startsWith('video/') ? (
                  <video ref={video} src={media.url} controls playsInline />
                ) : (
                  <img src={media.url} alt={`실측 기록 ${media.name}`} />
                )}
                <span>
                  실측 기록 · {media.name} {measuredHz && `${measuredHz} Hz`}
                </span>
              </div>
            )}
            <div className="stage-bottom">
              <div className="glass camera-bar">
                <button
                  onClick={() => {
                    setView((v) => ({ ...v, camera: 'hero' }));
                    api.current?.rig.preset('hero');
                  }}
                >
                  전경
                </button>
                <button
                  onClick={() => {
                    setView((v) => ({ ...v, camera: 'top' }));
                    api.current?.rig.preset('top');
                  }}
                >
                  수직
                </button>
                <button
                  onClick={() => {
                    setView((v) => ({ ...v, camera: 'macro' }));
                    api.current?.rig.preset('macro');
                  }}
                >
                  접사
                </button>
                <span />
                <button onClick={capture} aria-label="고해상도 PNG 저장">
                  <Camera size={16} />
                </button>
                <button
                  onClick={() => {
                    document.documentElement
                      .requestFullscreen?.()
                      .catch(() => setToast('화면 내 발표 모드를 사용하세요.'));
                  }}
                  aria-label="전체 화면"
                >
                  <Maximize2 size={15} />
                </button>
              </div>
              <div className="glass layer-bar">
                <select
                  aria-label="시각화 레이어"
                  value={view.layer}
                  onChange={(ev) =>
                    setView({ ...view, layer: ev.target.value as ViewSettings['layer'] })
                  }
                >
                  {Object.entries(layerLabels).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {displayField && view.layer !== 'material' && (
              <div className="physical-legend">
                <span>
                  {view.layer === 'contour'
                    ? 'Re(u)=0 · |u|=30%,65%'
                    : view.layer === 'density'
                      ? `0–${densityMax}개 / 셀`
                      : `${view.layer === 'displacement' ? '±' : '0–'}${legendMax.toPrecision(3)} ${units}`}
                </span>
                <i />
              </div>
            )}
            <div className="stage-scale">
              표시 배율 ×{view.gain} · {animate ? '연출 0.5 Hz' : '정지 위상'}
              {view.layer === 'velocity'
                ? ' · m/s'
                : view.layer === 'acceleration'
                  ? ' · m/s²'
                  : view.layer === 'density'
                    ? ' · 셀별 입자 수'
                    : ' · 변위 m'}
              <br />
              구동부는 개념 기구 모델
            </div>
            {view.selected && (
              <div className="part-popover glass">
                <button
                  onClick={() => setView({ ...view, selected: null })}
                  aria-label="부품 정보 닫기"
                >
                  <X size={13} />
                </button>
                <strong>{PARTS.find((p) => p.id === view.selected)?.label ?? view.selected}</strong>
                <p>{PARTS.find((p) => p.id === view.selected)?.detail}</p>
              </div>
            )}
            {e.busy && (
              <div className="compute-overlay glass" role="status">
                {e.status}
                <progress value={e.progress} max="1" />
                {Math.round(e.progress * 100)}%<button onClick={e.cancel}>계산 취소</button>
              </div>
            )}
          </section>
          <div className="simulation-controls">
            <button
              className="play-control"
              disabled={!e.run}
              aria-label={e.playing ? '일시정지' : '재생'}
              onClick={() => {
                if (e.time >= e.config.drive.duration) e.setTime(0);
                e.setPlaying(!e.playing);
              }}
            >
              {e.playing ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <button
              aria-label="완전 정지"
              onClick={() => {
                e.cancel();
                e.setTime(0);
              }}
            >
              <Square size={14} />
            </button>
            <button
              aria-label="초기화"
              onClick={() => {
                e.setPlaying(false);
                e.setTime(0);
              }}
            >
              <RotateCcw size={14} />
            </button>
            <span className="time-value">
              {e.time.toFixed(2)} <small>/ {e.config.drive.duration.toFixed(1)} s</small>
            </span>
            <input
              aria-label="실험 시간"
              type="range"
              min="0"
              max={e.config.drive.duration}
              step=".05"
              value={e.time}
              disabled={!e.run}
              onChange={(ev) => {
                e.setPlaying(false);
                e.setTime(+ev.target.value);
              }}
            />
            <select
              aria-label="재생 속도"
              value={e.speed}
              onChange={(ev) => e.setSpeed(+ev.target.value)}
            >
              {[0.25, 0.5, 1, 2].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
            <button className={animate ? 'active' : ''} onClick={() => setAnimate(!animate)}>
              변형 애니메이션
            </button>
          </div>
          <div className="analysis-toolbar">
            <label>
              <input
                type="checkbox"
                checked={view.particles}
                onChange={(ev) => setView({ ...view, particles: ev.target.checked })}
              />{' '}
              입자 표시
            </label>
            <label>
              변위 확대
              <input
                aria-label="변위 확대 배율"
                type="range"
                min="0"
                max="4000"
                step="50"
                value={view.gain}
                onChange={(ev) => setView({ ...view, gain: +ev.target.value })}
              />
            </label>
            <select
              aria-label="렌더 품질"
              value={view.quality}
              onChange={(ev) =>
                setView({ ...view, quality: ev.target.value as ViewSettings['quality'] })
              }
            >
              <option value="standard">표준 품질</option>
              <option value="low">저사양 · DPR 1</option>
            </select>
            <button
              disabled={!e.sweep}
              onClick={() => {
                if (e.sweep) download(sweepCSV(e.sweep), 'frequency-response.csv', 'text/csv');
              }}
            >
              응답 CSV
            </button>
            <button
              disabled={!e.run}
              onClick={() => {
                if (e.run) download(particlesCSV(e.run, e.time), 'particles.csv', 'text/csv');
              }}
            >
              입자 CSV
            </button>
          </div>
          <ResponsePlot
            sweep={e.sweep}
            frequency={e.config.drive.frequency}
            measured={measured}
            onSelect={(f) => {
              setView((v) => ({ ...v, showMode: false }));
              e.selectFrequency(f);
            }}
          />
          {space === 'records' && (
            <section className="research-records">
              <div>
                <h2>세션 내 실험 기록</h2>
                <button disabled={!e.modal || !e.sweep} onClick={e.saveRecord}>
                  실험 복제 · 기록
                </button>
                <select
                  aria-label="조건 비교"
                  value={comparison}
                  onChange={(ev) => setComparison(ev.target.value)}
                >
                  <option value="">단일 실험</option>
                  <option value="before" disabled={!e.run}>
                    초기 / 현재
                  </option>
                  {e.records.map((r) => (
                    <option key={r.id} value={r.id}>
                      현재 / {r.name}
                    </option>
                  ))}
                </select>
              </div>
              {e.records.map((r) => (
                <div className="record-row" key={r.id}>
                  <span>{r.name}</span>
                  <span>
                    {r.config.drive.frequency.toFixed(1)} Hz ·{' '}
                    {(r.config.plate.thickness * 1000).toFixed(1)} mm
                  </span>
                  <span>FEM / 입자 근사</span>
                  <button onClick={() => e.loadRecord(r)}>불러오기</button>
                </div>
              ))}
              <div className="media-tools">
                <button onClick={() => mediaInput.current?.click()}>사진·영상 불러오기</button>
                <label>
                  실측 주파수
                  <input
                    aria-label="실측 주파수"
                    type="number"
                    value={measuredHz}
                    onChange={(ev) => setMeasuredHz(ev.target.value)}
                  />
                </label>
                <label>
                  중첩 불투명도
                  <input
                    aria-label="중첩 불투명도"
                    type="range"
                    min="0"
                    max="1"
                    step=".05"
                    value={opacity}
                    onChange={(ev) => setOpacity(+ev.target.value)}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={sync}
                    onChange={(ev) => setSync(ev.target.checked)}
                  />
                  영상 시간 동기화
                </label>
                <label>
                  오프셋 s
                  <input
                    type="number"
                    value={offset}
                    step=".1"
                    onChange={(ev) => setOffset(+ev.target.value)}
                  />
                </label>
                <button disabled={!media?.type.startsWith('video/')} onClick={extractFrame}>
                  관찰 프레임 저장
                </button>
                <button onClick={() => csvInput.current?.click()}>실측 응답 CSV</button>
              </div>
              <p className="help">
                기록 출처: 사용자 로컬 파일. 영상 동기화는 현재 실험 시간 + 오프셋입니다.
                원근·모서리 정합과 자동 파라미터 보정은 지원하지 않습니다.{' '}
                {measuredName &&
                  `실측 곡선: ${measuredName} · 점 측정과 FEM의 질량 RMS는 서로 다른 관측량일 수 있습니다.`}
              </p>
            </section>
          )}
        </main>
        <AnalysisPanel e={e} view={view} setView={setView} />
      </div>
      <footer className="app-footer">
        <span>CHLADNI · QUADRAJ</span>
        <span>
          판: FEM 계산 <i />
          입자: 근사 모델
          <i />
          실측 보정 전
        </span>
        <span>세션과 실험 기록은 JSON으로 저장하세요.</span>
      </footer>
      {space === 'present' && (
        <div className="presentation-controls glass">
          <button onClick={() => changeSpace(previousSpace.current)}>
            <X size={15} />
            발표 종료
          </button>
          <button
            onClick={() =>
              setView({
                ...view,
                structure: view.structure === 'exploded' ? 'assembled' : 'exploded',
              })
            }
          >
            분해 / 조립
          </button>
          <button onClick={() => setView({ ...view, structure: 'section' })}>단면</button>
          <button onClick={() => setView({ ...view, structure: 'ghost' })}>투시</button>
          <button onClick={() => setAnimate(!animate)}>
            {animate ? '연출 정지' : '진동 확대'}
          </button>
          <button onClick={() => setView({ ...view, layer: 'contour' })}>마디</button>
          <button onClick={() => setView({ ...view, layer: 'trace' })}>궤적</button>
          <button onClick={() => setBookmark(api.current?.rig.pose() ?? null)}>시점 저장</button>
          <button
            disabled={!bookmark}
            onClick={() => {
              if (bookmark) api.current?.rig.restore(bookmark);
            }}
          >
            북마크
          </button>
          <button onClick={capture}>PNG</button>
        </div>
      )}
      <input
        hidden
        ref={sessionInput}
        aria-label="세션 파일"
        type="file"
        accept=".json"
        onChange={(ev) => {
          void loadSession(ev.target.files?.[0]);
          ev.target.value = '';
        }}
      />
      <input
        hidden
        ref={mediaInput}
        aria-label="실측 미디어 파일"
        type="file"
        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
        onChange={(ev) => loadMedia(ev.target.files?.[0])}
      />
      <input
        hidden
        ref={csvInput}
        type="file"
        accept=".csv"
        onChange={(ev) => void loadMeasured(ev.target.files?.[0])}
      />
      {toast && (
        <div role="status" className="toast">
          {toast}
        </div>
      )}
      <dialog ref={dialog} onClose={() => setAbout(false)}>
        <button
          className="dialog-close"
          onClick={() => setAbout(false)}
          aria-label="모델 안내 닫기"
        >
          <X size={18} />
        </button>
        <h2>계산 모델과 출처</h2>
        <h3>판 · FEM</h3>
        <p>
          Kirchhoff–Love 얇은 판, 16자유도 BFS 직사각형 요소, 일관 질량 행렬과 4×4 Gauss 적분을
          사용합니다. Kφ = ω²Mφ를 풀고, 질량 정규화된 24모드를 구동점 참여도와 감쇠로 합성합니다.
          중앙 고정 위치는 메시 절점에 맞춥니다.
        </p>
        <h3>입자 · 근사</h3>
        <p>
          판의 가속도/중력 비가 1 이하이면 이동을 유발하지 않습니다. 진폭² 기울기에 대한 경험적
          이동, 마찰·형태 계수와 Stokes 완화로 시간 적분합니다. 입자 상호충돌·완전한 접촉 역학·공기
          유동·역 클라드니는 포함하지 않습니다.
        </p>
        <h3>해석 범위</h3>
        <p>
          기본 300×300×2 mm와 재료 물성은 설계 가정입니다. 구동부 응답·볼트·판의 구멍·가공 공차는 판
          해석에 포함되지 않습니다. 응력과 급속 스윕 과도응답은 지원하지 않습니다. 큰 변위에서는
          선형 이론의 적용성을 별도로 확인하세요. 화면 변형은 최대 ±25 mm로 제한하며 확대 배율을
          표시합니다.
        </p>
        <p>
          실측 CSV는 사용자 출처로 표시하며 자동 보정하지 않습니다. 교육용 코사인 모델은 별도
          concept 모듈에 보존하고 본 실험에는 사용하지 않습니다.
        </p>
        <a
          href="https://defelement.org/elements/bogner-fox-schmitt.html"
          target="_blank"
          rel="noreferrer"
        >
          DefElement · BFS 요소 ↗
        </a>
        <a
          href="https://www.vibrationdata.com/tutorials/ss_plate_spatial_pressure.pdf"
          target="_blank"
          rel="noreferrer"
        >
          T. Irvine · 판 진동 기준식 ↗
        </a>
      </dialog>
    </div>
  );
}
