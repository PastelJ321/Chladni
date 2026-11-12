import { Matrix, CholeskyDecomposition, EigenvalueDecomposition, solve } from 'ml-matrix';
import type { ModalResult, Plate } from '../experiment/types';
import { plateKey } from '../experiment/config';
import { basis, pointDofs } from './basis';
export function solvePlate(p: Plate, progress: (v: number) => void = () => {}): ModalResult {
  const start = performance.now(),
    n = p.mesh,
    size = (n + 1) ** 2 * 4,
    dx = p.width / n,
    dy = p.height / n;
  const K = Matrix.zeros(size, size),
    M = Matrix.zeros(size, size);
  const ke = Matrix.zeros(16, 16),
    me = Matrix.zeros(16, 16);
  const D = (p.young * p.thickness ** 3) / (12 * (1 - p.poisson ** 2));
  const gp = [-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526],
    gw = [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538];
  for (let a = 0; a < 4; a++)
    for (let b = 0; b < 4; b++) {
      const { N, xx, yy, xy } = basis((gp[a] + 1) / 2, (gp[b] + 1) / 2, dx, dy),
        weight = (gw[a] * gw[b] * dx * dy) / 4;
      for (let i = 0; i < 16; i++)
        for (let j = 0; j < 16; j++) {
          ke.set(
            i,
            j,
            ke.get(i, j) +
              weight *
                D *
                (xx[i] * xx[j] +
                  yy[i] * yy[j] +
                  p.poisson * (xx[i] * yy[j] + yy[i] * xx[j]) +
                  ((1 - p.poisson) / 2) * xy[i] * xy[j]),
          );
          me.set(i, j, me.get(i, j) + weight * p.density * p.thickness * N[i] * N[j]);
        }
    }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const { ids } = pointDofs((x + 0.5) / n, (y + 0.5) / n, n);
      for (let i = 0; i < 16; i++)
        for (let j = 0; j < 16; j++) {
          K.set(ids[i], ids[j], K.get(ids[i], ids[j]) + ke.get(i, j));
          M.set(ids[i], ids[j], M.get(ids[i], ids[j]) + me.get(i, j));
        }
    }
  progress(0.2);
  const fixed = new Set<number>();
  const sx = Math.round(p.supportX * n),
    sy = Math.round(p.supportY * n);
  for (let y = 0; y <= n; y++)
    for (let x = 0; x <= n; x++) {
      const id = (y * (n + 1) + x) * 4;
      if (p.boundary === 'center' && x === sx && y === sy)
        for (let k = 0; k < 4; k++) fixed.add(id + k);
      if (
        (p.boundary === 'clamped' && (x === 0 || y === 0 || x === n || y === n)) ||
        (p.boundary === 'cantilever' && x === 0)
      )
        for (let k = 0; k < 4; k++) fixed.add(id + k);
      if (p.boundary === 'simply-supported') {
        if (x === 0 || x === n) {
          fixed.add(id);
          fixed.add(id + 2);
        }
        if (y === 0 || y === n) {
          fixed.add(id);
          fixed.add(id + 1);
        }
      }
    }
  const free = Array.from({ length: size }, (_, i) => i).filter((i) => !fixed.has(i));
  const k = K.selection(free, free),
    m = M.selection(free, free);
  for (let i = 0; i < m.rows; i++)
    for (let j = 0; j < i; j++) {
      const a = (m.get(i, j) + m.get(j, i)) / 2,
        b = (k.get(i, j) + k.get(j, i)) / 2;
      m.set(i, j, a);
      m.set(j, i, a);
      k.set(i, j, b);
      k.set(j, i, b);
    }
  const L = new CholeskyDecomposition(m).lowerTriangularMatrix;
  const left = solve(L, k),
    A = solve(L, left.transpose()).transpose();
  // Remove floating-point asymmetry before the symmetric eigensolve.
  for (let i = 0; i < A.rows; i++)
    for (let j = 0; j < i; j++) {
      const v = (A.get(i, j) + A.get(j, i)) / 2;
      A.set(i, j, v);
      A.set(j, i, v);
    }
  progress(0.4);
  const ev = new EigenvalueDecomposition(A, { assumeSymmetric: true });
  const physical = solve(L.transpose(), ev.eigenvectorMatrix);
  const order = ev.realEigenvalues
    .map((v, i) => ({ v, i }))
    .filter((o) => o.v > 1e-3)
    .sort((a, b) => a.v - b.v)
    .slice(0, 24);
  const vectors: number[][] = [],
    frequencies: number[] = [],
    baseParticipation: number[] = [],
    residuals: number[] = [];
  for (const { v, i } of order) {
    const full = new Array<number>(size).fill(0);
    free.forEach((id, j) => (full[id] = physical.get(j, i)));
    // Stable sign convention, important for deterministic snapshots and traces.
    const pivot = full.reduce((best, q, j) => (Math.abs(q) > Math.abs(full[best]) ? j : best), 0);
    if (full[pivot] < 0) for (let j = 0; j < size; j++) full[j] *= -1;
    for (let j = 0; j < size; j++) if (full[j] === 0) full[j] = 0;
    let gamma = 0,
      err = 0,
      norm = 0;
    for (const a of free) {
      let kv = 0,
        mv = 0;
      for (let b = 0; b < size; b++) {
        kv += K.get(a, b) * full[b];
        mv += M.get(a, b) * full[b];
        if (b % 4 === 0) gamma += full[a] * M.get(a, b);
      }
      err += (kv - v * mv) ** 2;
      norm += kv * kv;
    }
    vectors.push(full);
    frequencies.push(Math.sqrt(v) / (2 * Math.PI));
    baseParticipation.push(gamma);
    residuals.push(Math.sqrt(err / Math.max(1e-30, norm)));
  }
  progress(1);
  return {
    source: 'FEM',
    key: plateKey(p),
    plate: { ...p },
    vectors,
    frequencies,
    baseParticipation,
    freeDofs: free.length,
    residuals,
    mass: p.density * p.width * p.height * p.thickness,
    support: [sx / n, sy / n],
    elapsedMs: performance.now() - start,
  };
}
export function sampleMode(result: ModalResult, mode: number, x: number, y: number) {
  const p = result.plate,
    { ids, s, t } = pointDofs(x, y, p.mesh),
    { N } = basis(s, t, p.width / p.mesh, p.height / p.mesh);
  return ids.reduce((sum, id, i) => sum + N[i] * result.vectors[mode][id], 0);
}
