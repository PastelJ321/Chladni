import type { ViewSettings, Grains, ParticleVisualProperties } from '../experiment/types';
import { DEFAULT_PARTICLE_VISUAL, PARTICLE_PRESETS, materialId } from '../particles/presets';
export function ParticleDisplay({
  view,
  setView,
  grains,
}: {
  view: ViewSettings;
  setView: (v: ViewSettings) => void;
  grains: Grains;
}) {
  const v = view.particleVisual ?? DEFAULT_PARTICLE_VISUAL;
  const edit = (patch: Partial<ParticleVisualProperties>) =>
    setView({ ...view, particleVisual: { ...v, ...patch } });
  return (
    <details className="particle-display">
      <summary>
        입자 표시{' '}
        <span>{v.mode === 'actual' ? '실제 크기' : `관찰 ×${v.displayMagnification}`}</span>
      </summary>
      <div className="display-options">
        <fieldset className="segmented">
          <legend>입자 크기 표시</legend>
          {(['actual', 'observe'] as const).map((id) => (
            <label key={id}>
              <input
                type="radio"
                name="particle-scale"
                aria-label={id === 'actual' ? '실제 크기' : '관찰용 확대'}
                checked={v.mode === id}
                onChange={() => edit({ mode: id })}
              />
              {id === 'actual' ? '실제 크기' : '관찰용 확대'}
            </label>
          ))}
        </fieldset>
        {v.mode === 'observe' && (
          <>
            <label>
              입자 표시 배율 <output>{v.displayMagnification}×</output>
              <input
                type="range"
                aria-label="입자 표시 배율"
                min="1"
                max="8"
                step=".5"
                value={v.displayMagnification}
                onChange={(e) => edit({ displayMagnification: +e.target.value })}
              />
            </label>
            <label>
              최소 화면 지름 <output>{v.minimumPixelDiameter} px</output>
              <input
                type="range"
                aria-label="최소 입자 픽셀"
                min=".75"
                max="4"
                step=".25"
                value={v.minimumPixelDiameter}
                onChange={(e) => edit({ minimumPixelDiameter: +e.target.value })}
              />
            </label>
          </>
        )}
        <label>
          표시 표본
          <select
            aria-label="표시 입자 수"
            value={v.count}
            onChange={(e) => edit({ count: +e.target.value })}
          >
            {[0, 5000, 20000, 50000, 100000].map((n) => (
              <option key={n} value={n}>
                {n ? n.toLocaleString() + '개' : '계산 입자 전체'}
              </option>
            ))}
          </select>
        </label>
        {v.count > 0 && v.count !== grains.count && (
          <p>
            계산 {grains.count.toLocaleString()}개 · 표시 {v.count.toLocaleString()}개<br />
            표시 표본은 질량·통계에 포함하지 않습니다.
          </p>
        )}
        <details>
          <summary>표현 세부</summary>
          <label>
            입자 LOD
            <select
              aria-label="입자 LOD"
              value={v.LOD}
              onChange={(e) => edit({ LOD: e.target.value as ParticleVisualProperties['LOD'] })}
            >
              <option value="auto">자동 · 스플랫 + PBR</option>
              <option value="sprites">스플랫만</option>
            </select>
          </label>
          <label>
            색상
            <select
              aria-label="입자 색상 방식"
              value={v.shadingMode}
              onChange={(e) =>
                edit({ shadingMode: e.target.value as ParticleVisualProperties['shadingMode'] })
              }
            >
              <option value="material">재질</option>
              <option value="species">입자군 구분</option>
            </select>
          </label>
          {(['sand', 'salt'] as const).map((slot, i) => {
            const p = PARTICLE_PRESETS[materialId(grains, i as 0 | 1)],
              o = v.overrides?.[slot] ?? { color: p.color, roughness: p.roughness };
            return (
              <div key={slot} className="appearance-row">
                <span>{p.label}</span>
                <input
                  type="color"
                  aria-label={`${slot} 표시 색상`}
                  value={o.color}
                  onChange={(e) =>
                    edit({ overrides: { ...v.overrides, [slot]: { ...o, color: e.target.value } } })
                  }
                />
                <input
                  type="range"
                  aria-label={`${slot} 표시 거칠기`}
                  min=".1"
                  max="1"
                  step=".05"
                  value={o.roughness}
                  onChange={(e) =>
                    edit({
                      overrides: { ...v.overrides, [slot]: { ...o, roughness: +e.target.value } },
                    })
                  }
                />
              </div>
            );
          })}
        </details>
        <p>표시 설정은 실제 입경과 계산 결과를 바꾸지 않습니다.</p>
      </div>
    </details>
  );
}
