import type { Run } from '../experiment/types';
import { frameAt } from '../simulation/particles';
export function metrics(run: Run, time: number) {
  const frame = frameAt(run, time),
    groups = [0, 1].map((species) => {
      let count = 0,
        distance = 0,
        left = 0;
      run.species.forEach((s, i) => {
        if (s === species) {
          count++;
          distance += frame.distance[i];
          if (frame.positions[i * 2] < 0.5) left++;
        }
      });
      return {
        species,
        count,
        meanDistance: count ? distance / count : 0,
        leftFraction: count ? left / count : 0,
      };
    });
  return {
    groups,
    total: run.species.length,
    lost: run.lost,
    region: 'x < Lx/2 (좌측 절반)',
    time: frame.time,
  };
}
export function densityGrid(positions: number[], size = 16) {
  const bins = new Array<number>(size * size).fill(0);
  for (let i = 0; i < positions.length; i += 2)
    bins[
      Math.min(size - 1, Math.floor(positions[i + 1] * size)) * size +
        Math.min(size - 1, Math.floor(positions[i] * size))
    ]++;
  return bins;
}
