import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, cloneConfig } from '../src/experiment/config';
import type { Field, RecordEntry, Run } from '../src/experiment/types';
import {
  researchMetrics,
  repeatability,
  metricsCSV,
  totalVariation,
} from '../src/analysis/metrics';
import {
  homography,
  transformPoint,
  validCorners,
  rectifyPixels,
} from '../src/analysis/registration';
import {
  validateObservationSnapshot,
  type ObservationSnapshot,
} from '../src/analysis/observationTypes';
const field: Field = {
  source: 'FEM',
  size: 2,
  real: [0, 1, 0, 1],
  imag: [0, 0, 0, 0],
  amplitude: [0, 1, 0, 1],
  peak: 1,
  frequency: 100,
  key: 'synthetic-linear-field',
};
function run(): Run {
  const config = cloneConfig(DEFAULT_CONFIG);
  config.grains.count = 4;
  config.drive.duration = 1;
  return {
    source: 'approximation',
    config,
    key: 'synthetic-analysis-fixture',
    fields: [field],
    frames: [
      { time: 0, positions: [0.3, 0.5, 0.7, 0.5, 0.3, 0.5, 0.7, 0.5], distance: [0, 0, 0, 0] },
      {
        time: 1,
        positions: [0.1, 0.5, 0.15, 0.5, 0.85, 0.5, 0.9, 0.5],
        distance: [0.1, 0.2, 0.3, 0.4],
      },
    ],
    diameters: [1e-4, 1e-4, 1e-4, 1e-4],
    species: [0, 0, 1, 1],
    masses: [1e-9, 2e-9, 3e-9, 4e-9],
    lost: 0,
    dt: 1 / 120,
    elapsedMs: 0,
  };
}
test('research zones use same FEM amplitude field, integrated inputs and explicit ROI denominators', () => {
  const r = run(),
    before = JSON.stringify(r),
    result = researchMetrics(r, 1, field, {
      nodeThreshold: 0.2,
      antinodeThreshold: 0.8,
      roi: [0, 0, 0.5, 1],
    });
  assert.equal(result.groups[0].nodeFraction, 1);
  assert.equal(result.groups[0].initialNodeFraction, 0);
  assert.equal(result.groups[1].antinodeFraction, 1);
  assert.equal(result.groups[1].initialAntinodeFraction, 0);
  assert.equal(result.initialSpeciesDistance, 0);
  assert.equal(result.speciesDistance, 1);
  assert.equal(result.roi.purity, 1);
  assert.equal(result.roi.recovery, 1);
  assert.equal(result.roi.targetInput, 2);
  assert.equal(
    result.groups[0].density.reduce((a, b) => a + b),
    2,
  );
  assert.ok(Math.abs(result.groups[0].meanDistance - 0.15) < 1e-12);
  assert.equal(JSON.stringify(r), before);
  assert.match(metricsCSV(result), /node_amplitude_threshold/);
});
test('mass basis differs from number basis, empty/zero-response domains remain undefined', () => {
  const r = run();
  r.frames[1].positions = [0.1, 0.5, 0.6, 0.5, 0.2, 0.5, 0.9, 0.5];
  const count = researchMetrics(r, 1, field, { roi: [0, 0, 0.3, 1] }),
    mass = researchMetrics(r, 1, field, { basis: 'mass', roi: [0, 0, 0.3, 1] });
  assert.equal(count.roi.purity, 0.5);
  assert.equal(mass.roi.purity, 0.25);
  assert.ok(Math.abs(mass.roi.recovery! - 1 / 3) < 1e-12);
  const empty = researchMetrics(
    r,
    1,
    { ...field, peak: 0, amplitude: [0, 0, 0, 0] },
    { roi: [0.35, 0, 0.45, 1] },
  );
  assert.equal(empty.roi.purity, null);
  assert.equal(empty.groups[0].nodeFraction, null);
  assert.equal(totalVariation([0, 0], [1, 0]), null);
});
test('repeat statistics exclude identical seed duplicates and changed physical conditions', () => {
  const a = run(),
    b = run(),
    changed = run();
  b.config.grains.seed++;
  b.frames[1].distance = [0.3, 0.4, 0.5, 0.6];
  changed.config.drive.frequency++;
  const record = (r: Run, id: string) => ({ id, config: r.config, run: r }) as RecordEntry;
  const result = repeatability(
    [record(a, 'a'), record(a, 'duplicate'), record(b, 'b'), record(changed, 'other')],
    a.config,
  );
  assert.equal(result.records, 3);
  assert.equal(result.independentSeeds, 2);
  assert.equal(result.groups[0].meanDistance!.n, 2);
  assert.ok(Math.abs(result.groups[0].meanDistance!.sampleDeviation! - Math.sqrt(0.02)) < 1e-12);
});
test('four-corner projective map round trips and refuses crossed or degenerate quadrilaterals', () => {
  const corners: [number, number][] = [
      [0.1, 0.2],
      [0.9, 0.1],
      [0.8, 0.9],
      [0.2, 0.8],
    ],
    square: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    h = homography(corners),
    inverse = homography(square, corners);
  assert.equal(validCorners(corners), true);
  corners.forEach((p, i) => {
    const q = transformPoint(h, p);
    assert.ok(Math.hypot(q[0] - square[i][0], q[1] - square[i][1]) < 1e-12);
  });
  const q: [number, number] = [0.37, 0.61],
    back = transformPoint(h, transformPoint(inverse, q));
  assert.ok(Math.hypot(back[0] - q[0], back[1] - q[1]) < 1e-12);
  assert.throws(() => homography([corners[0], corners[2], corners[1], corners[3]]));
  assert.equal(
    validCorners([
      [0, 0],
      [1, 0],
      [0.5, 0],
      [0, 1],
    ]),
    false,
  );
});
test('rectification samples exact identity image without altering original pixels', () => {
  const pixels = Uint8ClampedArray.from([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 128, 128, 128, 255,
    ]),
    original = pixels.slice();
  assert.deepEqual(
    rectifyPixels(
      pixels,
      2,
      2,
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      2,
      2,
    ),
    pixels,
  );
  assert.deepEqual(pixels, original);
});
test('observation persistence stores file identity and manual source, rejects object URL payloads', () => {
  const x: ObservationSnapshot = {
    schema: 'chladni-observation/1',
    media: { name: 'synthetic-fixture.png', type: 'image/png', size: 123, lastModified: 0 },
    corners: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    corrected: true,
    opacity: 0.5,
    overlay: true,
    sync: false,
    offset: 0,
    frameTime: 0,
    frequency: '',
    note: 'Synthetic persistence fixture, not experimental evidence.',
    reproduced: 'unknown',
    measured: [],
    responseName: '',
    regions: [
      {
        id: 'region',
        source: 'manual-observation',
        time: 0,
        roi: [0, 0, 0.5, 0.5],
        counts: [null, 12],
        note: 'first species unmeasured',
      },
    ],
  };
  assert.deepEqual(validateObservationSnapshot(JSON.parse(JSON.stringify(x))), x);
  assert.throws(() =>
    validateObservationSnapshot({ ...x, media: { ...x.media, embedded: 'blob:expired' } }),
  );
  assert.throws(() =>
    validateObservationSnapshot({ ...x, regions: [{ ...x.regions[0], counts: [-1, 2] }] }),
  );
});
