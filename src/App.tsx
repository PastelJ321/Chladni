import { DeviceProfilePanel } from './ui/DeviceProfilePanel';
import { CalibrationPanel } from './ui/CalibrationPanel';
import type { CalibrationReport } from './solver/calibration';
import { DEFAULT_ANALYSIS, type AnalysisOptions } from './analysis/metrics';
import type { ObservationSnapshot } from './analysis/observationTypes';
import {
  useOffline,
  storeLocalSession,
  readLocalSession,
  type Bookmark,
} from './presentation/session';
import { disposeDeviceAsset, type LoadedDeviceAsset } from './scene/deviceAsset';
import { pendingParticles } from './particles/presets';
import type { RecordEntry } from './experiment/types';
import { ParticleDisplay } from './ui/ParticleDisplay';
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
import {
  decodeSession,
  decodeBinarySession,
  encodeBinarySession,
  download,
  encodeSession,
  particlesCSV,
  sweepCSV,
} from './io/session';
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
    [region, setRegion] = useState('center'),
    [analysisOptions, setAnalysisOptions] = useState<AnalysisOptions>(DEFAULT_ANALYSIS),
    [calibration, setCalibration] = useState<CalibrationReport | null>(null),
    [bookmarks, setBookmarks] = useState<Bookmark[]>([]),
    [asset, setAsset] = useState<LoadedDeviceAsset | null>(null),
    [exposure, setExposure] = useState(0.95);
  const offline = useOffline();
  const assetRef = useRef<LoadedDeviceAsset | null>(null);
  useEffect(
    () => () => {
      if (assetRef.current) disposeDeviceAsset(assetRef.current);
    },
    [],
  );
  function changeAsset(next: LoadedDeviceAsset | null) {
    const old = assetRef.current;
    assetRef.current = next;
    setAsset(next);
    api.current?.setAsset(null);
    if (old) disposeDeviceAsset(old);
  }

  const api = useRef<LabRenderer | null>(null),
    sessionInput = useRef<HTMLInputElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    configRef = useRef(e.config);
  configRef.current = e.config;
  const presentation = film.director.sample();
  const assetRecord = e.config.device?.asset;
  const activeAsset =
    asset &&
    assetRecord &&
    (['name', 'size', 'lastModified', 'type'] as const).every(
      (k) => assetRecord.file[k] === asset.reference[k],
    ) &&
    JSON.stringify(assetRecord.manifest) === JSON.stringify(asset.manifest)
      ? asset
      : null;
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
      ? { ...view, structure: 'assembled', showMode: false }
      : space === 'device'
        ? { ...view, layer: 'material' }
        : view,
    animate: e.playing,
    currentTime: comparison ? undefined : e.currentTime,
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
    mediaPane: showingMedia,
    asset: activeAsset,
    assetVisible: space === 'device' && !!activeAsset,
    exposure,
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
    if (id === 'formation' || id === 'macro') setSpace('experiment');
    if (id === 'comparison') {
      m.setSync(true);
      m.setOverlay(false);
    }
    const origin = api.current?.rig.pose();
    if (!origin) return;
    film.director.framing = {
      plateY:
        e.config.device?.connector.length.value != null
          ? 1.302 + e.config.device.connector.length.value * 12
          : 2.24,
      scale: Math.max(e.config.plate.width, e.config.plate.height) / 0.3,
    };
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
  function extras() {
    return { observations: m.snapshot(), analysis: analysisOptions, calibration, bookmarks, view };
  }
  function activeRecord() {
    const r = e.snapshot();
    return r
      ? {
          ...r,
          observations: m.snapshot(),
          ...(calibration ? { calibration } : {}),
          notes: {
            observation: m.note,
            discrepancy: '',
            reproducibility:
              m.reproduced === 'yes'
                ? ('reproduced' as const)
                : m.reproduced === 'no'
                  ? ('failed' as const)
                  : ('unknown' as const),
          },
        }
      : null;
  }
  function saveRecord() {
    const r = activeRecord();
    if (!r) return;
    e.saveRecord({ observations: r.observations, calibration: r.calibration, notes: r.notes });
    setToast('실험 조건·결과·관측을 기록했습니다.');
  }
  function restoreObservations(value?: ObservationSnapshot) {
    m.restore(
      value ?? {
        schema: 'chladni-observation/1',
        media: null,
        corners: [],
        corrected: false,
        opacity: 0.65,
        overlay: false,
        sync: false,
        offset: 0,
        frameTime: 0,
        frequency: '',
        note: '',
        reproduced: 'unknown',
        measured: [],
        responseName: '',
        regions: [],
      },
    );
  }
  function loadRecord(r: RecordEntry) {
    stopSequence();
    e.loadRecord(r);
    restoreObservations(r.observations);
    setCalibration(r.calibration ?? null);
    setToast('저장된 계산 결과를 불러왔습니다.');
  }
  async function enterPresentation() {
    e.setPlaying(false);
    film.pause();
    setPaint(false);
    setClean(true);
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    } catch {
      /* Focus mode remains available when fullscreen is denied. */
    }
  }
  async function exitPresentation() {
    setClean(false);
    if (document.fullscreenElement) await document.exitFullscreen();
  }
  async function localSave() {
    try {
      await storeLocalSession(encodeBinarySession(e.config, e.records, activeRecord(), extras()));
      setToast('이 기기에 발표용 세션을 보관했습니다.');
    } catch (err) {
      setToast(`기기 저장 실패: ${String(err)}`);
    }
  }
  function applyLoaded(loaded: ReturnType<typeof decodeSession>) {
    stopSequence();
    changeAsset(null);
    if (loaded.active) e.loadRecord(loaded.active);
    else e.loadConditions(loaded.config);
    e.setRecords(loaded.records);
    restoreObservations(loaded.extras?.observations ?? loaded.active?.observations);
    setCalibration(loaded.extras?.calibration ?? loaded.active?.calibration ?? null);
    setBookmarks(loaded.extras?.bookmarks ?? []);
    if (loaded.extras?.analysis) setAnalysisOptions(loaded.extras.analysis);
    if (loaded.extras?.view) setView(loaded.extras.view);
  }
  async function localLoad() {
    try {
      const blob = await readLocalSession();
      if (!blob) {
        setToast('이 기기에 보관한 세션이 없습니다.');
        return;
      }
      applyLoaded(decodeBinarySession(await blob.arrayBuffer()));
      setToast('기기에 보관한 세션을 불러왔습니다.');
    } catch (err) {
      setToast(String(err));
    }
  }
  function saveBookmark() {
    if (bookmarks.length >= 12) {
      setToast('시점은 최대 12개까지 저장할 수 있습니다.');
      return;
    }
    const pose = api.current?.rig.pose();
    if (pose)
      setBookmarks((a) => [...a, { id: crypto.randomUUID(), name: `시점 ${a.length + 1}`, pose }]);
  }
  function recallBookmark(id: string) {
    const b = bookmarks.find((p) => p.id === id);
    if (b) {
      stopSequence();
      api.current?.rig.bookmark(b.pose);
    }
  }
  useEffect(() => {
    let wasFullscreen = !!document.fullscreenElement;
    const change = () => {
      const active = !!document.fullscreenElement;
      if (wasFullscreen && !active) setClean(false);
      wasFullscreen = active;
    };
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  async function capture() {
    const blob = await api.current?.capture();
    if (blob) {
      download(blob, 'chladni-scene.png');
      setToast('3D 장면을 저장했습니다.');
    }
  }
  async function loadSession(file?: File) {
    if (!file) return;
    try {
      if (file.size > 256 * 1024 * 1024) throw Error('256 MB 이하 세션을 선택하세요.');
      const binary =
        file.name.endsWith('.chladni') ||
        new TextDecoder().decode(await file.slice(0, 8).arrayBuffer()) === 'CHLDN04\0';
      const loaded = binary
        ? decodeBinarySession(await file.arrayBuffer())
        : decodeSession(await file.text());
      applyLoaded(loaded);
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
          Chladni<small>QuadraJ</small>
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
              saveRecord();
            }}
          >
            실험 기록
          </button>
          <button aria-pressed={directorOpen} onClick={() => setDirectorOpen(!directorOpen)}>
            장면 연출
          </button>
          <details className="export-menu">
            <summary>
              저장·도구 <ChevronDown size={13} />
            </summary>
            <div>
              <button
                onClick={() =>
                  download(
                    encodeBinarySession(e.config, e.records, activeRecord(), extras()),
                    'chladni-session.chladni',
                  )
                }
              >
                실험 바이너리 저장
              </button>
              <button
                onClick={() =>
                  download(
                    encodeSession(e.config, e.records, activeRecord(), extras()),
                    'chladni-session.json',
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
              <button onClick={() => void enterPresentation()}>발표 화면</button>
              <button onClick={() => void localSave()}>이 기기에 보관</button>
              <button onClick={() => void localLoad()}>기기 기록 불러오기</button>
              <div className="menu-divider" />
              <button
                onClick={() =>
                  setView((v) => ({ ...v, quality: v.quality === 'high' ? 'standard' : 'high' }))
                }
              >
                {view.quality === 'high' ? '균형 화질로 (Balanced)' : '고화질 표시 (High)'}
              </button>
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
        <span>
          {e.config.device?.name ?? '이전 세션 · 개념 장치'} ·{' '}
          {e.config.plate.connection ? '등가 연결부' : '이상 고정 기준'}
        </span>
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
                field={physicalField}
                options={analysisOptions}
                onOptionsChange={setAnalysisOptions}
                region={region}
                setRegion={setRegion}
                e={e}
                view={view}
                setView={updateView}
                comparison={comparison}
                setComparison={(s) => {
                  stopSequence();
                  e.setPlaying(false);
                  setComparison(s);
                  setView((v) => ({ ...v, camera: 'top', structure: 'assembled' }));
                  api.current?.rig.preset('top');
                }}
              />
              <ResearchTools e={{ ...e, saveRecord, loadRecord }} m={m} />
              <CalibrationPanel
                config={e.config}
                storedReport={calibration}
                onApply={(c) => {
                  stopSequence();
                  e.change(c);
                }}
                onReport={setCalibration}
              />
            </>
          ) : (
            <div className="device-tools">
              <div className="panel-heading">
                <h2>장치 탐색</h2>
              </div>
              <DeviceProfilePanel
                config={e.config}
                onChange={(c) => {
                  stopSequence();
                  e.change(c);
                }}
                onAsset={changeAsset}
                onAssetClear={() => changeAsset(null)}
                assetName={activeAsset?.reference.name}
              />
              <StructureTools view={view} setView={updateView} />
              <label className="exposure-control">
                장면 노출 <output>{exposure.toFixed(2)}</output>
                <input
                  aria-label="장면 노출"
                  type="range"
                  min=".6"
                  max="1.4"
                  step=".05"
                  value={exposure}
                  onChange={(ev) => setExposure(+ev.target.value)}
                />
              </label>
              <div className="section-heading">
                <h3>부품</h3>
              </div>
              <div className="part-list">
                {PART_SPECS.filter(
                  (p) =>
                    p.id !== 'particles' &&
                    p.id !== 'speaker' &&
                    (e.config.device?.construction !== 'adhesive' ||
                      !['bolt', 'washerTop', 'washerBottom'].includes(p.id)),
                ).map((p) => (
                  <button
                    key={p.id}
                    aria-pressed={view.selected === p.id}
                    onClick={() =>
                      setView((v) => ({ ...v, selected: v.selected === p.id ? null : p.id }))
                    }
                  >
                    {e.config.device?.construction === 'adhesive' && p.id === 'coupler'
                      ? '임시 전달부 · 접착'
                      : p.label}
                  </button>
                ))}
              </div>
              <p className="help">
                외형은 연결 방식의 도식입니다. 실측하지 않은 스피커 내부·치수는 개념 구조이며 가져온
                CAD는 장치 화면의 참조 모델로 표시합니다.
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
          <section
            className="stage"
            aria-label="가상 실험실"
            data-modal-solves={e.cache.modalSolves}
            data-modal-reuses={e.cache.modalReuses}
          >
            <LabViewport
              data={data}
              api={api}
              onSelect={(id) => setView((v) => ({ ...v, selected: id }))}
              onPaint={onPaint}
              onContextLoss={() => {
                e.setPlaying(false);
                film.pause();
              }}
            />
            <div className="stage-source">
              {space === 'device'
                ? activeAsset
                  ? '가져온 구조 참조 · FEM 변형 미적용'
                  : '장비 구조 · 외형 개념'
                : e.modal
                  ? e.run
                    ? `${e.status === '기록 불러옴' ? '저장 결과 · ' : ''}판 FEM · ${e.run.model === 'impact-contact' ? '구형 접촉 근사' : '집단 이동 근사'}`
                    : '판 FEM · 초기 입자 배치'
                  : '연결 방식 기록 · 외형/치수 미보정'}
              {view.showMode && space === 'analyze' && !presentation && ' · 고유모드 1 µm 정규화'}
              {presentation?.runProgress != null && ` · 결과 재생 ${previewTime.toFixed(2)} s`}
            </div>
            <div className="particle-caption">
              {pendingParticles(e.config.grains) ? (
                '입경·밀도 입력 필요'
              ) : view.showMode && !presentation ? (
                '고유모드 형상 · 입자 숨김'
              ) : (
                <>
                  {(view.particleVisual?.count || e.config.grains.count).toLocaleString()}개 표시 ·{' '}
                  {view.particleVisual?.mode === 'actual'
                    ? '실제 크기'
                    : `관찰 ×${view.particleVisual?.displayMagnification ?? 2.5} · 최소 ${view.particleVisual?.minimumPixelDiameter ?? 1.8} px`}
                </>
              )}
            </div>
            {showingMedia && (
              <MediaPreview
                m={m}
                field={physicalField}
                config={e.config}
                run={e.run}
                time={previewTime}
              />
            )}
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
                    aria-pressed={view.camera === id}
                    onClick={() => {
                      film.director.interrupt();
                      setView((v) => ({
                        ...v,
                        camera: id,
                        ...(id === 'macro' ? { gain: 1 } : {}),
                      }));
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
                <button aria-label="발표 화면" onClick={() => void enterPresentation()}>
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
                  {film.director.id ? ' · 연출 시간' : ' · 정지 위상'}
                </span>
              </div>
            </div>
            {clean && (
              <div className="presentation-shelf glass">
                <span>{e.run ? '계산 결과 재생' : '장치 관찰'}</span>
                <select
                  aria-label="발표 기록"
                  disabled={!e.records.some((r) => r.run)}
                  value=""
                  onChange={(ev) => {
                    const r = e.records.find((r) => r.id === ev.target.value);
                    if (r) loadRecord(r);
                  }}
                >
                  <option value="">기록 선택</option>
                  {e.records
                    .filter((r) => r.run)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} · {r.config.drive.frequency.toFixed(1)} Hz
                      </option>
                    ))}
                </select>
                <button onClick={() => setDirectorOpen((v) => !v)}>장면 연출</button>
                <select
                  aria-label="발표 카메라 시점"
                  value=""
                  onChange={(ev) => recallBookmark(ev.target.value)}
                >
                  <option value="">저장 시점</option>
                  {bookmarks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {view.selected && (
              <div className="part-popover glass">
                <button
                  aria-label="부품 정보 닫기"
                  onClick={() => setView({ ...view, selected: null })}
                >
                  <X size={13} />
                </button>
                <strong>
                  {e.config.device?.construction === 'adhesive' && view.selected === 'coupler'
                    ? '임시 전달부 · 접착'
                    : PART_SPECS.find((p) => p.id === view.selected)?.label}
                </strong>
                <p>{PART_SPECS.find((p) => p.id === view.selected)?.connection}</p>
                <small>
                  {e.config.device?.construction === 'adhesive'
                    ? '무관통 연결 · 외형 개념'
                    : '볼트 체결 개념 · 실물 아님'}
                </small>
              </div>
            )}
            {e.busy && e.busyKind !== 'field' && (
              <div className="compute-overlay glass" role="status">
                <strong>{e.status}</strong>
                <progress value={e.progress} max="1" />
                <span>{Math.round(e.progress * 100)}%</span>
                <button onClick={e.cancel}>계산 취소</button>
              </div>
            )}
            {clean && (
              <button className="exit-presentation glass" onClick={() => void exitPresentation()}>
                <X size={14} />
                발표 종료
              </button>
            )}
          </section>
          <div className="scene-dock">
            {!clean && (
              <div className="bookmark-menu">
                <button onClick={saveBookmark}>시점 저장</button>
                {bookmarks.length > 0 && (
                  <select
                    aria-label="카메라 북마크"
                    value=""
                    onChange={(ev) => recallBookmark(ev.target.value)}
                  >
                    <option value="">저장 시점</option>
                    {bookmarks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            <ParticleDisplay view={view} setView={setView} grains={e.config.grains} />
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
          </div>
          <div className="simulation-controls glass">
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
              step=".001"
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
              absolute={!!e.config.plate.connection}
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
            <span>
              {e.config.plate.connection ? '유연 연결부 FEM' : '이상 고정 FEM 기준'} · 입자 비보정 ·
              역패턴 검증 없음
            </span>
            <span className="offline-status">
              {offline === 'ready'
                ? '오프라인 준비됨'
                : offline === 'preparing'
                  ? '오프라인 준비 중'
                  : offline === 'dev'
                    ? '로컬 개발 서버'
                    : '오프라인 캐시 미지원'}
            </span>
            <button onClick={() => setAbout(true)}>모델 범위</button>
          </div>
        </main>
      </div>
      <input
        hidden
        ref={sessionInput}
        aria-label="세션 파일"
        type="file"
        accept=".json,.chladni"
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
          집단 이동 근사와 소규모 구형 접촉 해석을 구분합니다. 접촉 해석은 도약·충돌·Coulomb
          마찰·구의 회전을 적분하지만 입자 간 충돌·공기 유동은 계산하지 않습니다. 분리가 일어나지
          않을 수도 있고, 실제 분리 효율을 예측하지 않습니다.
        </p>
        <h3>역 클라드니: 관측과 비교</h3>
        <p>
          역패턴을 생성하는 검증된 유동 모델이 없습니다. 역 클라드니는 실측 사진·영상으로 비교하며,
          생성한 역패턴을 계산 결과로 제시하지 않습니다. 사진·영상은 네 모서리를 지정해 판 좌표로
          정합합니다.
        </p>
        <h3>표시와 계산</h3>
        <p>
          입자는 최대 50,000개를 실제 적분하고 최대 100,000개를 표시합니다. 추가 표시 표본은 시각적
          표본이며 질량과 통계에 포함하지 않습니다. 입자군 물성은 대표값으로 실측 보정 전입니다.
        </p>
        <p>
          FEM 계산 {e.cache.modalSolves}회 · 모드 재사용 {e.cache.modalReuses}회
        </p>
        <h3>장면 연출</h3>
        <p>
          연출 타임라인은 계산 데이터와 분리돼 있습니다. 진동 확대·카메라·분해는 관찰을 위한
          표시이고 계산 조건을 바꾸지 않습니다. 장치 부품은 실물 사진·CAD가 없는 개념 기구입니다.
        </p>
      </dialog>
    </div>
  );
}
