import { useState } from 'react';
import type { Experiment } from '../experiment/useExperiment';
import { MATERIALS, cloneConfig } from '../experiment/config';
import { NumberField as N, SelectField as S } from './Fields';
import type { Config } from '../experiment/types';
export function ConfigurationPanel({
  e,
  paint,
  setPaint,
}: {
  e: Experiment;
  paint: boolean;
  setPaint: (p: boolean) => void;
}) {
  const [tab, setTab] = useState<'plate' | 'drive' | 'grains'>('plate'),
    c = e.config,
    p = c.plate,
    d = c.drive,
    g = c.grains;
  function edit<T extends keyof Config>(section: T, key: keyof Config[T], value: unknown) {
    const next = cloneConfig(c);
    Object.assign(next[section], { [key]: value });
    e.change(next);
  }
  return (
    <aside className="configuration panel">
      <div className="panel-heading">
        <h2>실험 조건</h2>
        <span className="subtle">설계값</span>
      </div>
      <div className="segmented">
        {(['plate', 'drive', 'grains'] as const).map((t, i) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {['진동판', '구동', '입자'][i]}
          </button>
        ))}
      </div>
      <div className="config-scroll">
        {tab === 'plate' && (
          <>
            <div className="section-heading">
              <h3>판 형상</h3>
              <span>SI 기반 계산</span>
            </div>
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
            <div className="section-heading">
              <h3>등방성 재료</h3>
              <span>대표 물성 · 편집 가능</span>
            </div>
            <S
              label="재질"
              value={p.material}
              options={Object.entries(MATERIALS).map(([key, v]) => [key, v.label])}
              onChange={(v) => {
                const next = cloneConfig(c),
                  m = MATERIALS[v as keyof typeof MATERIALS];
                Object.assign(next.plate, { ...m, material: v });
                e.change(next);
              }}
            />
            <N
              label="탄성계수"
              value={p.young / 1e9}
              unit="GPa"
              onChange={(v) => edit('plate', 'young', v * 1e9)}
            />
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
            <div className="section-heading">
              <h3>경계 조건</h3>
            </div>
            <S
              label="고정 방식"
              value={p.boundary}
              onChange={(v) => edit('plate', 'boundary', v)}
              options={['center', 'simply-supported', 'clamped', 'cantilever'].map((v, i) => [
                v,
                ['중앙 절점 고정 · 가장자리 자유', '네 변 단순지지', '네 변 고정', '왼쪽 변 고정'][
                  i
                ],
              ])}
            />
            {p.boundary === 'center' && (
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
            )}
            <S
              label="계산 메시"
              value={p.mesh}
              options={[
                [4, '4 × 4 · 빠르게'],
                [6, '6 × 6 · 기본'],
                [8, '8 × 8 · 세밀하게'],
              ]}
              onChange={(v) => edit('plate', 'mesh', +v)}
            />
            <p className="help">
              중앙 고정은 가장 가까운 절점의 변위·기울기를 구속합니다. 실제 볼트 체결 패치와 장비
              강성은 포함하지 않습니다.
            </p>
          </>
        )}
        {tab === 'drive' && (
          <>
            <div className="section-heading">
              <h3>기계적 입력</h3>
              <span>수직 방향</span>
            </div>
            <S
              label="입력 방식"
              value={d.kind}
              options={[
                ['base', '고정부 변위 입력'],
                ['force', '판 위 점 힘 입력'],
              ]}
              onChange={(v) => edit('drive', 'kind', v)}
            />
            <N
              label="관찰 주파수"
              value={d.frequency}
              unit="Hz"
              onChange={(v) => edit('drive', 'frequency', v)}
            />
            {d.kind === 'base' ? (
              <N
                label="고정부 진폭"
                value={d.displacement * 1e6}
                unit="µm"
                step={0.1}
                onChange={(v) => edit('drive', 'displacement', v / 1e6)}
              />
            ) : (
              <>
                <N
                  label="점 힘 진폭"
                  value={d.force}
                  unit="N"
                  step={0.01}
                  onChange={(v) => edit('drive', 'force', v)}
                />
                <div className="field-grid">
                  <N
                    label="구동 x/Lx"
                    value={d.x}
                    step={0.05}
                    onChange={(v) => edit('drive', 'x', v)}
                  />
                  <N
                    label="구동 y/Ly"
                    value={d.y}
                    step={0.05}
                    onChange={(v) => edit('drive', 'y', v)}
                  />
                </div>
              </>
            )}
            <p className="help">
              전압→스피커→판 전달함수는 미측정입니다. 입력은 기계적 진폭이며 전기 입력을 추정하지
              않습니다.
            </p>
            <div className="section-heading">
              <h3>주파수 스윕</h3>
            </div>
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
            <N
              label="주파수 표본 수"
              value={d.samples}
              onChange={(v) => edit('drive', 'samples', v)}
            />
            <S
              label="입자 실험 신호"
              value={d.signal}
              options={[
                ['sine', '고정 주파수 정현파'],
                ['sweep', '선형 주파수 스윕 · 준정상'],
              ]}
              onChange={(v) => edit('drive', 'signal', v)}
            />
            <N
              label="실험 시간"
              value={d.duration}
              unit="s"
              step={0.5}
              onChange={(v) => edit('drive', 'duration', v)}
            />
            <p className="help">
              스윕 변화율 {((d.end - d.start) / d.duration).toFixed(1)} Hz/s. 정상 응답의 연속
              비교이며 급속 스윕의 과도응답은 풀지 않습니다.
            </p>
          </>
        )}
        {tab === 'grains' && (
          <>
            <div className="section-heading">
              <h3>입자군</h3>
              <span>운동 근사 모델</span>
            </div>
            <S
              label="입자 종류"
              value={g.kind}
              options={[
                ['sand', '규사'],
                ['salt', '소금'],
                ['mixture', '규사 + 소금'],
              ]}
              onChange={(v) => edit('grains', 'kind', v)}
            />
            <div className="field-grid">
              <N
                label="평균 입경"
                value={g.diameter * 1e6}
                unit="µm"
                onChange={(v) => edit('grains', 'diameter', v / 1e6)}
              />
              <N
                label="입경 편차"
                value={g.spread}
                step={0.05}
                onChange={(v) => edit('grains', 'spread', v)}
              />
              <N label="입자 수" value={g.count} onChange={(v) => edit('grains', 'count', v)} />
              <N label="랜덤 시드" value={g.seed} onChange={(v) => edit('grains', 'seed', v)} />
            </div>
            <N
              label="규사 밀도"
              value={g.density}
              unit="kg/m³"
              onChange={(v) => edit('grains', 'density', v)}
            />
            <N
              label="소금 밀도"
              value={g.saltDensity}
              unit="kg/m³"
              onChange={(v) => edit('grains', 'saltDensity', v)}
            />
            {g.kind === 'mixture' && (
              <N
                label="소금 혼합 비율"
                value={g.ratio}
                step={0.05}
                onChange={(v) => edit('grains', 'ratio', v)}
              />
            )}
            <div className="field-grid">
              <N
                label="마찰 근사 계수"
                value={g.friction}
                step={0.05}
                onChange={(v) => edit('grains', 'friction', v)}
              />
              <N
                label="형태 계수"
                value={g.shape}
                step={0.1}
                onChange={(v) => edit('grains', 'shape', v)}
              />
            </div>
            <N
              label="이동 경험계수"
              value={g.transport}
              onChange={(v) => edit('grains', 'transport', v)}
            />
            <S
              label="초기 분포"
              value={g.distribution}
              options={[
                ['uniform', '판 전체 균일'],
                ['spot', '중앙 영역'],
                ['paint', '직접 뿌린 영역'],
              ]}
              onChange={(v) => edit('grains', 'distribution', v)}
            />
            <button
              className={paint ? 'secondary selected' : 'secondary'}
              onClick={() => setPaint(!paint)}
            >
              {paint ? '뿌리기 종료' : '판 위에 직접 뿌리기'}
            </button>
            <button
              className="quiet"
              onClick={() => {
                const next = cloneConfig(c);
                next.grains.seed++;
                next.grains.spots = [];
                e.change(next);
              }}
            >
              초기 배치 다시 생성
            </button>
            <p className="help">
              입경은 균등분포입니다. 마찰·충돌의 경험적 이동과 Stokes 완화만 근사합니다. 입자 간
              충돌과 역 클라드니 유동은 계산하지 않습니다.
            </p>
          </>
        )}
      </div>
      <div className="config-actions">
        <button className="primary" disabled={e.busy} onClick={e.solve}>
          판 해석 · 스윕 계산
        </button>
        <div className="compute-status" role="status">
          {e.status}
          {e.busy && ` ${Math.round(e.progress * 100)}%`}
        </div>
        {e.busy && <progress max="1" value={e.progress} />}
        {e.error && (
          <p className="error" role="alert">
            {e.error}
          </p>
        )}
      </div>
    </aside>
  );
}
