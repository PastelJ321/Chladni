import type { Config, ModalResult } from '../experiment/types';
import { sampleMode } from './modal';
import { mul, solveComplex, type Complex } from './complex';
/** Modal dynamic stiffness with the full projected rank-three connector damping.
 * Absolute plate displacement: F=(Kz+iωCz) B Y for vertical base input, without an added rigid shift.
 * Woodbury reduction keeps all off-diagonal damping terms but solves only a 3×3 complex system.
 */
export function compliantCoefficients(modal: ModalResult, c: Config, frequency: number): Complex[] {
  const attachment = modal.connector,
    connection = c.plate.connection;
  if (!attachment || !connection) throw Error('연결부 모델과 해석 결과가 일치하지 않습니다.');
  const w = 2 * Math.PI * frequency,
    u = [attachment.displacement, attachment.rotationX, attachment.rotationY],
    damping = [connection.cz, connection.crx, connection.cry];
  const inverse: Complex[] = modal.frequencies.map((f) => {
    const wn = 2 * Math.PI * f,
      re = wn * wn - w * w,
      im = 2 * c.plate.damping * wn * w,
      d = re * re + im * im;
    return [re / d, -im / d];
  });
  const x: Complex[] = modal.frequencies.map((_f, i) => {
    const f: Complex =
      c.drive.kind === 'base'
        ? [
            connection.kz * u[0][i] * c.drive.displacement,
            w * connection.cz * u[0][i] * c.drive.displacement,
          ]
        : [sampleMode(modal, i, c.drive.x, c.drive.y) * c.drive.force, 0];
    return mul(inverse[i], f);
  });
  if (damping.every((d) => d === 0)) return x;
  const a: Complex[][] = [],
    rhs: Complex[] = [];
  for (let j = 0; j < 3; j++) {
    const r: Complex = [0, 0];
    x.forEach((v, i) => {
      r[0] += u[j][i] * v[0];
      r[1] += u[j][i] * v[1];
    });
    rhs.push([-w * damping[j] * r[1], w * damping[j] * r[0]]);
    a.push([]);
    for (let k = 0; k < 3; k++) {
      const s: Complex = [0, 0];
      inverse.forEach((v, i) => {
        s[0] += u[j][i] * u[k][i] * v[0];
        s[1] += u[j][i] * u[k][i] * v[1];
      });
      a[j].push([(j === k ? 1 : 0) - w * damping[j] * s[1], w * damping[j] * s[0]]);
    }
  }
  const correction = solveComplex(a, rhs);
  return x.map((value, i) => {
    const load: Complex = [0, 0];
    correction.forEach((v, j) => {
      load[0] += u[j][i] * v[0];
      load[1] += u[j][i] * v[1];
    });
    const v = mul(inverse[i], load);
    return [value[0] - v[0], value[1] - v[1]];
  });
}
