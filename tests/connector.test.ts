import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneConfig, DEFAULT_CONFIG, plateKey, responseKey } from '../src/experiment/config';
import type { ModalResult } from '../src/experiment/types';
import { connectorCoordinates, dot } from '../src/solver/connector';
import { solvePlate } from '../src/solver/modal';
import { coefficients, responseField } from '../src/solver/response';
import { SolverKernel } from '../src/solver/kernel';
import { calibrateConnection, halfPowerDamping } from '../src/solver/calibration';
import { divide, mul, type Complex } from '../src/solver/complex';
const config = () => {
  const c = cloneConfig(DEFAULT_CONFIG);
  c.plate.mesh = 4;
  c.plate.connection = {
    enabled: true,
    kz: 10000,
    krx: 20,
    kry: 30,
    cz: 0.3,
    crx: 0.001,
    cry: 0.001,
    mass: 0.02,
    width: 0.02,
    height: 0.02,
    status: 'estimated',
    reference: 'synthetic verification fixture, not an apparatus measurement',
  };
  return c;
};
test('attachment patch reproduces rigid translation and exact linear rotations', () => {
  const c = config(),
    p = c.plate;
  p.supportX = 0.43;
  p.supportY = 0.39;
  const a = connectorCoordinates(p)!,
    translation = Array.from({ length: (p.mesh + 1) ** 2 * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)),
    linear: number[] = [...translation];
  for (let y = 0; y <= p.mesh; y++)
    for (let x = 0; x <= p.mesh; x++) {
      const i = (y * (p.mesh + 1) + x) * 4;
      linear[i] = (x / p.mesh) * p.width;
      linear[i + 1] = p.width / p.mesh;
      linear[i + 2] = linear[i + 3] = 0;
    }
  assert.ok(Math.abs(dot(a.displacement, translation) - 1) < 1e-12);
  assert.ok(Math.abs(dot(a.rotationX, translation)) < 1e-11);
  assert.ok(Math.abs(dot(a.rotationY, translation)) < 1e-11);
  assert.ok(Math.abs(dot(a.displacement, linear) - p.supportX * p.width) < 1e-12);
  assert.ok(Math.abs(dot(a.rotationY, linear) - 1) < 1e-12);
});
test('compliant FEM has finite physical modes, quasistatic base following and mass/stiffness sensitivity', () => {
  const c = config(),
    a = solvePlate(c.plate);
  assert.equal(a.freeDofs, (c.plate.mesh + 1) ** 2 * 4);
  assert.ok(Math.max(...a.residuals) < 1e-7);
  assert.ok(Math.abs(responseField(a, c, 1).peak / c.drive.displacement - 1) < 0.01);
  const stiffer = cloneConfig(c);
  stiffer.plate.connection!.kz *= 4;
  const b = solvePlate(stiffer.plate);
  assert.ok(b.frequencies[2] > a.frequencies[2] * 1.5);
  const heavy = cloneConfig(c);
  heavy.plate.connection!.mass += 0.1;
  const h = solvePlate(heavy.plate);
  assert.ok(h.frequencies[2] < a.frequencies[2]);
  const footprint = cloneConfig(c);
  footprint.plate.connection!.width *= 3;
  assert.notDeepEqual(solvePlate(footprint.plate).frequencies, a.frequencies);
});
test('connector base response matches analytic SDOF absolute transmissibility without a rigid-shift offset', () => {
  const c = config(),
    mass = 0.5,
    stiffness = 12000,
    damping = 8;
  c.plate.damping = 0;
  Object.assign(c.plate.connection!, { kz: stiffness, cz: damping, crx: 0, cry: 0 });
  const m: ModalResult = {
    source: 'FEM',
    key: 'synthetic-sdof',
    plate: c.plate,
    frequencies: [Math.sqrt(stiffness / mass) / (2 * Math.PI)],
    vectors: [],
    baseParticipation: [],
    freeDofs: 1,
    residuals: [0],
    mass,
    support: [0.5, 0.5],
    elapsedMs: 0,
    connector: { displacement: [1 / Math.sqrt(mass)], rotationX: [0], rotationY: [0] },
  };
  for (const frequency of [1, 20, 70]) {
    const w = 2 * Math.PI * frequency,
      exact = divide([stiffness, w * damping], [stiffness - mass * w * w, w * damping]),
      q = coefficients(m, c, frequency)[0];
    assert.ok(Math.abs(q[0] / Math.sqrt(mass) / c.drive.displacement - exact[0]) < 1e-10);
    assert.ok(Math.abs(q[1] / Math.sqrt(mass) / c.drive.displacement - exact[1]) < 1e-10);
  }
});
test('rank-three connector damping retains off-diagonal modal coupling', () => {
  const c = config();
  c.plate.connection!.cz = 6;
  c.plate.connection!.crx = c.plate.connection!.cry = 0;
  const modal: ModalResult = {
    source: 'FEM',
    key: 'synthetic-two-mode',
    plate: c.plate,
    frequencies: [20, 27],
    vectors: [],
    baseParticipation: [],
    freeDofs: 2,
    residuals: [0, 0],
    mass: 0.5,
    support: [0.5, 0.5],
    elapsedMs: 0,
    connector: { displacement: [1.4, 0.9], rotationX: [0, 0], rotationY: [0, 0] },
  };
  const w = 2 * Math.PI * 23,
    b = modal.connector!.displacement,
    q = c.plate.connection!;
  const d = modal.frequencies.map((f, i): Complex => [
      (2 * Math.PI * f) ** 2 - w * w,
      2 * c.plate.damping * 2 * Math.PI * f * w + w * q.cz * b[i] ** 2,
    ]),
    off: Complex = [0, w * q.cz * b[0] * b[1]],
    f = b.map(
      (v) => [q.kz * v * c.drive.displacement, w * q.cz * v * c.drive.displacement] as Complex,
    );
  const subtract = (a: Complex, b: Complex): Complex => [a[0] - b[0], a[1] - b[1]],
    det = subtract(mul(d[0], d[1]), mul(off, off));
  const expected = [
      divide(subtract(mul(f[0], d[1]), mul(f[1], off)), det),
      divide(subtract(mul(f[1], d[0]), mul(f[0], off)), det),
    ],
    actual = coefficients(modal, c, 23);
  actual.forEach((v, i) => v.forEach((x, j) => assert.ok(Math.abs(x - expected[i][j]) < 1e-12)));
});
test('connector stiffness invalidates FEM while damping/evidence reuse the eigensystem', () => {
  const c = config(),
    k = new SolverKernel(),
    a = k.execute('field', c),
    next = cloneConfig(c);
  next.plate.connection!.cz *= 3;
  next.plate.connection!.reference = 'new source';
  next.plate.connection!.status = 'measured';
  assert.equal(plateKey(c.plate), plateKey(next.plate));
  assert.notEqual(responseKey(c), responseKey(next));
  assert.equal(k.execute('field', next).modal, a.modal);
  next.plate.connection!.kz *= 2;
  assert.notEqual(k.execute('field', next).modal, a.modal);
  assert.equal(k.stats.modalSolves, 2);
});
test('bounded single-parameter calibration recovers a synthetic stiffness and excludes held-out observations', () => {
  const original = config();
  original.plate.connection!.kz = 18000;
  const truth = config();
  truth.plate.connection!.kz = 45000;
  const exact = solvePlate(truth.plate),
    observations = [3, 6, 8].map((mode, i) => ({
      id: String(mode),
      mode,
      frequency: exact.frequencies[mode - 1],
      role: i < 2 ? ('fit' as const) : ('validation' as const),
      source: 'synthetic solver fixture; not measured',
    }));
  const before = JSON.stringify(original),
    request = {
      config: original,
      parameter: 'kz' as const,
      bounds: [10000, 80000] as [number, number],
      observations,
    },
    a = calibrateConnection(request);
  assert.ok(Math.abs(a.value / 45000 - 1) < 0.002);
  assert.ok(a.trainingRmsRelative < 0.001);
  assert.ok(a.validationRmsRelative! < 0.001);
  const changed = structuredClone(request);
  changed.observations[2].frequency *= 1.2;
  const b = calibrateConnection(changed);
  assert.equal(a.value, b.value);
  assert.ok(b.validationRmsRelative! > 0.1);
  assert.equal(JSON.stringify(original), before);
  assert.equal(a.calibrated.plate.connection!.status, 'calibrated');
});
test('half-power damping uses explicit isolated-peak assumptions and rejects invalid bands', () => {
  assert.equal(halfPowerDamping(100, 98, 102), 0.02);
  assert.throws(() => halfPowerDamping(100, 101, 110));
  assert.throws(() => halfPowerDamping(100, 70, 130));
});
