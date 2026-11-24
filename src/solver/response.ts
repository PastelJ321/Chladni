import type { Config, Field, ModalResult, Sweep } from '../experiment/types';
import { responseKey, sweepKey } from '../experiment/config';
import { sampleMode } from './modal';
import { compliantCoefficients } from './compliantResponse';
export function coefficients(modal: ModalResult, c: Config, frequency: number) {
  if (c.plate.connection?.enabled) return compliantCoefficients(modal, c, frequency);
  const w = 2 * Math.PI * frequency;
  return modal.frequencies.map((f, i) => {
    const wn = 2 * Math.PI * f,
      a = wn * wn - w * w,
      b = 2 * c.plate.damping * wn * w;
    const force =
      c.drive.kind === 'base'
        ? modal.baseParticipation[i] * w * w * c.drive.displacement
        : sampleMode(modal, i, c.drive.x, c.drive.y) * c.drive.force;
    return [(force * a) / (a * a + b * b), (-force * b) / (a * a + b * b)];
  });
}
export function responseField(
  modal: ModalResult,
  c: Config,
  frequency = c.drive.frequency,
  size = 41,
): Field {
  const q = coefficients(modal, c, frequency),
    real: number[] = [],
    imag: number[] = [],
    amplitude: number[] = [];
  let peak = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let re = c.drive.kind === 'base' && !c.plate.connection?.enabled ? c.drive.displacement : 0,
        im = 0;
      for (let i = 0; i < q.length; i++) {
        const shape = sampleMode(modal, i, x / (size - 1), y / (size - 1));
        re += shape * q[i][0];
        im += shape * q[i][1];
      }
      const amp = Math.hypot(re, im);
      real.push(re);
      imag.push(im);
      amplitude.push(amp);
      peak = Math.max(peak, amp);
    }
  return {
    source: 'FEM',
    key: responseKey(c, frequency),
    size,
    real,
    imag,
    amplitude,
    peak,
    frequency,
  };
}
export function frequencySweep(modal: ModalResult, c: Config): Sweep {
  const points = Array.from({ length: c.drive.samples }, (_, i) => {
    const frequency = c.drive.start + ((c.drive.end - c.drive.start) * i) / (c.drive.samples - 1),
      q = coefficients(modal, c, frequency);
    return {
      frequency,
      rms: Math.sqrt(q.reduce((s, v) => s + v[0] ** 2 + v[1] ** 2, 0) / modal.mass),
    };
  });
  const peaks = points
    .filter(
      (v, i) =>
        i > 0 &&
        i < points.length - 1 &&
        v.rms > points[i - 1].rms &&
        v.rms >= points[i + 1].rms &&
        v.rms > 1e-15,
    )
    .sort((a, b) => b.rms - a.rms)
    .slice(0, 12)
    .sort((a, b) => a.frequency - b.frequency);
  return { source: 'FEM', key: sweepKey(c), points, peaks };
}
export function sampleGrid(values: ArrayLike<number>, size: number, x: number, y: number) {
  const gx = Math.max(0, Math.min(size - 1.000001, x * (size - 1))),
    gy = Math.max(0, Math.min(size - 1.000001, y * (size - 1))),
    ix = Math.floor(gx),
    iy = Math.floor(gy),
    tx = gx - ix,
    ty = gy - iy;
  return (
    (values[iy * size + ix] * (1 - tx) + values[iy * size + ix + 1] * tx) * (1 - ty) +
    (values[(iy + 1) * size + ix] * (1 - tx) + values[(iy + 1) * size + ix + 1] * tx) * ty
  );
}
