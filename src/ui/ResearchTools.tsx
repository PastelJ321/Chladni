import { useEffect, useMemo, useRef, useState } from 'react';
import type { Experiment } from '../experiment/useExperiment';
import { download } from '../io/session';
import type { MeasuredPoint } from './ResponsePlot';
import type {
  ImagePoint,
  MediaReference,
  ObservationSnapshot,
  ManualRegionObservation,
} from '../analysis/observationTypes';
import { validateObservationSnapshot } from '../analysis/observationTypes';
import { validCorners } from '../analysis/registration';
import { inRegion, validRegion, type Region } from '../analysis/metrics';
import { frameAt } from '../simulation/particles';
import { PARTICLE_PRESETS, materialId } from '../particles/presets';
const sameFile = (a: MediaReference, b: MediaReference) =>
  a.name === b.name && a.size === b.size && a.lastModified === b.lastModified && a.type === b.type;
const embeddedImage = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
export function useObservations(time: number, notify: (s: string) => void) {
  const [media, setMedia] = useState<{ url: string; name: string; type: string } | null>(null),
    [reference, setReference] = useState<MediaReference | null>(null),
    [opacity, setOpacity] = useState(0.65),
    [overlay, setOverlay] = useState(false),
    [sync, setSync] = useState(false),
    [offset, setOffset] = useState(0),
    [frequency, setFrequency] = useState(''),
    [measured, setMeasured] = useState<MeasuredPoint[]>([]),
    [name, setName] = useState(''),
    [corners, setCorners] = useState<ImagePoint[]>([]),
    [corrected, setCorrected] = useState(false),
    [picking, setPicking] = useState(false),
    [frameTime, setFrameTime] = useState(0),
    [note, setNote] = useState(''),
    [reproduced, setReproduced] = useState<ObservationSnapshot['reproduced']>('unknown'),
    [regions, setRegions] = useState<ManualRegionObservation[]>([]),
    [roi, setROI] = useState<Region>([0.25, 0.25, 0.75, 0.75]),
    [counts, setCounts] = useState<[string, string]>(['', '']),
    [regionNote, setRegionNote] = useState(''),
    [showNodes, setShowNodes] = useState(true),
    [size, setSize] = useState<[number, number]>([1, 1]),
    [revision, setRevision] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null),
    csvInput = useRef<HTMLInputElement>(null),
    video = useRef<HTMLVideoElement>(null),
    image = useRef<HTMLImageElement>(null),
    fileGeneration = useRef(0);
  useEffect(
    () => () => {
      if (media?.url.startsWith('blob:')) URL.revokeObjectURL(media.url);
    },
    [media],
  );
  useEffect(() => {
    const v = video.current;
    if (sync && v && Number.isFinite(v.duration)) {
      const target = Math.max(0, Math.min(v.duration, time + offset));
      if (Math.abs(v.currentTime - target) > 0.04) v.currentTime = target;
    }
  }, [time, offset, sync]);
  async function load(file?: File) {
    if (!file) return;
    if (
      !/^(image\/(png|jpeg|webp)|video\/(mp4|webm|quicktime))$/.test(file.type) ||
      file.size > 250 * 1024 * 1024
    ) {
      notify('250 MB 이하 이미지 또는 영상을 선택하세요.');
      return;
    }
    const request = ++fileGeneration.current,
      ref: MediaReference = {
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
      },
      reconnect = reference && sameFile(reference, ref);
    if (!reconnect) {
      setCorners([]);
      setCorrected(false);
      setPicking(false);
      setRegions([]);
      setFrameTime(0);
      setOverlay(false);
    }
    setMedia({ url: URL.createObjectURL(file), name: file.name, type: file.type });
    setReference(ref);
    setSize([1, 1]);
    if (reference && !reconnect) notify('새 원본을 불러왔습니다. 모서리 정합을 다시 지정하세요.');
    if (file.type.startsWith('image/') && file.size <= 1_500_000) {
      try {
        const embedded = await embeddedImage(file);
        if (request === fileGeneration.current) setReference({ ...ref, embedded });
      } catch {
        /* Original object URL remains usable; file reference is retained. */
      }
    }
  }
  async function loadCSV(file?: File) {
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw Error('10 MB 이하 응답 CSV를 선택하세요.');
      const rows = (await file.text()).trim().split(/\r?\n/);
      if (rows[0].replace(/\s/g, '') !== 'frequency_hz,amplitude_um')
        throw Error('CSV 헤더: frequency_hz,amplitude_um');
      const points = rows
        .slice(1)
        .filter((row) => row.trim())
        .map((row) => {
          const [f, a] = row.split(',').map(Number);
          if (!Number.isFinite(f) || !Number.isFinite(a) || f <= 0 || a < 0)
            throw Error('실측 CSV 수치를 확인하세요.');
          return { frequency: f, amplitude: a * 1e-6 };
        });
      if (!points.length || points.length > 100000) throw Error('응답 표본 수를 확인하세요.');
      setMeasured(points.sort((a, b) => a.frequency - b.frequency));
      setName(file.name);
    } catch (e) {
      notify(String(e));
    }
  }
  function startCorners() {
    setCorners([]);
    setCorrected(false);
    setPicking(true);
    setOverlay(false);
  }
  function corner(point: ImagePoint) {
    if (!picking || corners.length >= 4) return;
    const next = [...corners, point];
    setCorners(next);
    if (next.length === 4) {
      setPicking(false);
      if (!validCorners(next))
        notify('모서리가 교차합니다. 왼쪽 위부터 시계 방향으로 다시 지정하세요.');
    }
  }
  function seekFrame(t: number) {
    const v = video.current;
    if (!v || !Number.isFinite(t) || t < 0) return;
    v.pause();
    setSync(false);
    v.currentTime = Math.min(Number.isFinite(v.duration) ? v.duration : t, t);
    setFrameTime(t);
  }
  function loaded() {
    const v = video.current,
      im = image.current;
    const w = v?.videoWidth || im?.naturalWidth || 1,
      h = v?.videoHeight || im?.naturalHeight || 1;
    setSize([w, h]);
    setRevision((x) => x + 1);
    if (v && frameTime > 0 && Number.isFinite(v.duration))
      v.currentTime = Math.min(v.duration, frameTime);
  }
  function extract() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    try {
      canvas.getContext('2d')?.drawImage(v, 0, 0);
      canvas.toBlob((b) => {
        if (b) download(b, `measured-frame-${v.currentTime.toFixed(3)}s.png`);
      });
    } catch {
      notify('영상 프레임을 읽을 수 없습니다.');
    }
  }
  function addRegion() {
    const parsed = counts.map((s) => (s.trim() === '' ? null : Number(s))) as [
      number | null,
      number | null,
    ];
    if (
      !corrected ||
      !validCorners(corners) ||
      !validRegion(roi) ||
      parsed.every((v) => v == null) ||
      parsed.some((v) => v !== null && (!Number.isInteger(v) || v < 0))
    ) {
      notify('원근 보정 후 센 입자 수를 입력하세요. 비워 둔 입자군은 미측정으로 저장합니다.');
      return;
    }
    const row: ManualRegionObservation = {
      id: crypto.randomUUID(),
      source: 'manual-observation',
      time: video.current?.currentTime ?? frameTime,
      roi: [...roi],
      counts: parsed,
      note: regionNote,
    };
    setRegions((rows) => [...rows, row].slice(-200));
    setRegionNote('');
    notify('수동 영역 관측을 기록했습니다.');
  }
  function snapshot(): ObservationSnapshot {
    return {
      schema: 'chladni-observation/1',
      media: reference ? { ...reference } : null,
      corners: corners.map((p) => [...p] as ImagePoint),
      corrected: corrected && validCorners(corners),
      opacity,
      overlay,
      sync,
      offset,
      frameTime: video.current?.currentTime ?? frameTime,
      frequency,
      note,
      reproduced,
      measured: measured.map((p) => ({ ...p })),
      responseName: name,
      regions: structuredClone(regions),
    };
  }
  function restore(raw: ObservationSnapshot) {
    const x = validateObservationSnapshot(raw);
    fileGeneration.current++;
    if (fileInput.current) fileInput.current.value = '';
    setReference(x.media);
    setMedia(
      x.media?.embedded ? { url: x.media.embedded, name: x.media.name, type: x.media.type } : null,
    );
    setCorners(x.corners);
    setCorrected(x.corrected && validCorners(x.corners));
    setPicking(false);
    setOpacity(x.opacity);
    setOverlay(x.overlay);
    setSync(x.sync);
    setOffset(x.offset);
    setFrameTime(x.frameTime);
    setFrequency(x.frequency);
    setNote(x.note);
    setReproduced(x.reproduced);
    setMeasured(x.measured);
    setName(x.responseName);
    setRegions(x.regions);
    setRevision((v) => v + 1);
  }
  function clearMedia() {
    fileGeneration.current++;
    if (fileInput.current) fileInput.current.value = '';
    setMedia(null);
    setReference(null);
    setCorners([]);
    setCorrected(false);
    setOverlay(false);
    setRegions([]);
  }
  function removeRegion(id: string) {
    setRegions((rows) => rows.filter((row) => row.id !== id));
  }
  return {
    media,
    setMedia,
    reference,
    opacity,
    setOpacity,
    overlay,
    setOverlay,
    sync,
    setSync,
    offset,
    setOffset,
    frequency,
    setFrequency,
    measured,
    name,
    fileInput,
    csvInput,
    video,
    image,
    load,
    loadCSV,
    extract,
    corners,
    corrected,
    setCorrected,
    picking,
    startCorners,
    corner,
    frameTime,
    setFrameTime,
    seekFrame,
    note,
    setNote,
    reproduced,
    setReproduced,
    regions,
    roi,
    setROI,
    counts,
    setCounts,
    regionNote,
    setRegionNote,
    addRegion,
    showNodes,
    setShowNodes,
    size,
    loaded,
    revision,
    snapshot,
    restore,
    clearMedia,
    removeRegion,
    notify,
  };
}
export type Observations = ReturnType<typeof useObservations>;
export function ResearchTools({ e, m }: { e: Experiment; m: Observations }) {
  const names = [0, 1].map((i) => PARTICLE_PRESETS[materialId(e.config.grains, i as 0 | 1)].label),
    aligned = validCorners(m.corners);
  const sampleTime = e.playing ? Math.floor(e.time * 10) / 10 : e.time;
  const simulated = useMemo(() => {
    if (!e.run || !m.corrected) return null;
    const frame = frameAt(e.run, sampleTime),
      counts = [0, 0];
    for (let i = 0; i < e.run.species.length; i++)
      if (inRegion(frame.positions[i * 2], frame.positions[i * 2 + 1], m.roi))
        counts[e.run.species[i]]++;
    return counts;
  }, [e.run, sampleTime, m.roi, m.corrected]);
  return (
    <div className="research-tools">
      <details open>
        <summary>실측 사진·영상</summary>
        <button onClick={() => m.fileInput.current?.click()}>
          {!m.media && m.reference ? '원본 파일 재연결' : '실측 기록 불러오기'}
        </button>
        {m.reference && !m.media && (
          <p className="help">
            {m.reference.name} · {m.reference.size.toLocaleString()} bytes
            <br />
            저장한 원본 참조입니다. 같은 파일을 선택하면 정합을 복원합니다.
          </p>
        )}
        {m.media && (
          <>
            <p className="file-name">{m.media.name}</p>
            <div className="registration-actions">
              <button onClick={m.startCorners}>
                {m.picking ? `모서리 ${m.corners.length + 1}/4 지정 중` : '판의 네 모서리 지정'}
              </button>
              <button disabled={!aligned} onClick={() => m.setCorrected(!m.corrected)}>
                {m.corrected ? '원본 보기' : '원근 보정 보기'}
              </button>
            </div>
            <p className="help">
              판의 왼쪽 위 → 오른쪽 위 → 오른쪽 아래 → 왼쪽 아래. x는 오른쪽, y는 아래 방향입니다.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={m.overlay}
                disabled={!m.corrected || !e.field}
                onChange={(ev) => m.setOverlay(ev.target.checked)}
              />
              판 좌표에서 계산과 중첩
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={m.showNodes}
                disabled={!m.corrected}
                onChange={(ev) => m.setShowNodes(ev.target.checked)}
              />
              계산 저진폭 경계 표시
            </label>
            <label>
              실측 영상 불투명도
              <input
                aria-label="중첩 불투명도"
                type="range"
                min="0"
                max="1"
                step=".05"
                value={m.opacity}
                onChange={(ev) => m.setOpacity(+ev.target.value)}
              />
            </label>
            <label>
              실측 주파수 (Hz)
              <input
                aria-label="실측 주파수"
                type="number"
                value={m.frequency}
                onChange={(ev) => m.setFrequency(ev.target.value)}
              />
            </label>
            {m.media.type.startsWith('video/') && (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={m.sync}
                    onChange={(ev) => m.setSync(ev.target.checked)}
                  />
                  실험 시간과 동기화
                </label>
                <label>
                  영상 오프셋 (s)
                  <input
                    aria-label="영상 오프셋"
                    type="number"
                    step=".1"
                    value={m.offset}
                    onChange={(ev) => m.setOffset(+ev.target.value)}
                  />
                </label>
                <label>
                  관찰 프레임 (s)
                  <input
                    aria-label="관찰 프레임 시간"
                    type="number"
                    min="0"
                    step=".033"
                    value={+m.frameTime.toFixed(3)}
                    onChange={(ev) => m.seekFrame(+ev.target.value)}
                  />
                </label>
                <button onClick={m.extract}>원본 프레임 PNG</button>
              </>
            )}
            {m.corrected && (
              <details className="manual-observation">
                <summary>영역 입자 수 직접 기록</summary>
                <p className="help">
                  보정 영상에서 드래그해 구역을 정한 뒤 직접 센 개수를 입력하세요. 영상이 입자
                  종류를 자동 판별하지 않습니다.
                </p>
                <div className="field-grid">
                  {names.map((name, i) => (
                    <label key={i}>
                      {i + 1} · {name}
                      <input
                        aria-label={`관측 ${i + 1} 입자 수`}
                        type="number"
                        min="0"
                        step="1"
                        value={m.counts[i]}
                        onChange={(ev) => {
                          const counts = [...m.counts] as [string, string];
                          counts[i] = ev.target.value;
                          m.setCounts(counts);
                        }}
                      />
                    </label>
                  ))}
                </div>
                {simulated && (
                  <p className="help">
                    같은 구역 계산 ({sampleTime.toFixed(2)} s): {simulated[0].toLocaleString()} /{' '}
                    {simulated[1].toLocaleString()}개. 원본 프레임과 계산 시점은 시간 오프셋으로
                    맞추세요.
                  </p>
                )}
                <label>
                  영역 메모
                  <input
                    aria-label="영역 관찰 메모"
                    value={m.regionNote}
                    maxLength={2000}
                    onChange={(ev) => m.setRegionNote(ev.target.value)}
                  />
                </label>
                <button onClick={m.addRegion}>수동 영역 관측 기록</button>
                {m.regions.map((r) => (
                  <div className="manual-region-row" key={r.id}>
                    <span>
                      {r.time.toFixed(3)} s · {r.counts.map((n) => n ?? '미측정').join(' / ')}개
                    </span>
                    <small>
                      x {r.roi[0].toFixed(2)}–{r.roi[2].toFixed(2)}, y {r.roi[1].toFixed(2)}–
                      {r.roi[3].toFixed(2)}
                    </small>
                    <p>{r.note}</p>
                    <button
                      className="quiet"
                      aria-label={`영역 관측 ${r.id} 삭제`}
                      onClick={() => m.removeRegion(r.id)}
                    >
                      삭제
                    </button>
                  </div>
                ))}
                <button
                  disabled={!m.regions.length}
                  onClick={() =>
                    download(
                      JSON.stringify(
                        {
                          source: 'manual-observation',
                          media: m.reference,
                          frequencyHz: m.frequency || null,
                          corners: m.corners,
                          regions: m.regions,
                        },
                        null,
                        2,
                      ),
                      'chladni-manual-observations.json',
                    )
                  }
                >
                  수동 관측 JSON 저장
                </button>
              </details>
            )}
            <label>
              실제 관찰
              <textarea
                aria-label="실제 관찰"
                value={m.note}
                maxLength={16000}
                onChange={(ev) => m.setNote(ev.target.value)}
              />
            </label>
            <label>
              재현 여부
              <select
                aria-label="관찰 재현 여부"
                value={m.reproduced}
                onChange={(ev) =>
                  m.setReproduced(ev.target.value as ObservationSnapshot['reproduced'])
                }
              >
                <option value="unknown">확인 전</option>
                <option value="yes">재현 확인</option>
                <option value="no">재현하지 못함</option>
              </select>
            </label>
            <button className="quiet" onClick={m.clearMedia}>
              미디어 비교 닫기
            </button>
            <p className="help">
              사용자 촬영 기록 · {m.corrected ? '4점 원근 보정' : '원근 미보정'}
              <br />
              렌즈 왜곡과 높이가 다른 입체 부품의 원근은 보정하지 않습니다. 큰 원본은 파일 참조로
              저장합니다.
            </p>
          </>
        )}
      </details>
      <details>
        <summary>저장한 실험 · {e.records.length}</summary>
        <button disabled={!e.modal || !e.sweep} onClick={() => e.saveRecord()}>
          현재 조건과 결과 기록
        </button>
        {e.records.map((r) => (
          <div className="record-row" key={r.id}>
            <span>
              {r.name}
              <small>{r.config.drive.frequency.toFixed(1)} Hz</small>
            </span>
            <button onClick={() => e.loadRecord(r)}>불러오기</button>
          </div>
        ))}
      </details>
      <details>
        <summary>실측 응답 CSV</summary>
        <button onClick={() => m.csvInput.current?.click()}>CSV 불러오기</button>
        <p className="help">
          {m.name || 'frequency_hz,amplitude_um'}
          <br />
          실측 위치와 FEM RMS의 관측량 차이를 확인하세요.
        </p>
      </details>
    </div>
  );
}
export function ObservationInputs({ m }: { m: Observations }) {
  return (
    <>
      <input
        hidden
        ref={m.fileInput}
        aria-label="실측 미디어 파일"
        type="file"
        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
        onChange={(ev) => {
          void m.load(ev.target.files?.[0]);
          ev.target.value = '';
        }}
      />
      <input
        hidden
        ref={m.csvInput}
        aria-label="실측 응답 CSV 파일"
        type="file"
        accept=".csv"
        onChange={(ev) => {
          void m.loadCSV(ev.target.files?.[0]);
          ev.target.value = '';
        }}
      />
    </>
  );
}
export { MediaPreview } from './RegisteredMedia';
