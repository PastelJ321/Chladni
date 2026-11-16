import type { ViewSettings } from '../experiment/types';
import { NumberField as N, SelectField as S } from './Fields';
export function StructureTools({
  view,
  setView,
}: {
  view: ViewSettings;
  setView: (v: ViewSettings) => void;
}) {
  return (
    <div className="structure-tools">
      <S
        label="장비 보기"
        value={view.structure}
        options={['assembled', 'exploded', 'assembly', 'cutaway', 'section', 'ghost'].map(
          (s, i) => [s, ['조립 상태', '분해도', '조립 순서', '부분 절개', '단면', '외형 투시'][i]],
        )}
        onChange={(s) => setView({ ...view, structure: s as ViewSettings['structure'] })}
      />
      {view.structure === 'exploded' && (
        <label>
          분해 간격
          <input
            aria-label="분해 간격"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={view.explosion}
            onChange={(e) => setView({ ...view, explosion: +e.target.value })}
          />
        </label>
      )}
      {view.structure === 'assembly' && (
        <label>
          조립 단계
          <input
            aria-label="조립 단계"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={view.assembly}
            onChange={(e) => setView({ ...view, assembly: +e.target.value })}
          />
        </label>
      )}
      {['section', 'cutaway'].includes(view.structure) && (
        <>
          <S
            label="단면 축"
            value={view.sectionAxis}
            options={['x', 'y', 'z'].map((s) => [s, s.toUpperCase()])}
            onChange={(s) => setView({ ...view, sectionAxis: s as ViewSettings['sectionAxis'] })}
          />
          <N
            label="단면 위치"
            value={(view.sectionPosition / 12) * 1000}
            step={5}
            unit="mm"
            onChange={(v) => setView({ ...view, sectionPosition: v * 0.012 })}
          />
        </>
      )}
      <p className="help">
        장비는 개념 기구 모델입니다. 계산에는 판만 포함됩니다. 실물 정합·절단면 캡은 지원하지
        않습니다.
      </p>
    </div>
  );
}
