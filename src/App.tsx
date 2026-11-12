import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Expand,
  Eye,
  Focus,
  Layers3,
  Maximize,
  Minus,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  VolumeX,
  X,
} from 'lucide-react';
import Viewport from './components/Viewport';
import ModePreview from './components/ModePreview';
import {
  CAUSAL_LABELS,
  DURATION,
  INITIAL_STATE,
  MODES,
  PARTS,
  VIEWS,
  type Category,
  type CompareKind,
  type PartId,
  type SceneState,
  type ViewId,
} from './model/catalog';
import { response } from './model/physics';
import type { SceneController } from './scene/SceneController';

const CATEGORY_LABELS: Record<Category, string> = {
  explore: '장비 탐색',
  analyze: '현상 분석',
  compare: '실험 비교',
};
const DEMO = [
  { view: 'hero', camera: 'hero', label: '장비를 만나다', duration: 7 },
  { view: 'exploded', camera: 'hero', label: '구조를 펼치다', duration: 7 },
  { view: 'assembly', camera: 'hero', label: '중앙으로 이어지는 구동', duration: 12 },
  { view: 'mechanism', camera: 'hero', label: '진동의 전달', duration: 7 },
  { view: 'motion', camera: 'hero', label: '마디와 배', duration: 8 },
  { view: 'trace', camera: 'top', label: '입자가 남기는 경로', duration: 10 },
  { view: 'hero', camera: 'macro', label: '고요한 곳에 남은 입자', duration: 7 },
] as const;

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [state, setState] = useState<SceneState>(() => ({
    ...INITIAL_STATE,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }));
  const [category, setCategory] = useState<Category>('explore');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [clean, setClean] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'settings' | 'parts'>('settings');
  const [info, setInfo] = useState(false);
  const [toast, setToast] = useState('');
  const [mobilePanel, setMobilePanel] = useState<'views' | 'settings' | null>(null);
  const [media, setMedia] = useState<{ url: string; name: string; type: string } | null>(null);
  const [recordFrequency, setRecordFrequency] = useState('');
  const [demoStep, setDemoStep] = useState(-1);
  const [demoPaused, setDemoPaused] = useState(false);
  const controller = useRef<SceneController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const mediaRef = useRef(media);
  const demoElapsed = useRef(0);
  const demoSnapshot = useRef<SceneState | null>(null);
  const selectedView = VIEWS.find((v) => v.id === state.view)!;
  const mode = MODES[state.modeIndex];
  const isSplit = state.view === 'compare' || state.view === 'before';
  const set = useCallback(
    (patch: Partial<SceneState>) => setState((s) => ({ ...s, ...patch })),
    [],
  );
  const selectPart = useCallback((id: PartId | null) => {
    setState((s) => ({ ...s, selectedPart: s.selectedPart === id ? null : id }));
    if (id) setInspectorTab('parts');
  }, []);
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback((message: string) => setError(message), []);

  const chooseView = useCallback((id: ViewId) => {
    const view = VIEWS.find((v) => v.id === id)!;
    setCategory(view.category);
    setState((s) => ({
      ...s,
      view: id,
      selectedPart: null,
      playing: false,
      time: id === 'assembly' || id === 'causal' ? 0 : s.time,
      camera: ['mode', 'heatmap', 'contour', 'trace', 'vector', 'compare', 'before'].includes(id)
        ? 'top'
        : id === 'section'
          ? 'section'
          : 'hero',
      cameraRevision: s.cameraRevision + 1,
    }));
    setMobilePanel(null);
  }, []);

  function endDemo() {
    setDemoStep(-1);
    setDemoPaused(false);
    setPresentation(false);
    if (demoSnapshot.current) {
      setState(demoSnapshot.current);
      setCategory(VIEWS.find((v) => v.id === demoSnapshot.current!.view)!.category);
    }
    if (document.fullscreenElement) void document.exitFullscreen();
  }

  useEffect(() => {
    if (!state.playing || demoStep >= 0) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      if (document.hidden) {
        last = performance.now();
        return;
      }
      const now = performance.now(),
        delta = Math.min(0.15, (now - last) / 1000);
      last = now;
      setState((s) => {
        const next = s.time + delta * s.speed;
        return { ...s, time: Math.min(DURATION, next), playing: next < DURATION };
      });
    }, 50);
    return () => clearInterval(timer);
  }, [state.playing, state.speed, demoStep]);

  useEffect(() => {
    if (demoStep < 0) return;
    const step = DEMO[demoStep];
    setState((s) => ({
      ...s,
      view: step.view,
      camera: step.camera,
      cameraRevision: s.cameraRevision + 1,
      time: step.view === 'assembly' || step.view === 'trace' ? 0 : 9,
      playing: true,
      annotations: step.view === 'exploded',
    }));
    setCategory(VIEWS.find((v) => v.id === step.view)!.category);
    demoElapsed.current = 0;
  }, [demoStep]);

  useEffect(() => {
    if (demoStep < 0 || demoPaused) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      if (document.hidden) {
        last = performance.now();
        return;
      }
      const now = performance.now(),
        delta = Math.min(0.15, (now - last) / 1000);
      last = now;
      demoElapsed.current += delta;
      setState((s) => ({
        ...s,
        time: Math.min(DURATION, s.time + delta * (s.view === 'motion' ? 0.25 : 1)),
      }));
      if (demoElapsed.current >= DEMO[demoStep].duration) {
        if (demoStep === DEMO.length - 1) {
          setDemoStep(-1);
          setPresentation(false);
          setState((s) => ({ ...s, view: 'hero', camera: 'hero', playing: false }));
          setCategory('explore');
        } else setDemoStep((v) => v + 1);
      }
    }, 50);
    return () => clearInterval(timer);
  }, [demoStep, demoPaused]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (dialog.current?.open) return;
      if (event.key === 'Escape') {
        setClean(false);
        setPresentation(false);
        setMobilePanel(null);
        if (demoStep >= 0) endDemo();
        return;
      }
      if ((event.target as HTMLElement).matches('input, select, textarea, button')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (demoStep >= 0) setDemoPaused((p) => !p);
        else
          setState((s) => ({ ...s, time: s.time >= DURATION ? 0 : s.time, playing: !s.playing }));
      }
      if (event.key.toLowerCase() === 'c') setClean((v) => !v);
      if (event.key.toLowerCase() === 'r')
        setState((s) => ({ ...s, camera: 'hero', cameraRevision: s.cameraRevision + 1 }));
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft')
        setState((s) => ({
          ...s,
          playing: false,
          time: Math.max(
            0,
            Math.min(DURATION, s.time + (event.key === 'ArrowRight' ? 0.25 : -0.25)),
          ),
        }));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    mediaRef.current = media;
  }, [media]);
  useEffect(
    () => () => {
      if (mediaRef.current) URL.revokeObjectURL(mediaRef.current.url);
    },
    [],
  );
  useEffect(() => {
    if (info) dialog.current?.showModal();
    else dialog.current?.close();
  }, [info]);
  useEffect(() => {
    const handler = () => {
      if (!document.fullscreenElement && demoStep < 0) setPresentation(false);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, [demoStep]);

  function startDemo() {
    demoSnapshot.current = state;
    setState({ ...INITIAL_STATE, reducedMotion: state.reducedMotion });
    setPresentation(true);
    setClean(false);
    setDemoPaused(false);
    setDemoStep(0);
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setPresentation(false);
      } else {
        await document.documentElement.requestFullscreen();
        setPresentation(true);
      }
    } catch {
      setPresentation((v) => !v);
      setToast('이 브라우저에서는 화면 내 발표 모드를 사용합니다.');
    }
  }
  async function capture() {
    const blob = await controller.current?.capture();
    if (blob) {
      download(blob, `quadraj-chladni-${state.view}-${mode.id}.png`);
      setToast('3D 장면을 PNG로 저장했습니다.');
    } else setToast('장면을 저장하지 못했습니다. 다시 시도해 주세요.');
  }
  function exportSettings() {
    download(
      new Blob(
        [
          JSON.stringify(
            {
              schema: 'quadraj-chladni/1',
              model: 'analytic-surrogate',
              calibrated: false,
              state,
              experiment: media
                ? {
                    name: media.name,
                    frequencyHz: recordFrequency ? Number(recordFrequency) : null,
                  }
                : null,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
      'chladni-session.json',
    );
    setToast('현재 조건을 JSON으로 저장했습니다.');
  }
  function importRecord(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^(image\/(png|jpeg|webp)|video\/(mp4|webm|quicktime))$/.test(file.type)) {
      setToast('JPG, PNG, WebP 이미지 또는 MP4, WebM, MOV 영상을 선택해 주세요.');
      return;
    }
    if (file.size > 250 * 1024 * 1024) {
      setToast('250 MB 이하의 기록을 선택해 주세요.');
      return;
    }
    if (media) URL.revokeObjectURL(media.url);
    setMedia({ url: URL.createObjectURL(file), name: file.name, type: file.type });
    set({ compareKind: 'experiment' });
    event.target.value = '';
  }
  const togglePart = (id: PartId) =>
    setState((s) => ({
      ...s,
      particles: id === 'particles' ? !s.particles : s.particles,
      hiddenParts:
        id === 'particles'
          ? s.hiddenParts.filter((p) => p !== id)
          : s.hiddenParts.includes(id)
            ? s.hiddenParts.filter((p) => p !== id)
            : [...s.hiddenParts, id],
    }));
  const isPartHidden = (id: PartId) =>
    id === 'particles' ? !state.particles : state.hiddenParts.includes(id);
  const togglePlayback = () =>
    setState((s) => ({ ...s, time: s.time >= DURATION ? 0 : s.time, playing: !s.playing }));

  return (
    <div className={`app ${clean ? 'is-clean' : ''} ${presentation ? 'is-presenting' : ''}`}>
      <header className="topbar chrome">
        <div className="brand">
          <span className="brand-mark">
            Q<span>J</span>
          </span>
          <span>
            QuadraJ<span className="brand-sub">RESEARCH / INTERACTIVE</span>
          </span>
        </div>
        <div className="project-path">
          <span className="path-line" /> <span>Chladni</span>
          <span className="version">01</span>
        </div>
        <nav className="workspace-tabs" aria-label="작업 공간">
          {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => (
            <button
              key={cat}
              className={category === cat ? 'active' : ''}
              onClick={() => {
                setCategory(cat);
                chooseView(cat === 'explore' ? 'hero' : cat === 'analyze' ? 'mode' : 'compare');
              }}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button className="text-button about-button" onClick={() => setInfo(true)}>
            모델 안내
          </button>
          <button className="presentation-button" onClick={startDemo}>
            <Play size={12} fill="currentColor" /> 데모 재생
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside
          className={`view-sidebar chrome ${mobilePanel === 'views' ? 'mobile-open' : ''}`}
          aria-label="시각화 뷰 선택"
        >
          <div className="sidebar-heading">
            <span className="eyebrow">OBSERVATION</span>
            <button
              className="mobile-close icon-button"
              aria-label="뷰 메뉴 닫기"
              onClick={() => setMobilePanel(null)}
            >
              <X size={15} />
            </button>
          </div>
          <h2>시각화 보기</h2>
          <div className="view-list">
            {VIEWS.filter((v) => v.category === category).map((view, i) => (
              <button
                className={`view-item ${state.view === view.id ? 'active' : ''}`}
                key={view.id}
                onClick={() => chooseView(view.id)}
                aria-pressed={state.view === view.id}
              >
                <span className="view-index">{String(i + 1).padStart(2, '0')}</span>
                <span>
                  {view.label}
                  <small>{view.english}</small>
                </span>
                <ChevronRight size={13} />
              </button>
            ))}
          </div>
          <div className="sidebar-bottom">
            <span className="tiny-rule" />
            <span className="eyebrow">PLATE STUDY / 01</span>
            <p>
              사각 진동판
              <br />
              중앙 구동 / 자유 가장자리
            </p>
            <button onClick={() => setInfo(true)}>
              실험과 모델에 관하여 <ArrowRight size={12} />
            </button>
          </div>
        </aside>

        <main className={`stage ${isSplit ? 'split-stage' : ''}`} aria-label="실험 시각화">
          <Viewport
            state={state}
            controller={controller}
            onSelect={selectPart}
            onReady={onReady}
            onError={onError}
          />
          <div className="stage-grain" />
          <div className="scene-heading chrome">
            <div className="eyebrow">
              <span className="status-dot" /> CHLADNI / PARTICLE STUDIES
            </div>
            <h1>
              {state.view === 'hero' ? (
                <>
                  Chladni<span>patterns.</span>
                </>
              ) : (
                selectedView.english
              )}
            </h1>
            <p>{state.view === 'hero' ? '클라드니 패턴과 입자 이동' : selectedView.description}</p>
          </div>
          <div className="scene-status chrome">
            <span className="model-badge">ANALYTIC MODEL</span>
            <span>중앙 구동 · 자유 가장자리</span>
          </div>

          {!ready && !error && (
            <div className="loading-state" role="status">
              <div className="loader" />
              실험 장면을 준비하는 중
            </div>
          )}
          {error && (
            <div className="error-state" role="alert">
              <h2>3D 장면을 열 수 없습니다</h2>
              <p>{error}</p>
              <button onClick={() => location.reload()}>다시 열기</button>
            </div>
          )}

          {state.view === 'compare' && state.compareKind === 'experiment' && (
            <div className="experiment-record" style={{ left: `${state.split}%` }}>
              {media ? (
                <>
                  {media.type.startsWith('video/') ? (
                    <video
                      key={media.url}
                      src={media.url}
                      controls
                      playsInline
                      aria-label="업로드한 실험 영상"
                    />
                  ) : (
                    <img src={media.url} alt={`실제 실험 기록: ${media.name}`} />
                  )}
                  <div className="record-caption">
                    {media.name}
                    {recordFrequency && ` · ${recordFrequency} Hz`}
                  </div>
                </>
              ) : (
                <div className="upload-empty">
                  <span className="upload-cross">＋</span>
                  <h3>실험 기록을 나란히</h3>
                  <p>위에서 촬영한 사진이나 영상을 불러오세요.</p>
                  <button className="secondary-button" onClick={() => fileInput.current?.click()}>
                    실험 기록 불러오기
                  </button>
                  <small>기록은 이 기기에만 머무릅니다.</small>
                </div>
              )}
            </div>
          )}
          {isSplit && (
            <>
              <div className="split-divider" style={{ left: `${state.split}%` }}>
                <span>Ⅱ</span>
              </div>
              <div className="split-label left">
                {state.view === 'before' ? '진동 전' : `${state.frequency} Hz · 예시 모델`}
              </div>
              <div className="split-label right" style={{ left: `calc(${state.split}% + 22px)` }}>
                {state.view === 'before'
                  ? '패턴 형성 후'
                  : state.compareKind === 'experiment'
                    ? '실제 실험 기록'
                    : state.compareKind === 'inverse'
                      ? '역 패턴 · 개념 모델'
                      : `${MODES[state.compareModeIndex].frequency} Hz · 예시 모델`}
              </div>
            </>
          )}

          {['heatmap', 'mode', 'motion', 'contour'].includes(state.view) && (
            <div className="field-legend chrome">
              <div className={`legend-ramp ${state.view === 'heatmap' ? '' : 'signed'}`} />
              <span>{state.view === 'heatmap' ? '0' : '−1'}</span>
              <span>
                {state.view === 'contour'
                  ? '정규화 진폭 |φ|'
                  : state.view === 'heatmap'
                    ? '정규화 진폭 |φ|'
                    : '정규화 변위 φ'}
              </span>
              <span>+1</span>
            </div>
          )}
          {['motion', 'mode'].includes(state.view) && (
            <span className="amplification-label chrome">변위 과장 · 0.65 Hz로 느리게 재생</span>
          )}
          {state.view === 'causal' && (
            <div className="causal-steps chrome">
              {CAUSAL_LABELS.map((label, i) => (
                <button
                  key={label}
                  className={Math.min(4, Math.floor(state.time / 2.4)) === i ? 'active' : ''}
                  onClick={() => set({ time: i * 2.4, playing: false })}
                >
                  <span>0{i + 1}</span>
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="camera-tools glass chrome" role="group" aria-label="카메라 시점">
            <button
              className={state.camera === 'hero' ? 'active' : ''}
              onClick={() => set({ camera: 'hero', cameraRevision: state.cameraRevision + 1 })}
              title="장비 전경"
            >
              <Focus size={15} />
              <span>전경</span>
            </button>
            <button
              className={state.camera === 'top' ? 'active' : ''}
              onClick={() => set({ camera: 'top', cameraRevision: state.cameraRevision + 1 })}
              title="수직 시점"
            >
              <Layers3 size={15} />
              <span>수직</span>
            </button>
            <button
              className={state.camera === 'macro' ? 'active' : ''}
              onClick={() => set({ camera: 'macro', cameraRevision: state.cameraRevision + 1 })}
              title="접사"
            >
              <Camera size={15} />
              <span>접사</span>
            </button>
            <span className="tool-separator" />
            <button onClick={capture} title="장면 PNG 저장" aria-label="장면 PNG 저장">
              <ArrowDownToLine size={15} />
            </button>
          </div>
          <div className="stage-caption chrome">
            <span>Al / 300 × 300 mm</span>
            <span>설계 치수</span>
          </div>
          <div className="orbit-hint chrome">
            <span className="orbit-circle" />
            드래그로 회전 <span>·</span> 스크롤로 확대
          </div>
          <div className="stage-actions chrome">
            <button
              className="icon-button"
              onClick={() => setClean(true)}
              aria-label="클린 모드"
              title="클린 모드 · C"
            >
              <Eye size={17} />
            </button>
            <button
              className="icon-button"
              onClick={fullscreen}
              aria-label="전체 화면 발표 모드"
              title="전체 화면"
            >
              <Expand size={17} />
            </button>
          </div>
          {clean && (
            <button className="restore-ui glass" onClick={() => setClean(false)}>
              <Eye size={14} /> 컨트롤 표시 <kbd>C</kbd>
            </button>
          )}
        </main>

        <aside
          className={`inspector chrome ${mobilePanel === 'settings' ? 'mobile-open' : ''}`}
          aria-label="실험 설정"
        >
          <div className="inspector-tabs">
            <button
              className={inspectorTab === 'settings' ? 'active' : ''}
              onClick={() => setInspectorTab('settings')}
            >
              실험 조건
            </button>
            <button
              className={inspectorTab === 'parts' ? 'active' : ''}
              onClick={() => setInspectorTab('parts')}
            >
              구조 · 레이어
            </button>
            <button
              className="mobile-close icon-button"
              aria-label="설정 닫기"
              onClick={() => setMobilePanel(null)}
            >
              <X size={15} />
            </button>
          </div>
          <div className="inspector-content">
            {inspectorTab === 'settings' ? (
              <>
                <section className="control-section mode-section">
                  <div className="section-title">
                    <span>모드 선택</span>
                    <span className="eyebrow">
                      MODE / {String(state.modeIndex + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <div className="mode-grid">
                    {MODES.map((item, i) => (
                      <button
                        key={item.id}
                        className={`mode-option ${state.modeIndex === i ? 'active' : ''}`}
                        onClick={() =>
                          set({
                            modeIndex: i,
                            frequency: item.frequency,
                            time: 9.6,
                            playing: false,
                          })
                        }
                        aria-label={`모드 ${i + 1}, ${item.frequency} Hz 예시`}
                        aria-pressed={state.modeIndex === i}
                      >
                        <ModePreview modeIndex={i} />
                        <span>0{i + 1}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mode-name">
                    {mode.name}
                    <span>
                      φ{mode.m},{mode.n}
                    </span>
                  </p>
                </section>
                <section className="control-section">
                  <label className="section-title" htmlFor="frequency">
                    <span>구동 주파수</span>
                    <span className="unit">Hz</span>
                  </label>
                  <div className="frequency-value">
                    <input
                      id="frequency"
                      type="number"
                      min="100"
                      max="1300"
                      step="1"
                      value={state.frequency}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n))
                          set({ frequency: Math.max(100, Math.min(1300, n)) });
                      }}
                    />
                    <span>예시</span>
                  </div>
                  <input
                    aria-label="구동 주파수 조절"
                    className="range frequency-range"
                    type="range"
                    min="100"
                    max="1300"
                    step="1"
                    value={state.frequency}
                    onChange={(e) => set({ frequency: +e.target.value })}
                  />
                  <div className="range-labels">
                    <span>100</span>
                    <button onClick={() => set({ frequency: mode.frequency })}>
                      기준 {mode.frequency} Hz로
                    </button>
                    <span>1,300</span>
                  </div>
                  <div className="response-meter">
                    <span>상대 응답</span>
                    <div>
                      <i style={{ width: `${response(state.frequency, mode.frequency) * 100}%` }} />
                    </div>
                    <span>{Math.round(response(state.frequency, mode.frequency) * 100)}%</span>
                  </div>
                </section>
                <section className="control-section">
                  <label className="section-title" htmlFor="amplitude">
                    <span>구동 세기</span>
                    <span className="mono">
                      {Math.round(state.amplitude * 100)}
                      <small> / 100</small>
                    </span>
                  </label>
                  <input
                    id="amplitude"
                    className="range"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={state.amplitude}
                    onChange={(e) => set({ amplitude: +e.target.value })}
                  />
                  <div className="range-labels">
                    <span>약하게</span>
                    <span>강하게</span>
                  </div>
                </section>
                <section className="control-section">
                  <label className="section-title" htmlFor="particle-material">
                    입자 재질
                  </label>
                  <div className="select-wrap">
                    <select
                      id="particle-material"
                      value={state.particleKind}
                      onChange={(e) =>
                        set({ particleKind: e.target.value as SceneState['particleKind'] })
                      }
                    >
                      <option value="sand">규사</option>
                      <option value="salt">소금</option>
                      <option value="mixture">규사 + 소금</option>
                    </select>
                    <ChevronDown size={13} />
                  </div>
                  <div className="material-detail">
                    <span className="grain-swatch" />
                    <span>
                      {state.particleKind === 'mixture'
                        ? '혼합 입자 · 이동성 비교 모델'
                        : state.particleKind === 'salt'
                          ? '백색 입자 · 이동성 예시 0.72'
                          : '천연 입자 · 이동성 예시 1.00'}
                    </span>
                    <span>7,200</span>
                  </div>
                </section>
                {state.view === 'exploded' && (
                  <section className="control-section">
                    <label className="section-title" htmlFor="explosion">
                      부품 간격 <span className="mono">{Math.round(state.explosion * 100)}%</span>
                    </label>
                    <input
                      id="explosion"
                      className="range"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={state.explosion}
                      onChange={(e) => set({ explosion: +e.target.value })}
                    />
                  </section>
                )}
                {isSplit && (
                  <section className="control-section comparison-controls">
                    <div className="section-title">비교 조건</div>
                    {state.view === 'compare' && (
                      <>
                        <div className="select-wrap">
                          <select
                            aria-label="비교 방식"
                            value={state.compareKind}
                            onChange={(e) => set({ compareKind: e.target.value as CompareKind })}
                          >
                            <option value="frequency">서로 다른 모드</option>
                            <option value="experiment">실제 실험 vs 모델</option>
                            <option value="inverse">직접 vs 역 패턴 · 개념</option>
                          </select>
                          <ChevronDown size={13} />
                        </div>
                        {state.compareKind === 'frequency' && (
                          <div className="select-wrap">
                            <select
                              aria-label="오른쪽 비교 모드"
                              value={state.compareModeIndex}
                              onChange={(e) => set({ compareModeIndex: +e.target.value })}
                            >
                              {MODES.map((m, i) => (
                                <option key={m.id} value={i}>
                                  모드 0{i + 1} · {m.frequency} Hz
                                </option>
                              ))}
                            </select>
                            <ChevronDown size={13} />
                          </div>
                        )}
                        {state.compareKind === 'experiment' && (
                          <>
                            <button
                              className="secondary-button"
                              onClick={() => fileInput.current?.click()}
                            >
                              {media ? '실험 기록 바꾸기' : '실험 기록 불러오기'}
                            </button>
                            <label className="record-frequency">
                              실측 주파수 (Hz)
                              <input
                                type="number"
                                min="1"
                                placeholder="미입력"
                                value={recordFrequency}
                                onChange={(e) => setRecordFrequency(e.target.value)}
                              />
                            </label>
                          </>
                        )}
                        {state.compareKind === 'inverse' && (
                          <p className="control-note">
                            역 패턴은 유체 효과를 대신한 이동 방향 비교입니다. 실제 분리 예측이
                            아닙니다.
                          </p>
                        )}
                      </>
                    )}
                    <label className="section-title split-control" htmlFor="split">
                      분할 위치<span>{state.split}%</span>
                    </label>
                    <input
                      id="split"
                      className="range"
                      type="range"
                      min="30"
                      max="70"
                      value={state.split}
                      onChange={(e) => set({ split: +e.target.value })}
                    />
                  </section>
                )}
                <section className="layer-shortcuts">
                  <div className="section-title">
                    표시 레이어
                    <button className="quiet-button" onClick={() => setInspectorTab('parts')}>
                      전체 <ChevronRight size={11} />
                    </button>
                  </div>
                  {[
                    { key: 'particles' as const, label: '입자' },
                    { key: 'nodes' as const, label: '마디선' },
                    { key: 'annotations' as const, label: '부품 라벨' },
                  ].map((layer) => (
                    <label className="toggle-row" key={layer.key}>
                      <span>{layer.label}</span>
                      <input
                        type="checkbox"
                        checked={state[layer.key]}
                        onChange={(e) => set({ [layer.key]: e.target.checked })}
                      />
                      <span className="switch" />
                    </label>
                  ))}
                </section>
              </>
            ) : (
              <>
                <div className="parts-intro">부품을 선택하면 장면에서 강조됩니다.</div>
                <div className="part-list">
                  {PARTS.map((part) => (
                    <div
                      className={`part-row ${state.selectedPart === part.id ? 'selected' : ''}`}
                      key={part.id}
                    >
                      <button
                        className="part-select"
                        onClick={() => selectPart(part.id)}
                        aria-pressed={state.selectedPart === part.id}
                      >
                        <span className="mono">{part.index}</span>
                        <span>
                          {part.label}
                          <small>{part.material}</small>
                        </span>
                      </button>
                      <button
                        className="icon-button part-eye"
                        onClick={() => togglePart(part.id)}
                        aria-label={`${part.label} ${isPartHidden(part.id) ? '표시' : '숨기기'}`}
                      >
                        {isPartHidden(part.id) ? <Minus size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  ))}
                </div>
                {state.selectedPart && (
                  <section className="selected-part-detail">
                    <span className="eyebrow">SELECTED PART</span>
                    <h3>{PARTS.find((p) => p.id === state.selectedPart)?.label}</h3>
                    <p>{PARTS.find((p) => p.id === state.selectedPart)?.detail}</p>
                    <button className="quiet-button" onClick={() => set({ selectedPart: null })}>
                      선택 해제 <X size={11} />
                    </button>
                  </section>
                )}
                <label className="toggle-row">
                  <span>부품 라벨</span>
                  <input
                    type="checkbox"
                    checked={state.annotations}
                    onChange={(e) => set({ annotations: e.target.checked })}
                  />
                  <span className="switch" />
                </label>
                <label className="toggle-row">
                  <span>마디선</span>
                  <input
                    type="checkbox"
                    checked={state.nodes}
                    onChange={(e) => set({ nodes: e.target.checked })}
                  />
                  <span className="switch" />
                </label>
              </>
            )}
          </div>
          <div className="model-footnote">
            <span className="model-indicator" />
            <p>
              해석 모형 · 계측 전<br />
              <span>주파수·재질 상수는 보정되지 않았습니다.</span>
            </p>
            <button onClick={() => setInfo(true)} aria-label="모델의 가정과 한계 보기">
              ↗
            </button>
          </div>
        </aside>
      </div>

      <footer className="bottom-area chrome">
        <div className="timeline-panel glass">
          <button
            className="play-button"
            aria-label={state.playing ? '일시정지' : '재생'}
            onClick={togglePlayback}
          >
            {state.playing ? (
              <Pause size={17} fill="currentColor" />
            ) : (
              <Play size={17} fill="currentColor" />
            )}
          </button>
          <button
            className="icon-button reset-button"
            aria-label="시간 초기화"
            onClick={() => set({ time: 0, playing: false })}
          >
            <RotateCcw size={15} />
          </button>
          <div className="time-readout">
            <span>{state.time.toFixed(1)}</span>
            <small>/ {DURATION.toFixed(1)} s</small>
          </div>
          <div className="timeline-track">
            <div className="timeline-labels">
              <span>{state.view === 'assembly' ? '분해' : '입자 분산'}</span>
              <span>{state.view === 'assembly' ? '조립' : '패턴 형성'}</span>
            </div>
            <input
              aria-label="실험 타임라인"
              className="range"
              type="range"
              min="0"
              max={DURATION}
              step="0.01"
              value={state.time}
              onChange={(e) => set({ time: +e.target.value, playing: false })}
            />
            <div className="timeline-ticks">
              {[0, 3, 6, 9, 12].map((t) => (
                <span key={t}>{String(t).padStart(2, '0')}</span>
              ))}
            </div>
          </div>
          <div className="speed-control">
            <select
              aria-label="재생 속도"
              value={state.speed}
              onChange={(e) => set({ speed: +e.target.value })}
            >
              <option value="0.25">0.25×</option>
              <option value="0.5">0.5×</option>
              <option value="1">1×</option>
              <option value="2">2×</option>
            </select>
            <ChevronDown size={10} />
          </div>
          <span className="timeline-divider" />
          <button className="text-button save-settings" onClick={exportSettings}>
            <SlidersHorizontal size={14} /> 조건 저장
          </button>
        </div>
        <div className="footer-meta">
          <span>QUADRAJ · CHLADNI STUDIES</span>
          <span>
            <VolumeX size={11} /> 오디오 출력 없음 <span className="footer-dot">·</span> 재현 가능한
            해석 모델
          </span>
          <button onClick={() => setInfo(true)}>
            모델 · 조작 안내 <ArrowRight size={11} />
          </button>
        </div>
      </footer>
      <div className="mobile-tools chrome">
        <button onClick={() => setMobilePanel((v) => (v === 'views' ? null : 'views'))}>
          <Layers3 size={15} />뷰
        </button>
        <span>{selectedView.label}</span>
        <button onClick={() => setMobilePanel((v) => (v === 'settings' ? null : 'settings'))}>
          <SlidersHorizontal size={15} />
          설정
        </button>
      </div>
      {presentation && (
        <div className="presentation-controls glass">
          <button
            className="icon-button"
            onClick={() => {
              if (demoStep >= 0) endDemo();
              else setPresentation(false);
            }}
            aria-label="발표 종료"
          >
            <ArrowLeft size={15} />
          </button>
          <span>
            {demoStep >= 0
              ? `${String(demoStep + 1).padStart(2, '0')} / ${String(DEMO.length).padStart(2, '0')}  ${DEMO[demoStep].label}`
              : selectedView.label}
          </span>
          {demoStep >= 0 && (
            <>
              <button
                className="icon-button"
                aria-label={demoPaused ? '데모 계속' : '데모 일시정지'}
                onClick={() => {
                  setDemoPaused((v) => !v);
                  set({ playing: demoPaused });
                }}
              >
                {demoPaused ? <Play size={14} /> : <Pause size={14} />}
              </button>
              <button
                className="icon-button"
                aria-label="다음 데모 장면"
                onClick={() => {
                  if (demoStep < DEMO.length - 1) setDemoStep((v) => v + 1);
                  else endDemo();
                }}
              >
                <ArrowRight size={15} />
              </button>
            </>
          )}
          <button className="icon-button" onClick={fullscreen} aria-label="전체 화면 전환">
            <Maximize size={14} />
          </button>
        </div>
      )}
      {toast && (
        <div className="toast glass" role="status">
          <Check size={14} />
          {toast}
        </div>
      )}
      <input
        className="sr-only"
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
        onChange={importRecord}
        aria-label="실험 기록 파일 선택"
      />
      <dialog
        ref={dialog}
        className="info-dialog"
        onClose={() => setInfo(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setInfo(false);
        }}
      >
        <button
          className="dialog-close icon-button"
          aria-label="안내 닫기"
          onClick={() => setInfo(false)}
        >
          <X size={19} />
        </button>
        <span className="eyebrow">ABOUT THE MODEL</span>
        <h2>모델의 가정과 한계</h2>
        <p>
          이 장면은 중앙 구동 진동판의 구조와 클라드니 패턴을 탐색하는 시각화 초안입니다. 실제
          장비의 유한요소 해석이나 계측 결과를 나타내지 않습니다.
        </p>
        <div className="formula">
          φ(x, z) = ½ [cos(mα) cos(nβ) − cos(nα) cos(mβ)]
          <small>α = π(x + 1)/2, β = π(z + 1)/2 · x, z ∈ [−1, 1]</small>
        </div>
        <p>
          마디선과 진폭은 위의 근사 장에서 계산합니다. 입자는 φ²의 기울기를 따라 이동하며, 소금과
          규사의 이동성 차이는 설명을 위한 예시값입니다. 표시된 주파수는 보정되지 않은 기준값이며,
          자유 가장자리·중앙 체결 조건의 실제 고유진동수와 일치하지 않습니다.
        </p>
        <p>
          역 패턴 비교는 이동 방향을 뒤집은 개념 모형입니다. 공기 흐름, 유체 내 음향 복사력,
          충돌·마찰은 풀지 않으며 분리 효율을 예측하지 않습니다. 진동 확대 화면은 정규화 상대변위를
          과장해 0.65 Hz로 보여줍니다. 중앙 구동점의 절대 운동과 모드 결합은 계산하지 않습니다.
          타임라인의 초는 시각화 시간입니다.
        </p>
        <div className="info-links">
          <a
            href="https://sciencedemonstrations.fas.harvard.edu/presentations/chladni-plates"
            target="_blank"
            rel="noreferrer"
          >
            Harvard · Chladni plates ↗
          </a>
          <a href="https://doi.org/10.1103/PhysRevLett.122.184301" target="_blank" rel="noreferrer">
            Latifi et al. · PRL 122, 184301 ↗
          </a>
        </div>
        <div className="keyboard-help">
          <span>
            <kbd>Space</kbd>재생 / 정지
          </span>
          <span>
            <kbd>C</kbd>클린 모드
          </span>
          <span>
            <kbd>R</kbd>전경
          </span>
          <span>
            <kbd>← →</kbd>시간 이동
          </span>
        </div>
        <button className="secondary-button" onClick={() => setInfo(false)}>
          탐색으로 돌아가기
        </button>
      </dialog>
    </div>
  );
}
