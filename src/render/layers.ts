import type { Field, Layer } from '../experiment/types';
import { sampleGrid } from '../solver/response';
export function valueAt(f: Field, x: number, y: number, layer: Layer, phase: number) {
  const amp = sampleGrid(f.amplitude, f.size, x, y),
    w = 2 * Math.PI * f.frequency;
  return layer === 'velocity'
    ? amp * w
    : layer === 'acceleration'
      ? amp * w * w
      : layer === 'displacement'
        ? sampleGrid(f.real, f.size, x, y) * Math.cos(phase) -
          sampleGrid(f.imag, f.size, x, y) * Math.sin(phase)
        : amp;
}
export function isolines(values: number[], size: number, level: number) {
  const out: number[] = [];
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const corners = [
          [x, y],
          [x + 1, y],
          [x + 1, y + 1],
          [x, y + 1],
        ],
        hits: number[][] = [];
      for (let j = 0; j < 4; j++) {
        const a = corners[j],
          b = corners[(j + 1) % 4],
          va = values[a[1] * size + a[0]] - level,
          vb = values[b[1] * size + b[0]] - level;
        if (va > 0 !== vb > 0) {
          const t = va / (va - vb);
          hits.push([
            (a[0] + (b[0] - a[0]) * t) / (size - 1),
            (a[1] + (b[1] - a[1]) * t) / (size - 1),
          ]);
        }
      }
      for (let j = 0; j + 1 < hits.length; j += 2) out.push(...hits[j], ...hits[j + 1]);
    }
  return out;
}
export const layerLabels: Record<Layer, string> = {
  material: '재질',
  amplitude: '진폭',
  displacement: '변위',
  velocity: '속도 진폭',
  acceleration: '가속도 진폭',
  contour: '마디·등고선',
  mesh: 'FEM 메시',
  trace: '입자 궤적',
  density: '입자 밀도',
  vector: '진폭² 기울기',
};
