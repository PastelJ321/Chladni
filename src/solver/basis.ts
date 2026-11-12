// Tensor cubic Hermite basis; derivative DOFs scaled by cell dimensions.
export function hermite(s: number) {
  return [
    [
      1 - 3 * s * s + 2 * s * s * s,
      s - 2 * s * s + s * s * s,
      3 * s * s - 2 * s * s * s,
      -s * s + s * s * s,
    ],
    [-6 * s + 6 * s * s, 1 - 4 * s + 3 * s * s, 6 * s - 6 * s * s, -2 * s + 3 * s * s],
    [-6 + 12 * s, -4 + 6 * s, 6 - 12 * s, -2 + 6 * s],
  ];
}
export function basis(s: number, t: number, dx: number, dy: number) {
  const hx = hermite(s),
    hy = hermite(t),
    N: number[] = [],
    xx: number[] = [],
    yy: number[] = [],
    xy: number[] = [];
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ])
    for (const [a, b] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const i = x * 2 + a,
        j = y * 2 + b;
      N.push(hx[0][i] * hy[0][j]);
      xx.push((hx[2][i] * hy[0][j]) / dx ** 2);
      yy.push((hx[0][i] * hy[2][j]) / dy ** 2);
      xy.push((2 * hx[1][i] * hy[1][j]) / (dx * dy));
    }
  return { N, xx, yy, xy };
}
export function pointDofs(x: number, y: number, n: number) {
  const ex = Math.min(n - 1, Math.floor(Math.max(0, x) * n)),
    ey = Math.min(n - 1, Math.floor(Math.max(0, y) * n));
  const ids: number[] = [];
  for (const [a, b] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ])
    for (let k = 0; k < 4; k++) ids.push(((ey + b) * (n + 1) + ex + a) * 4 + k);
  return { ids, s: x * n - ex, t: y * n - ey };
}
