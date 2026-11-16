import { useEffect, useRef, useState } from 'react';
import type { Experiment } from '../experiment/useExperiment';
import { download } from '../io/session';
import type { MeasuredPoint } from './ResponsePlot';
export function useObservations(time: number, notify: (s: string) => void) {
  const [media, setMedia] = useState<{ url: string; name: string; type: string } | null>(null),
    [opacity, setOpacity] = useState(0.75),
    [overlay, setOverlay] = useState(false),
    [sync, setSync] = useState(false),
    [offset, setOffset] = useState(0),
    [frequency, setFrequency] = useState(''),
    [measured, setMeasured] = useState<MeasuredPoint[]>([]),
    [name, setName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null),
    csvInput = useRef<HTMLInputElement>(null),
    video = useRef<HTMLVideoElement>(null);
  useEffect(
    () => () => {
      if (media) URL.revokeObjectURL(media.url);
    },
    [media],
  );
  useEffect(() => {
    if (sync && video.current && Number.isFinite(video.current.duration))
      video.current.currentTime = Math.max(0, Math.min(video.current.duration, time + offset));
  }, [time, offset, sync]);
  function load(file?: File) {
    if (!file) return;
    if (
      !/^(image\/(png|jpeg|webp)|video\/(mp4|webm|quicktime))$/.test(file.type) ||
      file.size > 250 * 1024 * 1024
    ) {
      notify('250 MB 이하 이미지 또는 영상을 선택하세요.');
      return;
    }
    setMedia({ url: URL.createObjectURL(file), name: file.name, type: file.type });
  }
  async function loadCSV(file?: File) {
    if (!file) return;
    try {
      const rows = (await file.text()).trim().split(/\r?\n/);
      if (rows[0].replace(/\s/g, '') !== 'frequency_hz,amplitude_um')
        throw Error('CSV 헤더: frequency_hz,amplitude_um');
      const points = rows.slice(1).map((row) => {
        const [f, a] = row.split(',').map(Number);
        if (!Number.isFinite(f) || !Number.isFinite(a) || f <= 0 || a < 0)
          throw Error('실측 CSV 수치를 확인하세요.');
        return { frequency: f, amplitude: a * 1e-6 };
      });
      setMeasured(points.sort((a, b) => a.frequency - b.frequency));
      setName(file.name);
    } catch (e) {
      notify(String(e));
    }
  }
  function extract() {
    const v = video.current;
    if (!v) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    try {
      canvas.getContext('2d')?.drawImage(v, 0, 0);
      canvas.toBlob((b) => {
        if (b) download(b, `measured-frame-${v.currentTime.toFixed(2)}s.png`);
      });
    } catch {
      notify('영상 프레임을 읽을 수 없습니다.');
    }
  }
  return {
    media,
    setMedia,
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
    load,
    loadCSV,
    extract,
  };
}
export type Observations = ReturnType<typeof useObservations>;
export function ResearchTools({ e, m }: { e: Experiment; m: Observations }) {
  return (
    <div className="research-tools">
      <details open>
        <summary>실측 사진·영상</summary>
        <button onClick={() => m.fileInput.current?.click()}>실측 기록 불러오기</button>
        {m.media && (
          <>
            <p className="file-name">{m.media.name}</p>
            <label className="check">
              <input
                type="checkbox"
                checked={m.overlay}
                onChange={(ev) => m.setOverlay(ev.target.checked)}
              />
              계산 화면에 중첩
            </label>
            <label>
              불투명도
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
                <button onClick={m.extract}>관찰 프레임 PNG</button>
              </>
            )}
            <button className="quiet" onClick={() => m.setMedia(null)}>
              미디어 비교 닫기
            </button>
            <p className="help">
              사용자 촬영 기록 · 원근 미보정
              <br />
              수직 촬영 영상으로 비교하세요.
            </p>
          </>
        )}
      </details>
      <details>
        <summary>저장한 실험 · {e.records.length}</summary>
        <button disabled={!e.modal || !e.sweep} onClick={e.saveRecord}>
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
          m.load(ev.target.files?.[0]);
          ev.target.value = '';
        }}
      />
      <input
        hidden
        ref={m.csvInput}
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
export function MediaPreview({ m }: { m: Observations }) {
  if (!m.media) return null;
  return (
    <div
      className={`media-preview ${m.overlay ? 'overlay' : ''}`}
      style={m.overlay ? { opacity: m.opacity } : undefined}
    >
      {m.media.type.startsWith('video/') ? (
        <video ref={m.video} src={m.media.url} controls playsInline />
      ) : (
        <img src={m.media.url} alt={`실측 기록 ${m.media.name}`} />
      )}
      <span>
        실측 · {m.media.name} {m.frequency && ` / ${m.frequency} Hz`} · 원근 미보정
      </span>
    </div>
  );
}
