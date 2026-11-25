import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneConfig, DEFAULT_CONFIG } from '../src/experiment/config';
import type { Field } from '../src/experiment/types';
import { initialParticles, frameAt } from '../src/simulation/particles';
import { contactBudget, impact, integrateContactFields } from '../src/simulation/contact';
import { seededRandom } from '../src/concept/physics';
const config = () => {
  const c = cloneConfig(DEFAULT_CONFIG);
  c.grains.model = 'contact';
  c.grains.count = 20;
  c.drive.duration = 0.5;
  c.drive.frequency = 20;
  return c;
};
const field = (frequency: number, displacement: (x: number, y: number) => number): Field => {
  const real = Array.from({ length: 25 * 25 }, (_, i) =>
    displacement((i % 25) / 24, Math.floor(i / 25) / 24),
  );
  return {
    source: 'FEM',
    key: 'synthetic prescribed-field numerical benchmark, not an observation',
    frequency,
    size: 25,
    real,
    imag: real.map(() => 0),
    amplitude: real.map(Math.abs),
    peak: Math.max(...real.map(Math.abs)),
  };
};
const energy = (v: number[], w: number[], r: number, plate = 0) =>
  0.5 * (v[0] ** 2 + (v[1] - plate) ** 2 + v[2] ** 2) +
  0.2 * r * r * w.reduce((sum, x) => sum + x * x, 0);
test('normal restitution and Coulomb impulse match closed-form solid-sphere contact limits', () => {
  const a = impact([0, -2, 0], [0, 0, 0], [0, 1, 0], 0, 0.001, 0.6, 0);
  assert.ok(Math.abs(a.v[1] - 1.2) < 1e-14);
  assert.ok(Math.abs(a.dissipation - 0.5 * (1 - 0.6 ** 2) * 4) < 1e-14);
  const sliding = impact([5, -1, 0], [0, 0, 0], [0, 1, 0], 0, 0.001, 0.5, 0.1);
  assert.ok(Math.abs(sliding.v[0] - (5 - 0.15)) < 1e-14);
  const sticking = impact([1, -1, 0], [0, 0, 0], [0, 1, 0], 0, 0.001, 0.5, 1);
  assert.ok(Math.abs(sticking.v[0] - 5 / 7) < 1e-14);
  assert.ok(Math.abs(sticking.v[0] + 0.001 * sticking.omega[2]) < 1e-12);
  assert.ok(
    Math.abs(
      sticking.dissipation -
        (energy([1, -1, 0], [0, 0, 0], 0.001) - energy(sticking.v, sticking.omega, 0.001)),
    ) < 1e-14,
  );
});
test('passive impacts cannot create kinetic energy in the instantaneous plate frame', () => {
  const random = seededRandom(3321);
  for (let i = 0; i < 200; i++) {
    const n: [number, number, number] = [random() - 0.5, 1, random() - 0.5],
      norm = Math.hypot(...n);
    n.forEach((_, j) => (n[j] /= norm));
    const v: [number, number, number] = [
        random() * 3 - 1.5,
        -random() * 4 - 0.1,
        random() * 3 - 1.5,
      ],
      spin: [number, number, number] = [random() * 300, random() * 300, random() * 300],
      r = 0.0002 + random() * 0.001,
      plate = random() - 0.5,
      out = impact(v, spin, n, plate, r, random(), random());
    assert.ok(energy(out.v, out.omega, r, plate) <= energy(v, spin, r, plate) + 1e-12);
    assert.ok(out.dissipation >= 0);
  }
  assert.throws(() => impact([0, -1, 0], [0, 0, 0], [0, 0, 0], 0, 1, 0.5, 0.5));
});
test('stationary horizontal plate has zero lateral drift, reproducible finite conserved recordings', () => {
  const c = config();
  c.drive.displacement = 0;
  const init = initialParticles(c),
    zero = field(20, () => 0),
    a = integrateContactFields(c, [zero], init),
    b = integrateContactFields(c, [zero], init);
  assert.deepEqual(a.frames, b.frames);
  assert.deepEqual(a.frames[0].positions, a.frames.at(-1)!.positions);
  assert.equal(a.motion!.movingCount, 0);
  assert.equal(a.motion!.maxDistance, 0);
  assert.equal(a.motion!.state, 'undriven');
  assert.equal(a.lost, 0);
  assert.ok(
    a.frames.every(
      (f) =>
        f.positions.length === c.grains.count * 2 &&
        f.heights?.length === c.grains.count &&
        f.positions.every(Number.isFinite) &&
        f.heights.every((h) => h === 0),
    ),
  );
  const changed = cloneConfig(c);
  changed.grains.seed++;
  assert.notDeepEqual(initialParticles(changed).positions, init.positions);
});
test('vertical hopping counts as movement without fabricating lateral pattern formation', () => {
  const c = config(),
    run = integrateContactFields(c, [field(20, () => 0.001)], initialParticles(c));
  assert.equal(run.motion!.maxDistance, 0);
  assert.equal(run.motion!.movingCount, c.grains.count);
  assert.equal(run.motion!.state, 'moving');
  assert.ok(run.frames.some((f) => f.heights!.some((h) => h > 1e-5)));
  assert.ok(run.diagnostics!.impacts > 0);
});
test('a static inclined benchmark rolls down the gravity gradient with no imposed drift field', () => {
  const c = config();
  c.drive.frequency = 1;
  c.drive.duration = 0.5;
  const init = initialParticles(c);
  init.positions.fill(0.5);
  const run = integrateContactFields(c, [field(0, (x) => 0.03 * x)], init);
  assert.ok(
    run.frames.at(-1)!.positions.every((x, i) => (i % 2 ? Math.abs(x - 0.5) < 1e-8 : x < 0.5)),
  );
  const distance = run.frames.at(-1)!.distance[0];
  // Analytical rolling acceleration 5/7*g*sin(theta), horizontal projection, neglecting transient O(dt) error.
  const slope = 0.03 / c.plate.width,
    expected = ((0.5 * (5 / 7) * 9.80665 * slope) / (1 + slope * slope)) * c.drive.duration ** 2;
  assert.ok(Math.abs(distance / expected - 1) < 0.08);
});
test('prescribed harmonic contact refines with 32/64/128 samples per period', () => {
  const c = config(),
    init = initialParticles(c),
    input = field(20, () => 0.001),
    runs = [32, 64, 128].map((n) => integrateContactFields(c, [input], init, () => {}, n));
  const difference = (a: number, b: number) => {
    let error = 0;
    for (let i = 0; i <= 100; i++)
      error +=
        (frameAt(runs[a], (c.drive.duration * i) / 100).heights![0] -
          frameAt(runs[b], (c.drive.duration * i) / 100).heights![0]) **
        2;
    return Math.sqrt(error / 101);
  };
  assert.ok(runs[0].dt > runs[1].dt && runs[1].dt > runs[2].dt);
  assert.ok(difference(1, 2) < difference(0, 2), `${difference(1, 2)} vs ${difference(0, 2)}`);
  assert.ok(difference(1, 2) < 0.0002);
});
test('contact computation budget rejects count expansion and malformed prescribed inputs', () => {
  const c = config();
  c.grains.count = 50000;
  assert.ok(contactBudget(c).limit <= 2000);
  assert.throws(() => integrateContactFields(c, [field(20, () => 0)], initialParticles(c)), /이하/);
  assert.throws(() => contactBudget(c, 16), /32/);
  const small = config();
  assert.throws(
    () =>
      integrateContactFields(small, [{ ...field(20, () => 0), real: [] }], initialParticles(small)),
    /진동장/,
  );
});
