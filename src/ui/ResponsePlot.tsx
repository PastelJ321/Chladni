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
  const x = (f: number) => 48 + ((f - min) / (max - min)) * 620,
    y = (a: number) =>
      125 - ((Math.max(bottom, Math.log10(Math.max(1e-30, a))) - bottom) / 4) * 100;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.frequency)},${y(p.rms)}`).join(' '),
    measuredPath = measured
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.frequency)},${y(p.amplitude)}`)
      .join(' ');
  return (
    <section className="response-panel">
      <div className="chart-header">
        <div>
          <h3>주파수 응답</h3>
          <span>질량 가중 {absolute ? '절대' : '상대'} RMS 변위 · 로그 축</span>
        </div>
        <span className="source-tag">FEM 계산</span>
      </div>
      <svg
        className="response-chart"
        viewBox="0 0 700 155"
        role="img"
        aria-label="주파수 응답 곡선"
        onClick={(e) => {
          if (!sweep) return;
          const b = e.currentTarget.getBoundingClientRect(),
            pos = ((e.clientX - b.left) / b.width) * 700;
          const f = min + Math.max(0, Math.min(1, (pos - 48) / 620)) * (max - min);
          onSelect(
            points.reduce((a, b) => (Math.abs(b.frequency - f) < Math.abs(a.frequency - f) ? b : a))
              .frequency,
          );
        }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1="48" x2="668" y1={25 + i * 25} y2={25 + i * 25} stroke="#29495c" />
            <text x="40" y={28 + i * 25} textAnchor="end">
              {((peak * 1e6) / 10 ** i).toPrecision(2)}
            </text>
          </g>
        ))}
        {[min, (min + max) / 2, max].map((f) => (
          <text key={f} x={x(f)} y="146" textAnchor="middle">
            {f.toFixed(0)} Hz
          </text>
        ))}
        <path d={path} fill="none" stroke="#59c4d2" strokeWidth="2" />
        <path
          d={measuredPath}
          fill="none"
          stroke="#ae7d3f"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        <line
          x1={x(frequency)}
          x2={x(frequency)}
          y1="20"
          y2="127"
          stroke="#6f899b"
          strokeDasharray="3 3"
        />
        {sweep?.peaks.map((p) => (
          <circle key={p.frequency} cx={x(p.frequency)} cy={y(p.rms)} r="3" fill="#416d89" />
        ))}
        {!sweep && (
          <text x="350" y="80" textAnchor="middle">
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
