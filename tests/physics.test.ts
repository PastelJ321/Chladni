import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES } from '../src/model/catalog';
import {
  buildParticles,
  contours,
  field,
  gradient,
  particleAt,
  response,
} from '../src/model/physics';

test('field is antisymmetric and has a stationary center for every preset', () => {
  for (const mode of MODES) {
    assert.ok(Math.abs(field(0, 0, mode)) < 1e-12);
    for (const [x, z] of [
      [0.24, -0.53],
      [-0.89, 0.72],
      [0.5, 0.5],
    ]) {
      assert.ok(Math.abs(field(x, z, mode) + field(z, x, mode)) < 1e-12);
      assert.ok(Math.abs(field(x, z, mode)) <= 1);
    }
  }
});

test('analytic gradient agrees with an independent finite difference', () => {
  const delta = 1e-6;
  for (const mode of MODES) {
    const [gx, gz] = gradient(0.36, -0.27, mode);
    assert.ok(
      Math.abs(
        gx - (field(0.36 + delta, -0.27, mode) - field(0.36 - delta, -0.27, mode)) / (2 * delta),
      ) < 1e-7,
    );
    assert.ok(
      Math.abs(
        gz - (field(0.36, -0.27 + delta, mode) - field(0.36, -0.27 - delta, mode)) / (2 * delta),
      ) < 1e-7,
    );
  }
});

test('ordinary particles converge toward nodes and stay on the plate', () => {
  for (let mode = 0; mode < MODES.length; mode++) {
    const data = buildParticles(mode, 'sand', false, 128);
    let initial = 0,
      final = 0;
    for (let i = 0; i < data.count; i++) {
      const start = particleAt(data, i, 0),
        end = particleAt(data, i, 1);
      initial += Math.abs(field(...start, MODES[mode]));
      final += Math.abs(field(...end, MODES[mode]));
      for (let frame = 0; frame < data.frames; frame++) {
        const [x, z] = particleAt(data, i, frame / (data.frames - 1));
        assert.ok(Number.isFinite(x) && Number.isFinite(z));
        assert.ok(Math.abs(x) <= 1 && Math.abs(z) <= 1);
      }
    }
    assert.ok(final < initial * 0.18, `mode ${mode} should approach nodes: ${final / initial}`);
  }
});

test('scrubbing backwards reproduces identical particle coordinates', () => {
  const a = buildParticles(1, 'mixture', false, 48),
    b = buildParticles(1, 'mixture', false, 48);
  assert.deepEqual(a.positions, b.positions);
  const first = particleAt(a, 14, 0.42);
  particleAt(a, 14, 0.95);
  assert.deepEqual(particleAt(a, 14, 0.42), first);
  assert.deepEqual(particleAt(a, 14, -5), particleAt(a, 14, 0));
  assert.deepEqual(particleAt(a, 14, 9), particleAt(a, 14, 1));
});

test('frequency comparisons begin with the same particles', () => {
  const a = buildParticles(0, 'sand', false, 80),
    b = buildParticles(3, 'sand', false, 80);
  for (let i = 0; i < 80; i++) assert.deepEqual(particleAt(a, i, 0), particleAt(b, i, 0));
});

test('inverse conceptual model moves toward antinodes', () => {
  const data = buildParticles(1, 'sand', true, 128);
  let initial = 0,
    final = 0;
  for (let i = 0; i < data.count; i++) {
    initial += Math.abs(field(...particleAt(data, i, 0), MODES[1]));
    final += Math.abs(field(...particleAt(data, i, 1), MODES[1]));
  }
  assert.ok(final > initial * 1.6);
});

test('response peaks near the illustrative reference frequency', () => {
  assert.equal(response(438, 438), 1);
  assert.ok(response(100, 438) < 0.2);
  assert.ok(response(1200, 438) < 0.1);
  assert.ok(response(300, 438) < response(420, 438));
});

test('contours contain finite endpoints on the plate domain', () => {
  for (let mode = 0; mode < 4; mode++)
    for (const level of [0, 0.18, 0.4]) {
      const points = contours(mode, level, level !== 0, 32);
      assert.ok(points.length > 20 && points.length % 4 === 0);
      points.forEach((value) =>
        assert.ok(Number.isFinite(value) && value >= -1.00001 && value <= 1.00001),
      );
    }
});
