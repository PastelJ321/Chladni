import type { Plate } from '../experiment/types';
import { basis, hermite, pointDofs } from './basis';
/** Equivalent attachment measures mean transverse displacement and mean rotations over a rectangle.
 * It does not enforce rigid adhesion or resolve adhesive stress, lateral motion, or connection rocking nonlinearities.
 */
export function connectorCoordinates(p: Plate) {
  const q = p.connection;
  if (!q?.enabled) return null;
  const n = p.mesh,
    count = (n + 1) ** 2 * 4;
  const displacement = new Array<number>(count).fill(0),
    rotationX = [...displacement],
    rotationY = [...displacement];
  const x0 = p.supportX - q.width / (2 * p.width),
    x1 = p.supportX + q.width / (2 * p.width),
    y0 = p.supportY - q.height / (2 * p.height),
    y1 = p.supportY + q.height / (2 * p.height);
  const cuts = (a: number, b: number) => [
    a,
    ...Array.from({ length: n - 1 }, (_, i) => (i + 1) / n).filter((v) => v > a && v < b),
    b,
  ];
  const xs = cuts(x0, x1),
    ys = cuts(y0, y1),
    gp = [-Math.sqrt(3 / 5), 0, Math.sqrt(3 / 5)],
    gw = [5 / 9, 8 / 9, 5 / 9];
  for (let ix = 1; ix < xs.length; ix++)
    for (let iy = 1; iy < ys.length; iy++)
      for (let a = 0; a < 3; a++)
        for (let b = 0; b < 3; b++) {
          const x = (xs[ix] + xs[ix - 1]) / 2 + (gp[a] * (xs[ix] - xs[ix - 1])) / 2,
            y = (ys[iy] + ys[iy - 1]) / 2 + (gp[b] * (ys[iy] - ys[iy - 1])) / 2,
            weight =
              (gw[a] * gw[b] * (xs[ix] - xs[ix - 1]) * (ys[iy] - ys[iy - 1])) /
              (4 * (x1 - x0) * (y1 - y0)),
            { ids, s, t } = pointDofs(x, y, n),
            { N } = basis(s, t, p.width / n, p.height / n),
            hx = hermite(s),
            hy = hermite(t);
          let i = 0;
          for (const [nx, ny] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ])
            for (const [dx, dy] of [
              [0, 0],
              [1, 0],
              [0, 1],
              [1, 1],
            ]) {
              const h = nx * 2 + dx,
                k = ny * 2 + dy;
              displacement[ids[i]] += N[i] * weight;
              rotationX[ids[i]] -= ((hx[0][h] * hy[1][k]) / (p.height / n)) * weight;
              rotationY[ids[i]] += ((hx[1][h] * hy[0][k]) / (p.width / n)) * weight;
              i++;
            }
        }
  return { displacement, rotationX, rotationY };
}
export const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
