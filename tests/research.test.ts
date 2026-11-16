import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, cloneConfig, configKey } from '../src/experiment/config';
import { solvePlate, sampleMode } from '../src/solver/modal';
import { frequencySweep, responseField } from '../src/solver/response';
import { simulateParticles, initialParticles } from '../src/simulation/particles';
import { decodeSession, encodeSession } from '../src/io/session';
import { densityGrid, metrics } from '../src/analysis/metrics';
const c = cloneConfig(DEFAULT_CONFIG);
c.plate.boundary = 'simply-supported';
c.plate.mesh = 4;
c.drive.kind = 'force';
c.drive.x = 0.43;
c.drive.y = 0.37;
c.grains.count = 60;
c.drive.duration = 0.5;
const modal = solvePlate(c.plate);
const exact = (p: typeof c.plate, m = 1, n = 1) =>
  (Math.PI / 2) *
  Math.sqrt((p.young * p.thickness ** 2) / (12 * p.density * (1 - p.poisson ** 2))) *
  ((m * m) / p.width ** 2 + (n * n) / p.height ** 2);
test('BFS frequencies converge against simply-supported Navier solution', () => {
  const fine = solvePlate({ ...c.plate, mesh: 6 });
  const coarseError = Math.abs(modal.frequencies[0] / exact(c.plate) - 1),
    fineError = Math.abs(fine.frequencies[0] / exact(c.plate) - 1);
  assert.ok(coarseError < 0.001);
  assert.ok(fineError < coarseError);
  assert.ok(Math.abs(fine.frequencies[1] / exact(c.plate, 1, 2) - 1) < 0.001);
  assert.ok(Math.max(...fine.residuals) < 1e-7);
});
test('thickness, dimensions, stiffness and density change eigenvalues with thin-plate scaling', () => {
  for (const [patch, ratio] of [
    [{ thickness: 0.004 }, 2],
    [{ width: 0.6, height: 0.6 }, 0.25],
    [{ young: c.plate.young * 4 }, 2],
    [{ density: c.plate.density * 4 }, 0.5],
  ] as const) {
    const next = solvePlate({ ...c.plate, ...patch });
    assert.ok(Math.abs(next.frequencies[0] / modal.frequencies[0] - ratio) < 1e-7);
    assert.notEqual(next.key, modal.key);
  }
});
test('boundary constraints and support positions alter actual FEM result', () => {
  const clamped = solvePlate({ ...c.plate, boundary: 'clamped' });
  assert.ok(clamped.frequencies[0] > modal.frequencies[0] * 1.5);
  const center = solvePlate({ ...c.plate, boundary: 'center' }),
    off = solvePlate({ ...c.plate, boundary: 'center', supportX: 0.25 });
  assert.ok(Math.abs(center.frequencies[0] - off.frequencies[0]) > 1);
  assert.ok(Math.abs(sampleMode(center, 0, 0.5, 0.5)) < 1e-9);
});
test('drive participation and damping affect frequency response', () => {
  const resonant = cloneConfig(c);
  resonant.drive.frequency = modal.frequencies[0];
  const peak = responseField(modal, resonant);
  const damp = cloneConfig(resonant);
  damp.plate.damping *= 2;
  assert.ok(responseField(modal, damp).peak < peak.peak * 0.6);
  const node = cloneConfig(resonant);
  node.drive.x = 0;
  node.drive.y = 0;
  assert.equal(responseField(modal, node).peak, 0);
  const sweep = frequencySweep(modal, c);
  assert.ok(
    sweep.peaks.some(
      (p) =>
        Math.abs(p.frequency - modal.frequencies[0]) <
        ((c.drive.end - c.drive.start) / (c.drive.samples - 1)) * 1.1,
    ),
  );
});
test('central constraint has zero direct-force response; base excitation remains nonzero', () => {
  const cfg = cloneConfig(c);
  cfg.plate.boundary = 'center';
  cfg.drive.x = 0.5;
  cfg.drive.y = 0.5;
  const result = solvePlate(cfg.plate);
  assert.equal(responseField(result, cfg).peak, 0);
  cfg.drive.kind = 'base';
  assert.ok(responseField(result, cfg).peak > 0);
});
test('dynamic particles are deterministic, finite, conserved, and motion can fail to develop', () => {
  const cfg = cloneConfig(c);
  cfg.drive.force = 0;
  const a = simulateParticles(cfg, modal),
    b = simulateParticles(cfg, modal);
  assert.deepEqual(a, bWithoutTiming(b, a.elapsedMs));
  assert.deepEqual(a.frames[0].positions, a.frames.at(-1)!.positions);
  assert.equal(a.lost, 0);
  for (const f of a.frames) {
    assert.equal(f.positions.length, cfg.grains.count * 2);
    assert.ok(f.positions.every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
  }
  const active = cloneConfig(c);
  active.drive.frequency = modal.frequencies[0];
  active.drive.force = 0.8;
  const moving = simulateParticles(active, modal);
  assert.ok(moving.frames.at(-1)!.distance.some((v) => v > 0));
  const sized = cloneConfig(active);
  sized.grains.groups!.sand.diameter *= 2;
  sized.grains.groups!.salt.diameter *= 2;
  assert.notDeepEqual(
    simulateParticles(sized, modal).frames.at(-1)!.positions,
    moving.frames.at(-1)!.positions,
  );
});
function bWithoutTiming<T extends { elapsedMs: number }>(b: T, t: number) {
  return { ...b, elapsedMs: t };
}
test('seed controls initial distribution and painted points are respected', () => {
  const a = initialParticles(c);
  assert.deepEqual(a, initialParticles(c));
  const next = cloneConfig(c);
  next.grains.seed++;
  assert.notDeepEqual(a.positions, initialParticles(next).positions);
  next.grains.distribution = 'paint';
  next.grains.spots = [[0.2, 0.3]];
  assert.ok(
    initialParticles(next).positions.every((v, i) => Math.abs(v - (i % 2 ? 0.3 : 0.2)) < 0.061),
  );
});
test('session round trip preserves conditions/results; changed conditions have distinct keys', () => {
  const sweep = frequencySweep(modal, c),
    run = simulateParticles(c, modal);
  const records = [
    { id: 'test', name: 'test', config: c, modal, sweep, run, created: '2026-11-12' },
  ];
  assert.deepEqual(decodeSession(encodeSession(c, records)), { config: c, records });
  const next = cloneConfig(c);
  next.grains.seed++;
  assert.notEqual(configKey(next), run.key);
  assert.throws(() => decodeSession('{"schema":"other"}'));
});
test('density and regional measurements account for all particles', () => {
  const r = simulateParticles(c, modal);
  assert.equal(
    densityGrid(r.frames[0].positions).reduce((a, b) => a + b),
    c.grains.count,
  );
  const m = metrics(r, 0);
  assert.equal(
    m.groups.reduce((s, g) => s + g.count, 0),
    c.grains.count,
  );
  assert.equal(m.total, c.grains.count);
});

test('active experiment export preserves unrecorded run and rejects corrupt vectors', () => {
  const run = simulateParticles(c, modal),
    sweep = frequencySweep(modal, c),
    active = { id: 'active', name: 'active', config: c, modal, sweep, run, created: '2026-11-12' };
  const raw = encodeSession(c, [], active);
  assert.deepEqual(decodeSession(raw).active, active);
  const broken = JSON.parse(raw);
  broken.active.modal.vectors[0] = [1];
  assert.throws(() => decodeSession(JSON.stringify(broken)));
});
test('quasi-steady sweep stores the same FEM states used by particle integration', () => {
  const next = cloneConfig(c);
  next.drive.signal = 'sweep';
  next.drive.end = 400;
  const run = simulateParticles(next, modal);
  assert.equal(run.fields.length, 33);
  assert.equal(run.fields[0].frequency, next.drive.start);
  assert.equal(run.fields.at(-1)!.frequency, next.drive.end);
  assert.ok(
    run.fields.every(
      (f) => f.source === 'FEM' && f.key === run.key && f.amplitude.every(Number.isFinite),
    ),
  );
  assert.notDeepEqual(run.fields[0].amplitude, run.fields.at(-1)!.amplitude);
});
