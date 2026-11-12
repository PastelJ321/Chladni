import type { Experiment } from '../experiment/useExperiment';
import type { ViewSettings } from '../experiment/types';
import { metrics } from '../analysis/metrics';
import { fieldAtRun } from '../simulation/particles';
export function AnalysisPanel({
  e,
  view,
  setView,
}: {
  e: Experiment;
  view: ViewSettings;
  setView: (v: ViewSettings) => void;
}) {
  const m = e.modal,
    stats = e.run ? metrics(e.run, e.time) : null;
  const currentField = e.run ? fieldAtRun(e.run, e.time) : e.field;
  return (
    <aside className="analysis panel">
      <div className="panel-heading">
        <h2>실험 관찰</h2>
        <span className="subtle">LIVE</span>
      </div>
      <div className="data-card">
        <span className="label">구동 주파수</span>
        <div className="big-value">
          {(currentField?.frequency ?? e.config.drive.frequency).toFixed(1)}
          <small>Hz</small>
        </div>
        <span className="source-tag">{m ? 'FEM 계산' : '계산 전'}</span>
      </div>
      <dl className="data-list">
        <div>
          <dt>판 질량</dt>
          <dd>
            {(
              e.config.plate.width *
              e.config.plate.height *
              e.config.plate.thickness *
              e.config.plate.density *
              1000
            ).toFixed(1)}{' '}
            g
          </dd>
        </div>
        <div>
          <dt>최대 절대변위</dt>
          <dd>{currentField ? `${(currentField.peak * 1e6).toPrecision(3)} µm` : '—'}</dd>
        </div>
        <div>
          <dt>자유도</dt>
          <dd>{m?.freeDofs ?? '—'}</dd>
        </div>
        <div>
          <dt>계산 시간</dt>
          <dd>{m ? `${m.elapsedMs.toFixed(0)} ms` : '—'}</dd>
        </div>
      </dl>
      <div className="section-heading">
        <h3>고유모드</h3>
        <span>{m?.frequencies.length ?? 0}개</span>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={view.showMode}
          onChange={(ev) =>
            setView({
              ...view,
              showMode: ev.target.checked,
              layer: ev.target.checked ? 'displacement' : view.layer,
            })
          }
        />
        선택 모드 형상 보기
      </label>
      <div className="mode-list">
        {m?.frequencies.slice(0, 16).map((f, i) => (
          <button
            key={i}
            aria-pressed={view.showMode && view.mode === i}
            onClick={() => setView({ ...view, mode: i, showMode: true, layer: 'displacement' })}
          >
            <span>{String(i + 1).padStart(2, '0')}</span>
            {f.toFixed(2)}
            <small>Hz</small>
          </button>
        ))}
      </div>
      {view.showMode && (
        <p className="help">
          고유벡터를 최대 1 µm로 정규화한 형상입니다. 강제응답 진폭과 구분합니다.
        </p>
      )}
      <div className="section-heading">
        <h3>입자 측정</h3>
        <span className="source-tag warm">근사 모델</span>
      </div>
      {stats ? (
        <>
          <div className="metric-grid">
            {stats.groups
              .filter((g) => g.count > 0)
              .map((g) => (
                <div key={g.species}>
                  <span>{g.species ? '소금' : '규사'} 평균 이동</span>
                  <strong>
                    {(g.meanDistance * 1000).toFixed(3)}
                    <small>mm</small>
                  </strong>
                  <span>좌측 비율 {(g.leftFraction * 100).toFixed(1)}%</span>
                </div>
              ))}
          </div>
          <p className="help">
            농도 구역: {stats.region}
            <br />
            입자 {stats.total}개 · 손실 {stats.lost}개
            <br />
            경계 반사 조건 · 낙하 손실 미계산
          </p>
        </>
      ) : (
        <p className="help">입자 실험을 실행하면 이동 거리와 구역 농도를 계산합니다.</p>
      )}
      <div className="model-note">
        <strong>모델 범위</strong>
        <p>
          얇은 등방성 판 · 선형 굽힘 · 24모드 절단. 입자 운동은 비보정 근사입니다. 실제 분리 효율을
          예측하지 않습니다.
        </p>
        {m && <p>계산 상한 모드 {m.frequencies.at(-1)?.toFixed(0)} Hz. 메시 수렴을 확인하세요.</p>}
      </div>
    </aside>
  );
}
