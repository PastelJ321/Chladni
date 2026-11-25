import { Pause, Play, Square, X } from 'lucide-react';
import { SEQUENCES, type SequenceId } from '../animation/director';
import type { useDirector } from '../animation/useDirector';
export function DirectorControls({
  film,
  onStart,
  hasField,
  hasRun,
  hasMedia,
  onClose,
}: {
  film: ReturnType<typeof useDirector>;
  onStart: (id: SequenceId) => void;
  hasField: boolean;
  hasRun: boolean;
  hasMedia: boolean;
  onClose: () => void;
}) {
  const d = film.director;
  return (
    <div className="director-controls glass">
      <div className="director-top">
        <span>장면 연출</span>
        <select
          aria-label="연출 시퀀스"
          value={d.id ?? ''}
          onChange={(e) => {
            if (e.target.value) onStart(e.target.value as SequenceId);
          }}
        >
          <option value="">장면 선택</option>
          {SEQUENCES.map((s) => (
            <option
              key={s.id}
              value={s.id}
              disabled={
                (s.requires === 'field' && !hasField) ||
                (s.requires === 'run' && !hasRun) ||
                (s.requires === 'media' && !hasMedia)
              }
            >
              {s.label}
            </option>
          ))}
        </select>
        <button
          aria-label={d.playing ? '연출 일시정지' : '연출 재생'}
          disabled={!d.id}
          onClick={() => (d.playing ? film.pause() : film.resume())}
        >
          {d.playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button aria-label="연출 정지" onClick={film.stop}>
          <Square size={13} />
        </button>
        <button
          aria-label="연출 도구 닫기"
          onClick={() => {
            film.stop();
            onClose();
          }}
        >
          <X size={15} />
        </button>
      </div>
      <div className="director-track">
        <span>
          {d.time.toFixed(1)} / {d.duration.toFixed(0)} s
        </span>
        <input
          type="range"
          aria-label="연출 타임라인"
          disabled={!d.id}
          min="0"
          max={d.duration || 1}
          step=".05"
          value={d.time}
          onChange={(e) => film.seek(+e.target.value)}
        />
        <select
          aria-label="연출 속도"
          value={film.speed}
          onChange={(e) => film.setSpeed(+e.target.value)}
        >
          {[-1, 0.25, 0.5, 1, 1.5].map((s) => (
            <option key={s} value={s}>
              {s < 0 ? '역재생 1×' : `${s}×`}
            </option>
          ))}
        </select>
      </div>
      {d.reason && <small>{d.reason} · 자동 카메라가 중단되었습니다.</small>}
    </div>
  );
}
