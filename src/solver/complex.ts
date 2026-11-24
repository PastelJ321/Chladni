export type Complex = [number, number];
export const mul = (a: Complex, b: Complex): Complex => [
  a[0] * b[0] - a[1] * b[1],
  a[0] * b[1] + a[1] * b[0],
];
export const divide = (a: Complex, b: Complex): Complex => {
  const d = b[0] ** 2 + b[1] ** 2;
  if (d < 1e-40) throw Error('주파수 응답 행렬이 특이합니다. 감쇠와 연결부 조건을 확인하세요.');
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
export function solveComplex(matrix: Complex[][], rhs: Complex[]): Complex[] {
  const a = matrix.map((row, i) => [...row.map((v) => [...v] as Complex), [...rhs[i]] as Complex]),
    n = rhs.length;
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++)
      if (Math.hypot(...a[i][k]) > Math.hypot(...a[pivot][k])) pivot = i;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    for (let i = k + 1; i < n; i++) {
      const f = divide(a[i][k], a[k][k]);
      for (let j = k; j <= n; j++) {
        const t = mul(f, a[k][j]);
        a[i][j] = [a[i][j][0] - t[0], a[i][j][1] - t[1]];
      }
    }
  }
  const x: Complex[] = Array.from({ length: n }, () => [0, 0]);
  for (let i = n - 1; i >= 0; i--) {
    const r: Complex = [...a[i][n]];
    for (let j = i + 1; j < n; j++) {
      const v = mul(a[i][j], x[j]);
      r[0] -= v[0];
      r[1] -= v[1];
    }
    x[i] = divide(r, a[i][i]);
  }
  return x;
}
