import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Download,
  Pause,
  Play,
  RotateCcw,
  Square,
  X,
  Maximize2,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useExperiment } from './experiment/useExperiment';
import { DEFAULT_VIEW, cloneConfig } from './experiment/config';
import type { Field, ViewSettings, Workspace } from './experiment/types';
import { ConfigurationPanel } from './ui/ConfigurationPanel';
import { AnalysisTools } from './ui/AnalysisTools';
import { ResponsePlot } from './ui/ResponsePlot';
import { StructureTools } from './ui/StructureTools';
import {
  ResearchTools,
  MediaPreview,
  ObservationInputs,
  useObservations,
} from './ui/ResearchTools';
import { DirectorControls } from './ui/DirectorControls';
import { LabViewport } from './render/LabViewport';
import { LabRenderer, type RenderData } from './render/LabRenderer';
import { responseField } from './solver/response';
import { sampleMode } from './solver/modal';
import { decodeSession, download, encodeSession, particlesCSV, sweepCSV } from './io/session';
import { fieldAtRun } from './simulation/particles';
import { PART_SPECS } from './scene/parts';
import { useDirector } from './animation/useDirector';
import type { SequenceId } from './animation/director';
const spaces: { id: Workspace; label: string }[] = [
  { id: 'experiment', label: '실험' },
  { id: 'analyze', label: '분석' },
  { id: 'device', label: '장치' },
];
export default function App() {
  const e = useExperiment(),
    film = useDirector(),
    [space, setSpace] = useState<Workspace>('experiment'),
    [view, setView] = useState<ViewSettings>(DEFAULT_VIEW),
    [paint, setPaint] = useState(false),
    [comparison, setComparison] = useState(''),
    [toast, setToast] = useState(''),
    [panel, setPanel] = useState(true),
    [mobile, setMobile] = useState(false),
    [about, setAbout] = useState(false),
    [directorOpen, setDirectorOpen] = useState(false),
    [clean, setClean] = useState(false),
    [region, setRegion] = useState('center');
  const api = useRef<LabRenderer | null>(null),
    sessionInput = useRef<HTMLInputElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    configRef = useRef(e.config);
  configRef.current = e.config;
  const presentation = film.director.sample();
  const previewTime =
    presentation?.runProgress != null ? presentation.runProgress * e.config.drive.duration : e.time;
  const m = useObservations(previewTime, setToast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (about) dialog.current?.showModal();
    else dialog.current?.close();
  }, [about]);
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        stopSequence();
        setClean(false);
        setMobile(false);
      }
      if ((ev.target as HTMLElement).matches('input,select,textarea,button') || about) return;
      if (ev.code === 'Space') {
        ev.preventDefault();
        if (film.director.id) {
          film.director.playing ? film.pause() : film.resume();
        } else if (e.run) e.setPlaying(!e.playing);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  const field = useMemo(() => {
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
      frequency: e.modal.frequencies[Math.min(view.mode, e.modal.frequencies.length - 1)],
    } as Field;
  }, [view.showMode, view.mode, e.modal, e.field, e.run, e.time]);
  const reference = e.records.find((r) => r.id === comparison),
    referenceField = useMemo(
      () => (reference ? responseField(reference.modal, reference.config) : null),
      [reference],
    );
  const showingMedia = !!m.media && (space === 'analyze' || film.director.id === 'comparison');
  const base: RenderData = {
    config: e.config,
    modal: e.modal,
    field:
      space === 'device' && !film.director.id
        ? null
        : film.director.id
          ? e.run
            ? fieldAtRun(e.run, e.time)
            : e.field
          : field,
    run: e.run,
    time: e.time,
    view: film.director.id
      ? { ...view, structure: 'assembled' }
      : space === 'device'
        ? { ...view, layer: 'material' }
        : view,
    animate: false,
    paint,
    director: film.director,
    focusRegion:
      region === 'left'
        ? [0, 0, 0.5, 1]
        : region === 'right'
          ? [0.5, 0, 1, 1]
          : region === 'all'
            ? [0, 0, 1, 1]
            : [0.25, 0.25, 0.75, 0.75],
    mediaPane: showingMedia && !m.overlay,
  };
  const data: RenderData =
    !showingMedia && comparison === 'before' && e.run
      ? {
          ...base,
          time: 0,
          field: fieldAtRun(e.run, 0),
          compare: {
            ...base,
            time: e.run.config.drive.duration,
            field: fieldAtRun(e.run, e.run.config.drive.duration),
          },
        }
      : !showingMedia && reference
        ? {
            ...base,
            compare: {
              ...base,
              config: reference.config,
              modal: reference.modal,
              field: reference.run
                ? fieldAtRun(reference.run, Math.min(e.time, reference.config.drive.duration))
                : referenceField,
              run: reference.run,
              time: Math.min(e.time, reference.config.drive.duration),
            },
          }
        : base;
  function changeSpace(id: Workspace) {
    stopSequence();
    setSpace(id);
    setMobile(false);
    setPaint(false);
    if (id !== 'device') setView((v) => ({ ...v, structure: 'assembled' }));
  }
  function stopSequence() {
    const d = film.director;
    if (d.id && d.cameraEnabled) api.current?.rig.restore(d.origin);
    film.stop();
  }
  function startSequence(id: SequenceId) {
    if (id === 'resonance' || id === 'comparison') setSpace('analyze');
    if (id === 'formation') setSpace('experiment');
    if (id === 'comparison') {
      m.setSync(true);
      m.setOverlay(false);
    }
    const origin = api.current?.rig.pose();
    if (!origin) return;
    e.setPlaying(false);
    setPaint(false);
    setComparison('');
    film.start(id, origin);
  }
  function updateView(v: ViewSettings) {
    stopSequence();
    setView(v);
  }
  const onPaint = (point: [number, number]) => {
    const c = cloneConfig(configRef.current);
    c.grains.distribution = 'paint';
    c.grains.spots = [...c.grains.spots, point].slice(-200);
    e.change(c);
  };
  async function capture() {
    const blob = await api.current?.capture();
    if (blob) {
      download(blob, 'chladni-v03.png');
      setToast('3D 장면을 저장했습니다.');
    }
  }
  async function loadSession(file?: File) {
    if (!file) return;
    try {
      if (file.size > 60 * 1024 * 1024) throw Error('60 MB 이하 세션을 선택하세요.');
      const loaded = decodeSession(await file.text());
      stopSequence();
      if (loaded.active) e.loadRecord(loaded.active);
      else e.change(loaded.config);
      e.setRecords(loaded.records);
      setToast('세션을 불러왔습니다.');
    } catch (err) {
      setToast(String(err));
    }
  }
  const layer = presentation?.layer ?? view.layer,
    physicalField =
      view.showMode && !presentation ? field : e.run ? fieldAtRun(e.run, previewTime) : field;
  return (
    <div className={`focused-lab ${clean ? 'is-clean' : ''} ${!panel ? 'panel-hidden' : ''}`}>
      <header className="app-header">
        <div className="wordmark">
          Chladni<small>by QuadraJ</small>
        </div>
        <nav aria-label="작업 공간">
          {spaces.map((s) => (
            <button
              key={s.id}
              aria-current={space === s.id ? 'page' : undefined}
              onClick={() => changeSpace(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="header-tools">
          <button
            className="record-button"
            disabled={!e.modal || !e.sweep}
            onClick={() => {
              e.saveRecord();
              setToast('실험 조건과 결과를 기록했습니다.');
            }}
          >
            실험 기록
          </button>
          <button onClick={() => setDirectorOpen(!directorOpen)}>장면 연출</button>
          <details className="export-menu">
            <summary>
              저장·도구 <ChevronDown size={13} />
            </summary>
            <div>
              <button
                onClick={() =>
                  download(
                    encodeSession(e.config, e.records, e.snapshot()),
                    'chladni-session-v3.json',
                  )
                }
              >
                <Download size={14} />
                세션 JSON 저장
              </button>
              <button onClick={() => sessionInput.current?.click()}>세션 불러오기</button>
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
              <button onClick={capture}>장면 PNG</button>
              <button onClick={() => setClean(true)}>발표 화면</button>
              <button
                onClick={() =>
                  setView((v) => ({ ...v, quality: v.quality === 'low' ? 'standard' : 'low' }))
                }
              >
                {view.quality === 'low' ? '표준 화질로' : '저사양 표시'}
              </button>
              <button onClick={() => setAbout(true)}>모델과 출처</button>
            </div>
          </details>
        </div>
      </header>
      <div className="study-heading">
        <p>입경 통제 · 구동 주파수에 따른 혼합 입자 분리</p>
        <span>직접·역 클라드니 연구</span>
      </div>
      <div className="lab-layout">
        <aside className={`settings-slot ${mobile ? 'mobile-open' : ''}`}>
          <button className="close-mobile" aria-label="설정 닫기" onClick={() => setMobile(false)}>
            <X size={18} />
          </button>
          {space === 'experiment' ? (
            <ConfigurationPanel
              e={{
                ...e,
                change: (c) => {
                  stopSequence();
                  e.change(c);
                },
                solve: () => {
                  stopSequence();
                  e.solve();
                },
                simulate: () => {
                  stopSequence();
                  e.simulate();
                },
              }}
              paint={paint}
              setPaint={(p) => {
                stopSequence();
                setPaint(p);
                if (p) setView((v) => ({ ...v, camera: 'top', structure: 'assembled' }));
              }}
            />
          ) : space === 'analyze' ? (
            <>
              <AnalysisTools
                region={region}
                setRegion={setRegion}
                e={e}
                view={view}
                setView={updateView}
                comparison={comparison}
                setComparison={(s) => {
                  stopSequence();
                  setComparison(s);
                  setView((v) => ({ ...v, camera: 'top', structure: 'assembled' }));
                  api.current?.rig.preset('top');
                }}
              />
              <ResearchTools e={e} m={m} />
            </>
          ) : (
            <div className="device-tools">
              <div className="panel-heading">
                <h2>장치 탐색</h2>
              </div>
              <StructureTools view={view} setView={updateView} />
              <div className="section-heading">
                <h3>부품</h3>
              </div>
              <div className="part-list">
                {PART_SPECS.filter((p) => p.id !== 'particles' && p.id !== 'speaker').map((p) => (
                  <button
                    key={p.id}
                    aria-pressed={view.selected === p.id}
                    onClick={() =>
                      setView((v) => ({ ...v, selected: v.selected === p.id ? null : p.id }))
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="help">
                판 치수는 설계값, 구동부는 개념 기구입니다. 실물 사진·CAD가 제공되면 부품 매핑으로
                교체할 수 있습니다.
              </p>
            </div>
          )}
        </aside>
        <main className="experiment-main">
          <div className="scene-toolbar">
            <div className="scene-title">
              <button
                className="desktop-panel-toggle"
                onClick={() => setPanel(!panel)}
                aria-label={panel ? '설정 접기' : '설정 펼치기'}
              >
                {panel ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
              </button>
              <button className="mobile-settings" onClick={() => setMobile(true)}>
                실험 조건
              </button>
              <h1>
                {space === 'experiment'
                  ? '혼합 입자 실험'
                  : space === 'analyze'
                    ? '모드와 입자 분포'
                    : '장비의 구조와 연결'}
              </h1>
            </div>
            <div className="scene-values">
              {space === 'device' ? (
                <span>
                  {(e.config.plate.width * 1000).toFixed(0)} ×{' '}
                  {(e.config.plate.height * 1000).toFixed(0)} mm 설계판 · 개념 기구
                </span>
              ) : e.field ? (
                <>
                  <strong>
                    {(physicalField?.frequency ?? e.config.drive.frequency).toFixed(1)}{' '}
                    <small>Hz</small>
                  </strong>
                  <span>
                    최대 {(physicalField?.peak ? physicalField.peak * 1e6 : 0).toPrecision(3)} µm
                  </span>
                </>
              ) : (
                <span>
                  계산 전 · {(e.config.plate.width * 1000).toFixed(0)} ×{' '}
                  {(e.config.plate.height * 1000).toFixed(0)} mm 설계값
                </span>
              )}
            </div>
          </div>
          <section className="stage" aria-label="가상 실험실">
            <LabViewport
              data={data}
              api={api}
              onSelect={(id) => setView((v) => ({ ...v, selected: id }))}
              onPaint={onPaint}
            />
            <div className="stage-source">
              {space === 'device'
                ? '장비 구조 · 개념 모델'
                : e.modal
                  ? e.run
                    ? '판 FEM · 입자 운동 근사'
                    : '판 FEM · 초기 입자 배치'
                  : '중앙 구동 장비 · 설계 미리보기'}
              {view.showMode && ' · 고유모드 1 µm 정규화'}
              {presentation?.runProgress != null && ` · 결과 재생 ${previewTime.toFixed(2)} s`}
            </div>
            {showingMedia && <MediaPreview m={m} />}
            {paint && (
              <div className="paint-hint glass">
                판 위를 클릭해 배치 · {e.config.grains.spots.length}개 영역
              </div>
            )}
            {comparison && !showingMedia && (
              <>
                <div className="compare-divider" />
                <span className="compare-caption left">
                  {comparison === 'before' ? '초기 분포' : '현재 실험'}
                </span>
                <span className="compare-caption right">
                  {comparison === 'before' ? '최종 분포' : reference?.name}
                </span>
              </>
            )}
            <div className="stage-controls">
              <div className="camera-bar glass">
                {(['hero', 'top', 'macro'] as const).map((id, i) => (
                  <button
                    key={id}
                    onClick={() => {
                      film.director.interrupt();
                      setView((v) => ({ ...v, camera: id }));
                      api.current?.rig.preset(id);
                    }}
                  >
                    {['전경', '수직', '접사'][i]}
                  </button>
                ))}
                <i />
                <button aria-label="고해상도 PNG 저장" onClick={capture}>
                  <Camera size={15} />
                </button>
                <button aria-label="발표 화면" onClick={() => setClean(true)}>
                  <Maximize2 size={15} />
                </button>
              </div>
              <div className="layer-caption">
                {space === 'analyze' && (
                  <span>
                    {
                      {
                        material: '재질',
                        amplitude: '진폭',
                        displacement: '변위',
                        contour: '실수부 0 · 진폭 등고선',
                        trace: '입자 궤적',
                        density: '입자 밀도',
                        mesh: 'FEM 메시',
                        vector: '진폭² 기울기',
                        velocity: '속도 진폭',
                        acceleration: '가속도 진폭',
                      }[layer]
                    }
                  </span>
                )}
                <span>
                  변위 표시 ×{presentation?.gain?.toFixed(0) ?? view.gain}
                  {film.director.id ? ' · 연출 시간' : ''}
                </span>
              </div>
            </div>
            {view.selected && (
              <div className="part-popover glass">
                <button
                  aria-label="부품 정보 닫기"
                  onClick={() => setView({ ...view, selected: null })}
                >
                  <X size={13} />
                </button>
                <strong>{PART_SPECS.find((p) => p.id === view.selected)?.label}</strong>
                <p>{PART_SPECS.find((p) => p.id === view.selected)?.connection}</p>
                <small>개념 기구 · 실측 자료 미제공</small>
              </div>
            )}
            {directorOpen && (
              <DirectorControls
                film={{ ...film, stop: stopSequence }}
                onStart={startSequence}
                hasField={!!e.field}
                hasRun={!!e.run}
                hasMedia={!!m.media && !!e.field}
                onClose={() => setDirectorOpen(false)}
              />
            )}
            {e.busy && (
              <div className="compute-overlay glass" role="status">
                <strong>{e.status}</strong>
                <progress value={e.progress} max="1" />
                <span>{Math.round(e.progress * 100)}%</span>
                <button onClick={e.cancel}>계산 취소</button>
              </div>
            )}
            {clean && (
              <button className="exit-presentation glass" onClick={() => setClean(false)}>
                <X size={14} />
                발표 종료
              </button>
            )}
          </section>
          <div className="simulation-controls">
            <button
              className="play-control"
              aria-label={e.playing ? '일시정지' : '재생'}
              disabled={!e.run}
              onClick={() => {
                stopSequence();
                if (e.time >= e.config.drive.duration) e.setTime(0);
                e.setPlaying(!e.playing);
              }}
            >
              {e.playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              aria-label="완전 정지"
              onClick={() => {
                stopSequence();
                e.cancel();
                e.setTime(0);
              }}
            >
              <Square size={13} />
            </button>
            <button
              aria-label="초기화"
              onClick={() => {
                stopSequence();
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
                stopSequence();
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
            <button
              className="repeat-button"
              disabled={!e.run || e.busy}
              onClick={() => {
                stopSequence();
                e.simulate();
              }}
            >
              동일 조건 재실험
            </button>
          </div>
          {space === 'experiment' && e.sweep && (
            <div className="resonance-strip">
              <span>공진 후보</span>
              {e.sweep.peaks.slice(0, 5).map((p) => (
                <button
                  key={p.frequency}
                  onClick={() => {
                    stopSequence();
                    e.selectFrequency(p.frequency);
                  }}
                >
                  {p.frequency.toFixed(1)} Hz
                </button>
              ))}
              <button className="quiet" onClick={() => changeSpace('analyze')}>
                응답 곡선 보기
              </button>
            </div>
          )}
          {space === 'analyze' && (
            <ResponsePlot
              sweep={e.sweep}
              frequency={e.config.drive.frequency}
              measured={m.measured}
              onSelect={(f) => {
                stopSequence();
                setView((v) => ({ ...v, showMode: false }));
                e.selectFrequency(f);
              }}
            />
          )}
          <div className="model-caption">
            <span>입자 이동: 비보정 근사 · 역 클라드니 예측 미지원</span>
            <button onClick={() => setAbout(true)}>모델 범위</button>
          </div>
        </main>
      </div>
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
      <ObservationInputs m={m} />
      {toast && (
        <div className="toast" role="status">
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
        <h2>계산과 관측의 구분</h2>
        <h3>판: FEM 계산</h3>
        <p>
          BFS Kirchhoff–Love 판 요소와 일관 질량 행렬로 계산한 24개 모드를 합성합니다. 주파수 스윕과
          변위는 재료·치수·고정·구동 조건에 따라 달라집니다. 기본 장비의 치수와 물성은 실측 전
          설계값입니다.
        </p>
        <h3>입자: 운동 근사</h3>
        <p>
          두 입자군의 입경·밀도·마찰·형태 계수는 독립적입니다. 입경은 지정 구간의 균등분포입니다.
          주기 평균 이동과 Stokes 완화를 근사하며 입자 간 충돌·공기 유동은 계산하지 않습니다. 분리가
          일어나지 않을 수도 있고, 실제 분리 효율을 예측하지 않습니다.
        </p>
        <h3>역 클라드니: 관측과 비교</h3>
        <p>
          역패턴을 생성하는 검증된 유동 모델이 없습니다. 역 클라드니는 실측 사진·영상으로 비교하며,
          생성한 역패턴을 계산 결과로 제시하지 않습니다. 사진의 원근 정합은 지원하지 않습니다.
        </p>
        <h3>장면 연출</h3>
        <p>
          연출 타임라인은 계산 데이터와 분리돼 있습니다. 진동 확대·카메라·분해는 관찰을 위한
          표시이고 계산 조건을 바꾸지 않습니다. 표시 변형은 최대 ±25 mm로 제한합니다. 장치 부품은
          실물 사진·CAD가 없는 개념 기구입니다.
        </p>
      </dialog>
    </div>
  );
}
