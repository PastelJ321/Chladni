import type { ImagePoint } from './observationTypes';
export type Homography = [number, number, number, number, number, number, number, number, number];
const square: ImagePoint[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
function cross(a: ImagePoint, b: ImagePoint, c: ImagePoint) {
  return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
}
/** Ordered corners follow plate coordinates: x-right, y-down, clockwise from top-left. */
export function validCorners(points: ImagePoint[]) {
  if (
    points.length !== 4 ||
    points.some((p) => p.length !== 2 || p.some((v) => !Number.isFinite(v) || v < 0 || v > 1))
  )
    return false;
  const turns = points.map((p, i) => cross(p, points[(i + 1) % 4], points[(i + 2) % 4]));
  return turns.every((v) => v > 1e-6);
}
function solve(A: number[][], b: number[]) {
  const a = A.map((row, i) => [...row, b[i]]);
  for (let k = 0; k < b.length; k++) {
    let pivot = k;
    for (let i = k + 1; i < b.length; i++) if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    if (Math.abs(a[pivot][k]) < 1e-12) throw Error('모서리 위치가 겹치거나 일직선입니다.');
    [a[k], a[pivot]] = [a[pivot], a[k]];
    const scale = a[k][k];
    for (let j = k; j <= b.length; j++) a[k][j] /= scale;
    for (let i = 0; i < b.length; i++)
      if (i !== k) {
        const factor = a[i][k];
        for (let j = k; j <= b.length; j++) a[i][j] -= factor * a[k][j];
      }
  }
  return a.map((row) => row[b.length]);
}
export function homography(from: ImagePoint[], to: ImagePoint[] = square): Homography {
  if (!validCorners(from) || !validCorners(to))
    throw Error('모서리를 왼쪽 위부터 시계 방향으로 지정하세요.');
  const A: number[][] = [],
    b: number[] = [];
  from.forEach(([x, y], i) => {
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(u, v);
  });
  return [...solve(A, b), 1] as Homography;
}
export function transformPoint(h: Homography, p: ImagePoint): ImagePoint {
  const [x, y] = p,
    d = h[6] * x + h[7] * y + h[8];
  if (Math.abs(d) < 1e-12) throw Error('원근 변환이 무한대로 발산합니다.');
  return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d];
}
/** Exact inverse mapping with bilinear color sampling. Input bytes remain unchanged. */
export function rectifyPixels(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  corners: ImagePoint[],
  outputWidth: number,
  outputHeight: number,
) {
  if (
    source.length !== width * height * 4 ||
    width < 1 ||
    height < 1 ||
    outputWidth < 1 ||
    outputHeight < 1
  )
    throw Error('영상 크기가 올바르지 않습니다.');
  const inverse = homography(square, corners),
    out = new Uint8ClampedArray(outputWidth * outputHeight * 4);
  for (let y = 0; y < outputHeight; y++)
    for (let x = 0; x < outputWidth; x++) {
      const [u, v] = transformPoint(inverse, [
          x / Math.max(1, outputWidth - 1),
          y / Math.max(1, outputHeight - 1),
        ]),
        px = Math.max(0, Math.min(width - 1, u * (width - 1))),
        py = Math.max(0, Math.min(height - 1, v * (height - 1))),
        x0 = Math.floor(px),
        y0 = Math.floor(py),
        x1 = Math.min(width - 1, x0 + 1),
        y1 = Math.min(height - 1, y0 + 1),
        tx = px - x0,
        ty = py - y0;
      for (let c = 0; c < 4; c++)
        out[(y * outputWidth + x) * 4 + c] =
          (source[(y0 * width + x0) * 4 + c] * (1 - tx) + source[(y0 * width + x1) * 4 + c] * tx) *
            (1 - ty) +
          (source[(y1 * width + x0) * 4 + c] * (1 - tx) + source[(y1 * width + x1) * 4 + c] * tx) *
            ty;
    }
  return out;
}
