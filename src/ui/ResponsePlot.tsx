import type { Sweep } from '../experiment/types';

export interface MeasuredPoint {
  frequency: number;
  amplitude: number;
}

export function ResponsePlot({
  sweep,
  frequency,
  onSelect,
  measured = [],
  absolute = false,
}: {
  sweep: Sweep | null;
  frequency: number;
  onSelect: (f: number) => void;
  measured?: MeasuredPoint[];
  absolute?: boolean;
}) {
  const points = sweep?.points ?? [],
    min = points[0]?.frequency ?? 0,
    max = points.at(-1)?.frequency ?? 1600,
    peak = Math.max(1e-12, ...points.map((p) => p.rms), ...measured.map((p) => p.amplitude)),
    bottom = Math.log10(peak) - 4;

  const x = (f: number) => 52 + ((f - min) / Math.max(1, max - min)) * 622,
    y = (a: number) =>
      126 - ((Math.max(bottom, Math.log10(Math.max(1e-30, a))) - bottom) / 4) * 100;

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.frequency)},${y(p.rms)}`).join(' ');
  const areaPath = points.length
    ? `${path} L${x(points.at(-1)!.frequency)},126 L${x(points[0].frequency)},126 Z`
    : '';
  const measuredPath = measured
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.frequency)},${y(p.amplitude)}`)
    .join(' ');
  const curX = Math.max(52, Math.min(674, x(frequency)));

  return (
    <section className="response-panel">
      <div className="chart-header">
        <div>
          <h3>주파수 응답</h3>
          <span>질량 가중 {absolute ? '절대' : '상대'} RMS 변위 · 로그 축 (µm)</span>
        </div>
        <div className="chart-legend">
          <span>
            <i className="fem" />
            FEM
          </span>
          {measured.length > 0 && (
            <span>
              <i className="measured" />
              실측
            </span>
          )}
          <span className="source-tag">FEM 계산</span>
        </div>
      </div>
      <svg
        className="response-chart"
        viewBox="0 0 700 156"
        role="img"
        aria-label="주파수 응답 곡선"
        onClick={(e) => {
          if (!sweep) return;
          const b = e.currentTarget.getBoundingClientRect(),
            pos = ((e.clientX - b.left) / b.width) * 700;
          const f = min + Math.max(0, Math.min(1, (pos - 52) / 622)) * (max - min);
          onSelect(
            points.reduce((a, b) => (Math.abs(b.frequency - f) < Math.abs(a.frequency - f) ? b : a))
              .frequency,
          );
        }}
      >
        <defs>
          <linearGradient id="femFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3ec2d3" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#3ec2d3" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <rect x="52" y="24" width="622" height="102" fill="#051320" rx="3" />
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line
              x1="52"
              x2="674"
              y1={26 + i * 25}
              y2={26 + i * 25}
              stroke="#143145"
              strokeDasharray={i === 4 ? undefined : '2 3'}
            />
            <text x="45" y={30 + i * 25} textAnchor="end">
              {((peak * 1e6) / 10 ** i).toPrecision(2)}
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((u) => {
          const f = min + u * (max - min);
          return (
            <g key={u}>
              <line x1={x(f)} x2={x(f)} y1="26" y2="126" stroke="#10293b" />
              <text x={x(f)} y="146" textAnchor="middle">
                {f.toFixed(0)} Hz
              </text>
            </g>
          );
        })}
        {areaPath && <path d={areaPath} fill="url(#femFill)" />}
        {path && <path d={path} fill="none" stroke="#3ec2d3" strokeWidth="1.8" />}
        {measuredPath && (
          <path
            d={measuredPath}
            fill="none"
            stroke="#d9a152"
            strokeWidth="1.6"
            strokeDasharray="4 3"
          />
        )}
        <line
          x1={curX}
          x2={curX}
          y1="22"
          y2="128"
          stroke="#73dce8"
          strokeWidth="1"
          strokeDasharray="3 2"
        />
        {sweep?.peaks.map((p) => (
          <g key={p.frequency}>
            <circle cx={x(p.frequency)} cy={y(p.rms)} r="5.5" fill="rgba(62,194,211,0.18)" />
            <circle cx={x(p.frequency)} cy={y(p.rms)} r="2.6" fill="#73dce8" />
          </g>
        ))}
        {!sweep && (
          <text x="363" y="80" textAnchor="middle">
            판 해석을 실행하면 응답 곡선이 나타납니다.
          </text>
        )}
      </svg>
      <div className="peak-list">
        <span>공진 후보</span>
        {sweep?.peaks.slice(0, 6).map((p) => (
          <button key={p.frequency} onClick={() => onSelect(p.frequency)}>
            {p.frequency.toFixed(1)} Hz
          </button>
        ))}
        {sweep && !sweep.peaks.length && <span>범위 내 피크 없음</span>}
      </div>
    </section>
  );
}
