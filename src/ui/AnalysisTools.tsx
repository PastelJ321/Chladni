import { useMemo, useState } from 'react';
import { PARTICLE_PRESETS, materialId } from '../particles/presets';
import type { Experiment } from '../experiment/useExperiment';
import type { Field, ViewSettings } from '../experiment/types';
import { SelectField as S } from './Fields';
import { layerLabels } from '../render/layers';
import {
  DEFAULT_ANALYSIS,
  researchMetrics,
  repeatability,
  metricsCSV,
  type AnalysisOptions,
  type Region,
} from '../analysis/metrics';
import { fieldAtRun } from '../simulation/particles';
import { download } from '../io/session';
const percent = (n: number | null) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);
function DensityMap({
  data,
  color,
  roi,
  label,
}: {
  data: number[];
  color: string;
  roi: Region;
  label: string;
}) {
  const n = Math.sqrt(data.length),
    max = Math.max(1e-30, ...data);
  return (
    <figure className="density-map">
      <svg viewBox={`0 0 ${n} ${n}`} role="img" aria-label={label}>
        <rect width={n} height={n} fill="#092032" />
        {data.map((v, i) =>
          v > 0 ? (
            <rect
              key={i}
              x={i % n}
              y={Math.floor(i / n)}
              width="1"
              height="1"
              fill={color}
              opacity={Math.sqrt(v / max)}
            />
          ) : null,
        )}
        <rect
          x={roi[0] * n}
          y={roi[1] * n}
          width={(roi[2] - roi[0]) * n}
          height={(roi[3] - roi[1]) * n}
          fill="none"
          stroke="#eef6f3"
          strokeWidth=".12"
        />
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
export function AnalysisTools({
  e,
  view,
  setView,
  comparison,
  setComparison,
  region,
  setRegion,
  field,
  options,
  onOptionsChange,
}: {
  e: Experiment;
  view: ViewSettings;
  setView: (v: ViewSettings) => void;
  comparison: string;
  setComparison: (s: string) => void;
  region: string;
  setRegion: (r: string) => void;
  field?: Field | null;
  options?: AnalysisOptions;
  onOptionsChange?: (options: AnalysisOptions) => void;
}) {
  const [local, setLocal] = useState<AnalysisOptions>(DEFAULT_ANALYSIS),
    o = options ?? local,
    edit = (patch: Partial<AnalysisOptions>) => {
      const next = { ...o, ...patch };
      setLocal(next);
      onOptionsChange?.(next);
    },
    sampleTime = e.playing ? Math.floor(e.time * 10) / 10 : e.time;
  const stats = useMemo(
    () =>
      e.run
        ? researchMetrics(
            e.run,
            sampleTime,
            e.run.config.drive.signal === 'sweep'
              ? fieldAtRun(e.run, sampleTime)
              : (field ?? fieldAtRun(e.run, sampleTime)),
            o,
          )
        : null,
    [e.run, sampleTime, field, o],
  );
  const repeated = useMemo(() => repeatability(e.records, e.config, o), [e.records, e.config, o]);
  const name = (i: number) => `${PARTICLE_PRESETS[materialId(e.config.grains, i as 0 | 1)].label}`;
  return (
    <aside className="analysis-tools">
      <div className="panel-heading">
        <h2>결과 분석</h2>
        <span>{stats ? `${stats.time.toFixed(2)} s` : '계산 대기'}</span>
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
          <p className="help">
            최대 변위 1 µm로 정규화한 형상입니다. 통계는 실험 응답을 사용합니다.
          </p>
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
        <h3>조건과 분포</h3>
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
      <S
        label="집계 기준"
        value={o.basis}
        options={[
          ['count', '개수'],
          ['mass', '구형 등가 질량'],
        ]}
        onChange={(basis) => edit({ basis: basis as AnalysisOptions['basis'] })}
      />
      {stats ? (
        <>
          <div className="measurement-list">
            {stats.groups
              .filter((g) => g.count > 0)
              .map((g) => (
                <div key={g.species}>
                  <span>
                    {name(g.species)} · {g.count.toLocaleString()}개 · {(g.mass * 1000).toFixed(3)}{' '}
                    g
                  </span>
                  <strong>
                    {(g.meanDistance * 1000).toFixed(3)} <small>mm 평균 이동</small>
                  </strong>
                  <dl className="band-metrics">
                    <div>
                      <dt>마디 주변</dt>
                      <dd>
                        {percent(g.initialNodeFraction)} → {percent(g.nodeFraction)}
                      </dd>
                    </div>
                    <div>
                      <dt>배 주변</dt>
                      <dd>
                        {percent(g.initialAntinodeFraction)} → {percent(g.antinodeFraction)}
                      </dd>
                    </div>
                    <div>
                      <dt>초기 대비 분포 TV</dt>
                      <dd>{g.distributionChange?.toFixed(3) ?? '—'}</dd>
                    </div>
                  </dl>
                </div>
              ))}
          </div>
          {!stats.bandAvailable && (
            <p className="help">응답 진폭이 0이므로 마디·배 비율을 정의하지 않습니다.</p>
          )}
          <div className="distribution-stat">
            <span>입자군 간 분포 TV</span>
            <strong>
              {stats.initialSpeciesDistance?.toFixed(3) ?? '—'} →{' '}
              {stats.speciesDistance?.toFixed(3) ?? '—'}
            </strong>
          </div>
          <div className="density-pair">
            {stats.groups
              .filter((g) => g.count > 0)
              .map((g) => (
                <DensityMap
                  key={g.species}
                  label={`${name(g.species)} 공간 밀도`}
                  data={o.basis === 'mass' ? g.massDensity : g.density}
                  color={g.species ? '#c8d9da' : '#d7a363'}
                  roi={o.roi}
                />
              ))}
          </div>
          <p className="help">
            {o.bins}×{o.bins} 격자 · 각 입자군 내부 최댓값으로 표시. TV는 0이면 같은 분포, 1이면
            겹치지 않는 분포입니다. 유한 표본의 차이도 포함합니다.
          </p>
          <details className="analysis-definition">
            <summary>마디·배의 집계 기준</summary>
            <label>
              마디 주변: 최대 진폭의 {Math.round(o.nodeThreshold * 100)}% 이하
              <input
                aria-label="마디 진폭 기준"
                type="range"
                min=".01"
                max=".4"
                step=".01"
                value={o.nodeThreshold}
                onChange={(ev) => edit({ nodeThreshold: +ev.target.value })}
              />
            </label>
            <label>
              배 주변: 최대 진폭의 {Math.round(o.antinodeThreshold * 100)}% 이상
              <input
                aria-label="배 진폭 기준"
                type="range"
                min=".5"
                max=".99"
                step=".01"
                value={o.antinodeThreshold}
                onChange={(ev) => edit({ antinodeThreshold: +ev.target.value })}
              />
            </label>
            <p className="help">
              같은 시점의 FEM 진폭장으로 초기·현재 위치를 분류합니다. 분모는 해당 입자군의 초기 투입{' '}
              {o.basis === 'mass' ? '총질량' : '개수'}입니다. 엄밀한 영변위 선까지의 거리나 실물
              분리 효율을 뜻하지 않습니다.
            </p>
          </details>
          <details className="roi-analysis" open>
            <summary>회수 구역</summary>
            <S
              label="회수 대상"
              value={o.targetSpecies}
              options={[
                [0, `첫째 · ${name(0)}`],
                [1, `둘째 · ${name(1)}`],
              ]}
              onChange={(v) => edit({ targetSpecies: +v as 0 | 1 })}
            />
            <div className="field-grid roi-fields">
              {['x 시작', 'y 시작', 'x 끝', 'y 끝'].map((label, i) => (
                <label key={label}>
                  {label} (%)
                  <input
                    aria-label={`회수 구역 ${label}`}
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={+(o.roi[i] * 100).toFixed(1)}
                    onChange={(ev) => {
                      const roi = [...o.roi] as Region;
                      roi[i] = +ev.target.value / 100;
                      if (roi[0] < roi[2] && roi[1] < roi[3] && roi.every((v) => v >= 0 && v <= 1))
                        edit({ roi });
                    }}
                  />
                </label>
              ))}
            </div>
            <dl className="roi-results">
              <div>
                <dt>순도</dt>
                <dd>{percent(stats.roi.purity)}</dd>
              </div>
              <div>
                <dt>회수율</dt>
                <dd>{percent(stats.roi.recovery)}</dd>
              </div>
              <div>
                <dt>초기 순도</dt>
                <dd>{percent(stats.roi.initialPurity)}</dd>
              </div>
            </dl>
            <p className="help">
              순도 = 구역 내 대상 / 구역 내 전체. 회수율 = 구역 내 대상 / 초기 투입 대상.{' '}
              {o.basis === 'mass' ? '질량' : '개수'} 기준이며 빈 구역은 —로 표시합니다.
            </p>
          </details>
          <details>
            <summary>반복 실험 편차</summary>
            <p className="help">
              같은 조건 기록 {repeated.records}개 · 서로 다른 시드 {repeated.independentSeeds}개.
              같은 시드는 독립 표본에서 제외합니다.
            </p>
            {repeated.groups.map((g) =>
              g.meanDistance?.sampleDeviation != null ? (
                <p className="repeat-stat" key={g.species}>
                  {name(g.species)} 평균 이동 {(g.meanDistance.mean * 1000).toFixed(3)} ±{' '}
                  {(g.meanDistance.sampleDeviation * 1000).toFixed(3)} mm (표본 SD, n=
                  {g.meanDistance.n})
                </p>
              ) : null,
            )}
          </details>
          <button
            className="secondary"
            onClick={() => download(metricsCSV(stats), 'chladni-analysis.csv', 'text/csv')}
          >
            분석 CSV 저장
          </button>
          <p className="help">
            직접 적분한 입자만 집계합니다. 비보정 이동 근사이며 무분리 결과도 그대로 기록합니다.
          </p>
        </>
      ) : (
        <p className="help">
          입자 실험을 실행하면 마디·배 비율, 분포 변화와 회수 구역을 분석할 수 있습니다.
        </p>
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
