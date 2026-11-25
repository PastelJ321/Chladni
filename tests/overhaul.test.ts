import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  cloneConfig,
  plateKey,
  responseKey,
  sweepKey,
} from '../src/experiment/config';
import { SolverKernel } from '../src/solver/kernel';
import {
  simulateParticles,
  frameAt,
  framePair,
  interpolateField,
} from '../src/simulation/particles';
import { PlaybackClock } from '../src/simulation/clock';
import {
  encodeBinarySession,
  decodeBinarySession,
  encodeSession,
  decodeSession,
} from '../src/io/session';
import type { Field } from '../src/experiment/types';
const c = cloneConfig(DEFAULT_CONFIG);
c.plate.mesh = 4;
c.grains.count = 40;
c.drive.duration = 0.5;
test('modal cache ignores frequency, particle properties and damping; physical plate changes invalidate it', () => {
  const kernel = new SolverKernel();
  const first = kernel.execute('solve', c);
  const next = cloneConfig(c);
  next.drive.frequency += 100;
  next.grains.groups!.sand.diameter *= 2;
  next.plate.damping *= 2;
  const second = kernel.execute('field', next);
  assert.equal(first.modal, second.modal);
  assert.equal(kernel.stats.modalSolves, 1);
  assert.equal(plateKey(c.plate), plateKey(next.plate));
  assert.notEqual(responseKey(c), responseKey(next));
  next.plate.thickness *= 2;
  kernel.execute('field', next);
  assert.equal(kernel.stats.modalSolves, 2);
  const other = cloneConfig(c);
  other.grains.count *= 2;
  assert.equal(responseKey(c), responseKey(other));
  assert.equal(sweepKey(c), sweepKey(other));
  const legacy = { ...first.modal, key: JSON.stringify(c.plate) },
    restored = new SolverKernel();
  const hydrated = restored.execute('field', c, () => {}, legacy);
  assert.equal(restored.stats.modalSolves, 0);
  assert.equal(hydrated.modal.key, plateKey(c.plate));
  assert.equal(legacy.key, JSON.stringify(c.plate), 'seeding must not mutate archived keys');
});
test('continuous playback interpolates actual timestamps without changing checkpoints', () => {
  const k = new SolverKernel();
  const r = simulateParticles(c, k.execute('field', c).modal),
    before = Float32Array.from(r.frames[1].positions);
  // Introduce a known, recorded endpoint; interpolation must remain within recorded endpoints.
  r.frames[1].positions[0] = 0.8;
  r.frames[0].positions[0] = 0.2;
  const f = frameAt(r, 0.025);
  assert.ok(Math.abs(f.positions[0] - 0.5) < 1e-6);
  assert.equal(f.time, 0.025);
  assert.equal(frameAt(r, 0), r.frames[0]);
  assert.equal(frameAt(r, 999), r.frames.at(-1));
  assert.equal(framePair(r, 0.025).alpha, 0.5);
  assert.equal(before.length, r.frames[1].positions.length);
  assert.ok(Math.abs(r.frames[1].positions[0] - 0.8) < 1e-6);
});
test('complex interpolation cancels opposite phases instead of interpolating amplitudes', () => {
  const a: Field = {
    source: 'FEM',
    key: 'test',
    size: 2,
    real: [1, 1, 1, 1],
    imag: [0, 0, 0, 0],
    amplitude: [1, 1, 1, 1],
    peak: 1,
    frequency: 100,
  };
  const b = { ...a, real: [-1, -1, -1, -1], frequency: 200 };
  const f = interpolateField(a, b, 0.5);
  assert.deepEqual(f.amplitude, [0, 0, 0, 0]);
  assert.equal(f.frequency, 150);
});
test('absolute clock keeps elapsed time through dropped frames, pause and rewind', () => {
  const t = new PlaybackClock();
  t.duration = 20;
  t.play(1000);
  assert.equal(t.sample(1400), 0.4);
  assert.equal(t.sample(4000), 3);
  t.pause(4000);
  assert.equal(t.sample(9000), 3);
  t.seek(1, 9000);
  t.speed(0.25, 9000);
  t.play(9000);
  assert.equal(t.sample(11000), 1.5);
});
test('typed recording and binary/JSON round trips preserve every sample', async () => {
  const k = new SolverKernel(),
    s = k.execute('solve', c);
  assert.equal(s.kind, 'solved');
  if (s.kind !== 'solved') return;
  const r = simulateParticles(c, s.modal);
  assert.ok(r.frames[0].positions instanceof Float32Array);
  const record = {
    id: 'v4',
    name: 'roundtrip',
    config: c,
    modal: s.modal,
    sweep: s.sweep,
    run: r,
    created: '2026-11-17',
  };
  const blob = encodeBinarySession(c, [record], record),
    decoded = decodeBinarySession(await blob.arrayBuffer());
  assert.deepEqual(decoded.records[0], record);
  assert.deepEqual(decodeSession(encodeSession(c, [record])).records[0], record);
});

import * as T from 'three';
import { ParticleRenderer } from '../src/render/ParticleRenderer';
import { PlateField } from '../src/render/PlateField';
import { createInstrument } from '../src/scene/instrument';
import { createMaterials } from '../src/scene/materials';
import {
  PARTICLE_PRESETS,
  applyParticlePreset,
  estimateCount,
  expectedMass,
} from '../src/particles/presets';
import { QualityGovernor } from '../src/render/quality';
test('particle visibility and 100k representative display never alter physical data or mass', () => {
  const k = new SolverKernel(),
    run = simulateParticles(c, k.execute('field', c).modal),
    before = JSON.stringify(run),
    field = new PlateField(),
    cloud = new ParticleRenderer(field),
    camera = new T.PerspectiveCamera(32, 1, 0.005, 100);
  camera.position.set(4, 5, 6);
  cloud.root.position.y = 2.252;
  cloud.update(c, run, 0.01, { ...DEFAULT_CONFIG_VIEW(), count: 100000 }, camera, 700, 1, false);
  assert.equal(cloud.stats.displayCount, 100000);
  assert.equal(cloud.stats.physicalCount, 40);
  const uploads = cloud.stats.uploadedBytes;
  cloud.update(
    c,
    run,
    0.02,
    { ...DEFAULT_CONFIG_VIEW(), mode: 'actual', count: 100000 },
    camera,
    700,
    1,
    false,
  );
  assert.equal(cloud.stats.uploadedBytes, uploads);
  assert.equal(JSON.stringify(run), before);
  assert.equal(cloud.uniforms.uObserve.value, 0);
  cloud.dispose();
  field.dispose();
});
function DEFAULT_CONFIG_VIEW() {
  return {
    mode: 'observe' as const,
    apparentSize: 1,
    minimumPixelDiameter: 1.8,
    displayMagnification: 2.5,
    count: 0,
    LOD: 'auto' as const,
    shadingMode: 'material' as const,
  };
}
test('expanded species, mass estimate, high counts and motion diagnosis remain reproducible', () => {
  const next = cloneConfig(c);
  next.grains.groups!.sand = applyParticlePreset('sugar');
  next.grains.groups!.salt = applyParticlePreset('glass');
  next.grains.count = 20000;
  next.drive.displacement = 0;
  const k = new SolverKernel(),
    run = simulateParticles(next, k.execute('field', next).modal);
  assert.equal(run.species.length, 20000);
  assert.equal(run.motion!.state, 'undriven');
  assert.equal(run.motion!.movingCount, 0);
  const small = cloneConfig(next);
  small.plate.width = small.plate.height = 0.1;
  small.plate.thickness = 0.001;
  small.grains.count = 40;
  small.grains.groups!.sand.diameter = small.grains.groups!.salt.diameter = 0.002;
  const still = simulateParticles(small, k.execute('field', small).modal);
  assert.equal(
    still.motion!.maxDistance,
    0,
    'large stationary grains must start inside their physical boundary',
  );
  assert.ok(
    Math.abs(run.motion!.totalMass - expectedMass(next.grains) * 20000) /
      (expectedMass(next.grains) * 20000) <
      0.03,
  );
  assert.equal(estimateCount(next.grains, expectedMass(next.grains) * 20000), 20000);
  assert.equal(PARTICLE_PRESETS.glass.density, 2500);
  assert.ok(run.frames.every((f) => f.positions.length === 40000));
});
test('actual beveled apparatus geometry is finite and head/washer contacts assemble consistently', () => {
  const materials = createMaterials(),
    instrument = createInstrument(materials);
  instrument.root.updateMatrixWorld(true);
  const washer = new T.Box3().setFromObject(instrument.parts.washerTop),
    head = instrument.parts.bolt.children.find(
      (o) => o instanceof T.Mesh && o.geometry.type === 'ExtrudeGeometry',
    )!;
  const headBox = new T.Box3().setFromObject(head);
  assert.ok(Math.abs(washer.max.y - headBox.min.y) < 1e-5);
  assert.ok(instrument.plate.geometry.index!.count > 0);
  const pos = instrument.plate.geometry.attributes.position;
  let interior = 0;
  for (let i = 0; i < pos.count; i++)
    if (Math.abs(pos.getX(i)) < 1.5 && Math.abs(pos.getZ(i)) < 1.5) interior++;
  assert.ok(interior > 1000, 'plate faces must have interior vertices to display FEM deformation');
  instrument.root.traverse((o) => {
    if (o instanceof T.Mesh) {
      assert.ok(Array.from(o.geometry.attributes.position.array).every(Number.isFinite));
      o.geometry.dispose();
      (o.material as T.Material).dispose();
    }
  });
  Object.values(materials).forEach((v) => v.dispose());
});
test('adaptive quality uses hysteresis and leaves physical configuration unchanged', () => {
  const q = new QualityGovernor(),
    snapshot = JSON.stringify(c);
  for (let i = 0; i < 150; i++) q.sample(1 / 20, true);
  assert.equal(q.degraded, true);
  for (let i = 0; i < 600; i++) q.sample(1 / 60, true);
  assert.equal(q.degraded, false);
  assert.equal(JSON.stringify(c), snapshot);
});
