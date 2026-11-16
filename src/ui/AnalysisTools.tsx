import type { Experiment } from '../experiment/useExperiment';
import type { ViewSettings } from '../experiment/types';
import { SelectField as S } from './Fields';
import { layerLabels } from '../render/layers';
import { metrics } from '../analysis/metrics';
export function AnalysisTools({
  e,
  view,
  setView,
  comparison,
  setComparison,
  region,
  setRegion,
}: {
  e: Experiment;
  view: ViewSettings;
  setView: (v: ViewSettings) => void;
  comparison: string;
  setComparison: (s: string) => void;
  region: string;
  setRegion: (r: string) => void;
}) {
  const stats = e.run ? metrics(e.run, e.time) : null;
  return (
    <aside className="analysis-tools">
      <div className="panel-heading">
        <h2>결과 관찰</h2>
      </div>
      <S
        label="분석 레이어"
        value={view.layer}
        options={['material', 'amplitude', 'displacement', 'contour', 'trace', 'density'].map(
          (id) => [id, layerLabels[id as keyof typeof layerLabels]],
        )}
        onChange={(id) => setView({ ...view, layer: id as ViewSettings['layer'] })}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={view.showMode}
          onChange={(ev) =>
            setView({
              ...view,
              showMode: ev.target.checked,
              layer: ev.target.checked ? 'displacement' : 'material',
            })
          }
        />
        계산된 고유모드
      </label>
      {view.showMode && e.modal && (
        <>
          <S
            label="고유모드"
            value={view.mode}
            options={e.modal.frequencies.map((f, i) => [i, `${i + 1} · ${f.toFixed(2)} Hz`])}
            onChange={(v) => setView({ ...view, mode: +v })}
          />
          <p className="help">형상의 최대 변위를 1 µm로 정규화해 표시합니다.</p>
        </>
      )}
      <label className="amplify-control">
        변위 표시 ×{view.gain}
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
      <S
        label="궤적 관찰 영역"
        value={region}
        options={[
          ['center', '중앙 영역'],
          ['all', '판 전체'],
          ['left', '좌측 반판'],
          ['right', '우측 반판'],
        ]}
        onChange={setRegion}
      />
      <div className="section-heading">
        <h3>분포 비교</h3>
      </div>
      <S
        label="조건 비교"
        value={comparison}
        options={[
          ['', '현재 실험'],
          ...(e.run ? [['before', '초기 / 최종'] as [string, string]] : []),
          ...e.records.map((r) => [r.id, `현재 / ${r.name}`] as [string, string]),
        ]}
        onChange={setComparison}
      />
      {stats ? (
        <div className="measurement-list">
          {stats.groups
            .filter((g) => g.count > 0)
            .map((g) => (
              <div key={g.species}>
                <span>
                  {g.species ? '소금' : '규사'} · {g.count}개
                </span>
                <strong>
                  {(g.meanDistance * 1000).toFixed(3)} <small>mm 이동</small>
                </strong>
                <p>좌측 반판 {(g.leftFraction * 100).toFixed(1)}%</p>
              </div>
            ))}
          <p className="help">
            구역: x &lt; Lx/2 · 경계 반사
            <br />
            분리 효율이 아닌 근사 이동 결과입니다.
          </p>
        </div>
      ) : (
        <p className="help">입자 실험 후 이동 거리와 분포를 확인할 수 있습니다.</p>
      )}
      <details className="advanced-settings">
        <summary>추가 분석 레이어</summary>
        <S
          label="고급 레이어"
          value={view.layer}
          options={Object.entries(layerLabels)}
          onChange={(v) => setView({ ...view, layer: v as ViewSettings['layer'] })}
        />
      </details>
    </aside>
  );
}
