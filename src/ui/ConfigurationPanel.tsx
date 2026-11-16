import type { Experiment } from '../experiment/useExperiment';
import {
  cloneConfig,
  independentGroups,
  particleGroup,
  SIEVE_RANGES,
  sieveGroup,
  MATERIALS,
} from '../experiment/config';
import type { Config, ParticleGroup } from '../experiment/types';
import { NumberField as N, SelectField as S } from './Fields';
export function AdvancedSettings({ e }: { e: Experiment }) {
  const c = e.config,
    p = c.plate,
    d = c.drive;
  const edit = (section: 'plate' | 'drive' | 'grains', key: string, value: unknown) => {
    const n = cloneConfig(c);
    Object.assign(n[section], { [key]: value });
    e.change(n);
  };
  return (
    <details className="advanced-settings">
      <summary>장비·계산 고급 설정</summary>
      <p className="help">
        기본 장비는 중앙 구동 알루미늄판입니다. 치수·물성은 실측 전 설계값입니다.
      </p>
      <div className="field-grid">
        <N
          label="가로"
          value={p.width * 1000}
          unit="mm"
          onChange={(v) => edit('plate', 'width', v / 1000)}
        />
        <N
          label="세로"
          value={p.height * 1000}
          unit="mm"
          onChange={(v) => edit('plate', 'height', v / 1000)}
        />
        <N
          label="두께"
          value={p.thickness * 1000}
          unit="mm"
          step={0.1}
          onChange={(v) => edit('plate', 'thickness', v / 1000)}
        />
        <N
          label="감쇠비"
          value={p.damping}
          step={0.001}
          onChange={(v) => edit('plate', 'damping', v)}
        />
      </div>
      <S
        label="판 재질"
        value={p.material}
        options={Object.entries(MATERIALS).map(([id, m]) => [id, m.label])}
        onChange={(id) => {
          const n = cloneConfig(c);
          Object.assign(n.plate, MATERIALS[id as keyof typeof MATERIALS], { material: id });
          e.change(n);
        }}
      />
      <N
        label="탄성계수"
        value={p.young / 1e9}
        unit="GPa"
        onChange={(v) => edit('plate', 'young', v * 1e9)}
      />
      <div className="field-grid">
        <N
          label="판 밀도"
          value={p.density}
          unit="kg/m³"
          onChange={(v) => edit('plate', 'density', v)}
        />
        <N
          label="포아송비"
          value={p.poisson}
          step={0.01}
          onChange={(v) => edit('plate', 'poisson', v)}
        />
      </div>
      <S
        label="경계 조건"
        value={p.boundary}
        options={[
          ['center', '중앙 절점 고정'],
          ['simply-supported', '네 변 단순지지'],
          ['clamped', '네 변 고정'],
          ['cantilever', '한 변 고정'],
        ]}
        onChange={(v) => edit('plate', 'boundary', v)}
      />
      <div className="field-grid">
        <N
          label="고정 x/Lx"
          value={p.supportX}
          step={0.05}
          onChange={(v) => edit('plate', 'supportX', v)}
        />
        <N
          label="고정 y/Ly"
          value={p.supportY}
          step={0.05}
          onChange={(v) => edit('plate', 'supportY', v)}
        />
      </div>
      <S
        label="FEM 메시"
        value={p.mesh}
        options={[
          [4, '4 × 4'],
          [6, '6 × 6'],
          [8, '8 × 8'],
        ]}
        onChange={(v) => edit('plate', 'mesh', +v)}
      />
      <S
        label="기계적 입력"
        value={d.kind}
        options={[
          ['base', '고정부 변위'],
          ['force', '점 힘'],
        ]}
        onChange={(v) => edit('drive', 'kind', v)}
      />
      {d.kind === 'force' && (
        <>
          <N
            label="점 힘 진폭"
            value={d.force}
            unit="N"
            step={0.01}
            onChange={(v) => edit('drive', 'force', v)}
          />
          <div className="field-grid">
            <N label="구동 x/Lx" value={d.x} step={0.05} onChange={(v) => edit('drive', 'x', v)} />
            <N label="구동 y/Ly" value={d.y} step={0.05} onChange={(v) => edit('drive', 'y', v)} />
          </div>
        </>
      )}
      <N label="스윕 표본 수" value={d.samples} onChange={(v) => edit('drive', 'samples', v)} />
      <N
        label="이동 경험계수"
        value={c.grains.transport}
        onChange={(v) => edit('grains', 'transport', v)}
      />
    </details>
  );
}
export function ConfigurationPanel({
  e,
  paint,
  setPaint,
}: {
  e: Experiment;
  paint: boolean;
  setPaint: (p: boolean) => void;
}) {
  const c = e.config,
    d = c.drive,
    g = c.grains;
  const edit = (section: keyof Config, key: string, value: unknown) => {
    const n = cloneConfig(c);
    Object.assign(n[section], { [key]: value });
    e.change(n);
  };
  function groupEdit(species: 'sand' | 'salt', patch: Partial<ParticleGroup>) {
    const n = cloneConfig(c);
    n.grains.groups = independentGroups(n.grains);
    Object.assign(n.grains.groups[species], patch);
    if (patch.diameter !== undefined || patch.spread !== undefined)
      n.grains.groups[species].sieve = 'custom';
    e.change(n);
  }
  return (
    <aside className="configuration">
      <div className="panel-heading">
        <h2>실험 조건</h2>
        <span>중앙 구동판</span>
      </div>
      <div className="config-scroll">
        <section className="frequency-section">
          <label className="frequency-input">
            구동 주파수
            <div>
              <input
                aria-label="관찰 주파수"
                type="number"
                min="1"
                max="5000"
                value={d.frequency}
                onChange={(ev) => {
                  const v = +ev.target.value;
                  if (v > 0 && v <= 5000) edit('drive', 'frequency', v);
                }}
              />
              <span>Hz</span>
            </div>
          </label>
          <details className="sweep-settings">
            <summary>
              스윕 범위 · {d.start}–{d.end} Hz
            </summary>
            <div className="field-grid">
              <N
                label="시작 주파수"
                value={d.start}
                unit="Hz"
                onChange={(v) => edit('drive', 'start', v)}
              />
              <N
                label="끝 주파수"
                value={d.end}
                unit="Hz"
                onChange={(v) => edit('drive', 'end', v)}
              />
            </div>
          </details>
          <details className="drive-details">
            <summary>구동 세부 · {d.duration} s</summary>
            <div className="field-grid">
              <N
                label="구동 진폭"
                value={d.displacement * 1e6}
                unit="µm"
                step={0.1}
                onChange={(v) => edit('drive', 'displacement', v / 1e6)}
              />
              <N
                label="실험 시간"
                value={d.duration}
                unit="s"
                step={0.5}
                onChange={(v) => edit('drive', 'duration', v)}
              />
            </div>
            <S
              label="실험 신호"
              value={d.signal}
              options={[
                ['sine', '고정 주파수'],
                ['sweep', '33단계 준정상 스윕'],
              ]}
              onChange={(v) => edit('drive', 'signal', v)}
            />
          </details>
        </section>
        <div className="section-heading">
          <h3>혼합 입자</h3>
        </div>
        <S
          label="입자 조합"
          value={g.kind}
          options={[
            ['mixture', '규사 + 소금'],
            ['sand', '규사만'],
            ['salt', '소금만'],
          ]}
          onChange={(v) => edit('grains', 'kind', v)}
        />
        {(['sand', 'salt'] as const)
          .filter((id) => g.kind === 'mixture' || g.kind === id)
          .map((id) => {
            const group = particleGroup(g, id === 'salt' ? 1 : 0),
              name = id === 'sand' ? '규사' : '소금';
            return (
              <section className={`grain-card ${id}`} key={id}>
                <h3>
                  <i />
                  {name}
                  <small>
                    {(group.diameter * (1 - group.spread) * 1e6).toFixed(0)}–
                    {(group.diameter * (1 + group.spread) * 1e6).toFixed(0)} µm
                  </small>
                </h3>
                <S
                  label={`${name} 체 구간`}
                  value={group.sieve}
                  options={[
                    ['custom', '직접 설정'],
                    ['legacy', 'v0.2 조건'],
                    ...SIEVE_RANGES.map(
                      ([a, b]) => [`${a}–${b}`, `${a}–${b} µm`] as [string, string],
                    ),
                  ]}
                  onChange={(v) => {
                    const range = SIEVE_RANGES.find(([a, b]) => v === `${a}–${b}`);
                    if (range) {
                      const n = cloneConfig(c);
                      n.grains.groups = independentGroups(n.grains);
                      n.grains.groups[id] = sieveGroup(group, range[0], range[1]);
                      e.change(n);
                    }
                  }}
                />
                <div className="field-grid">
                  <N
                    label={`${name} 평균 입경`}
                    value={group.diameter * 1e6}
                    unit="µm"
                    onChange={(v) => groupEdit(id, { diameter: v / 1e6 })}
                  />
                  <N
                    label={`${name} 입경 편차`}
                    value={Math.round(group.spread * 10000) / 100}
                    unit="±%"
                    step={1}
                    onChange={(v) => groupEdit(id, { spread: v / 100 })}
                  />
                </div>
                <details>
                  <summary>밀도·마찰</summary>
                  <N
                    label={`${name} 밀도`}
                    value={group.density}
                    unit="kg/m³"
                    onChange={(v) => groupEdit(id, { density: v })}
                  />
                  <div className="field-grid">
                    <N
                      label={`${name} 마찰 계수`}
                      value={group.friction}
                      step={0.05}
                      onChange={(v) => groupEdit(id, { friction: v })}
                    />
                    <N
                      label={`${name} 형태 계수`}
                      value={group.shape}
                      step={0.1}
                      onChange={(v) => groupEdit(id, { shape: v })}
                    />
                  </div>
                </details>
              </section>
            );
          })}
        <p className="help">
          체 구간은 명목 프리셋입니다. 실제 체눈과 선별 입경은 실험 기록으로 확인하세요.
        </p>
        <div className="field-grid">
          <N label="입자 수" value={g.count} onChange={(v) => edit('grains', 'count', v)} />
          {g.kind === 'mixture' && (
            <N
              label="소금 혼합 비율"
              value={g.ratio * 100}
              unit="%"
              onChange={(v) => edit('grains', 'ratio', v / 100)}
            />
          )}
        </div>
        <details>
          <summary>초기 배치·반복 조건</summary>
          <N label="랜덤 시드" value={g.seed} onChange={(v) => edit('grains', 'seed', v)} />
          <S
            label="초기 분포"
            value={g.distribution}
            options={[
              ['uniform', '판 전체'],
              ['spot', '중앙 영역'],
              ['paint', '직접 뿌린 영역'],
            ]}
            onChange={(v) => edit('grains', 'distribution', v)}
          />
          <button className="secondary" onClick={() => setPaint(!paint)}>
            {paint ? '뿌리기 종료' : '판 위에 직접 뿌리기'}
          </button>
          <button className="quiet" onClick={() => edit('grains', 'seed', g.seed + 1)}>
            새 시드로 배치
          </button>
        </details>
        <AdvancedSettings e={e} />
      </div>
      <div className="config-actions">
        <div className="run-actions">
          <button disabled={e.busy} onClick={e.solve}>
            스윕 계산
          </button>
          <button
            className="primary"
            disabled={!e.field || !e.modal || e.busy}
            onClick={e.simulate}
          >
            입자 실험
          </button>
        </div>
        <div className="compute-status" role="status">
          {e.status}
          {e.busy && ` · ${Math.round(e.progress * 100)}%`}
        </div>
        {e.error && (
          <p role="alert" className="error">
            {e.error}
          </p>
        )}
      </div>
    </aside>
  );
}
