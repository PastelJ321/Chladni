import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group } from 'three';
import {
  DEFAULT_CONFIG,
  cloneConfig,
  particleGroup,
  sieveGroup,
  configKey,
  validateConfig,
} from '../src/experiment/config';
import { initialParticles, simulateParticles } from '../src/simulation/particles';
import { solvePlate } from '../src/solver/modal';
import { encodeSession, decodeSession } from '../src/io/session';
import { AnimationDirector, explodedParts, SEQUENCES } from '../src/animation/director';
import { bindInstrumentAsset } from '../src/scene/assetContract';
const c = cloneConfig(DEFAULT_CONFIG);
c.grains.count = 80;
c.drive.duration = 0.5;
c.drive.kind = 'force';
c.plate.boundary = 'simply-supported';
c.plate.mesh = 4;
c.drive.force = 0.8;
const modal = solvePlate(c.plate);
c.drive.frequency = modal.frequencies[0];
test('each species has independent size, distribution, density and friction', () => {
  const a = initialParticles(c),
    changed = cloneConfig(c);
  Object.assign(changed.grains.groups!.sand, {
    diameter: 170e-6,
    spread: 0.1,
    density: 3200,
    friction: 0.65,
  });
  validateConfig(changed);
  const b = initialParticles(changed);
  assert.deepEqual(a.species, b.species);
  assert.deepEqual(a.positions, b.positions);
  for (let i = 0; i < a.species.length; i++) {
    if (a.species[i]) {
      assert.equal(a.diameters[i], b.diameters[i]);
      assert.equal(a.masses[i], b.masses[i]);
    } else {
      assert.notEqual(a.diameters[i], b.diameters[i]);
      assert.notEqual(a.masses[i], b.masses[i]);
    }
  }
  const ra = simulateParticles(c, modal),
    rb = simulateParticles(changed, modal);
  for (let i = 0; i < a.species.length; i++)
    if (a.species[i])
      assert.deepEqual(
        ra.frames.at(-1)!.positions.slice(i * 2, i * 2 + 2),
        rb.frames.at(-1)!.positions.slice(i * 2, i * 2 + 2),
      );
});
test('sieve bounds apply only to chosen species and seed replay is identical', () => {
  const next = cloneConfig(c);
  next.grains.groups!.salt = sieveGroup(particleGroup(next.grains, 1), 125, 250);
  const a = initialParticles(next);
  for (let i = 0; i < a.species.length; i++)
    if (a.species[i]) assert.ok(a.diameters[i] >= 125e-6 && a.diameters[i] <= 250e-6);
  const x = simulateParticles(next, modal),
    y = simulateParticles(next, modal);
  assert.deepEqual(x.frames, y.frames);
  assert.deepEqual(x.diameters, y.diameters);
});
test('legacy v0.2 records preserve original keys and calculation arrays through v0.3 IO', () => {
  const old = cloneConfig(c);
  delete old.grains.groups;
  const run = simulateParticles(old, modal);
  // v0.2 used full-config field keys and a full-plate modal key, without recording metadata.
  run.fields = run.fields.map((f) => ({ ...f, key: configKey(old) }));
  delete run.motion;
  delete run.precision;
  delete run.recordHz;
  const record = {
    id: 'legacy',
    name: 'v02',
    config: old,
    modal: { ...modal, key: JSON.stringify(old.plate) },
    sweep: { key: configKey(old), source: 'FEM' as const, points: [], peaks: [] },
    run,
    created: '2026-11-12',
  };
  const raw = JSON.stringify(
    {
      schema: 'chladni/2',
      config: old,
      records: [record],
      active: record,
    },
    (_key, v) => (v instanceof Float32Array ? Array.from(v) : v),
  );
  // Historical files used ordinary numeric arrays.
  const legacyRecord = JSON.parse(raw).records[0];
  const loaded = decodeSession(raw);
  assert.deepEqual(loaded.records[0], legacyRecord);
  assert.equal(loaded.records[0].run!.key, configKey(old));
  assert.deepEqual(
    decodeSession(encodeSession(loaded.config, loaded.records, loaded.active)),
    loaded,
  );
  assert.equal(particleGroup(old.grains, 0).diameter, old.grains.diameter);
});
test('film state never mutates physical conditions or simulation result', () => {
  const result = simulateParticles(c, modal),
    snapshot = JSON.stringify({ c, result }),
    d = new AnimationDirector();
  for (const s of SEQUENCES) {
    d.start(s.id, { position: [4, 5, 7], target: [0, 2, 0], fov: 32 });
    d.seek(s.duration * 0.6);
    const frame = d.sample()!;
    assert.ok(frame.camera!.position.every(Number.isFinite));
    assert.equal(JSON.stringify({ c, result }), snapshot);
  }
});
test('part releases are staggered, axial until clear, and assembly returns exactly to contacts', () => {
  const early = explodedParts(0.12),
    later = explodedParts(0.65);
  assert.ok(early.bolt.offset[1] > early.plate.offset[1]);
  assert.equal(early.plate.offset[1], 0);
  assert.ok(later.washerTop.offset[1] > later.plate.offset[1]);
  const d = new AnimationDirector();
  d.start('exploded', { position: [5, 5, 7], target: [0, 2, 0] });
  d.seek(d.duration);
  for (const part of Object.values(d.sample()!.parts!)) {
    assert.deepEqual(part.offset, [0, 0, 0]);
    assert.ok(part.rotation.every((v) => v === 0));
  }
});
test('director pause, resume, seek, stop and manual takeover are deterministic', () => {
  const d = new AnimationDirector();
  d.start('formation', { position: [5, 5, 7], target: [0, 2, 0] });
  d.tick(0.1);
  d.pause();
  const frame = d.sample();
  d.tick(0.1);
  assert.deepEqual(d.sample(), frame);
  d.resume();
  d.tick(0.1);
  assert.ok(d.time > 0.1);
  d.interrupt();
  const t = d.time;
  d.tick(0.1);
  assert.equal(d.time, t);
  assert.equal(d.sample()!.camera, null);
  d.seek(5);
  assert.equal(d.time, 5);
  assert.equal(d.playing, false);
  d.stop();
  assert.equal(d.sample(), null);
});
test('all cinematic tracks have finite poses and hold at their terminal frame', () => {
  for (const seq of SEQUENCES) {
    const d = new AnimationDirector();
    d.start(seq.id, { position: [5, 5, 7], target: [0, 2, 0], fov: 32 });
    for (let t = 0; t <= seq.duration; t += 0.25) {
      d.seek(t);
      const f = d.sample()!;
      assert.ok(f.camera!.position.every(Number.isFinite));
      assert.ok(f.camera!.target.every(Number.isFinite));
      assert.ok(Number.isFinite(f.phase));
    }
    d.seek(d.duration);
    const f = d.sample();
    d.tick(0.1);
    assert.deepEqual(d.sample(), f);
  }
});
test('measured-model adapter requires explicit source, scale, and distinct part nodes', () => {
  const root = new Group(),
    nodes: Record<string, string> = {};
  for (const id of [
    'plate',
    'bolt',
    'washerTop',
    'washerBottom',
    'coupler',
    'speaker',
    'support',
  ]) {
    const node = new Group();
    node.name = id;
    root.add(node);
    nodes[id] = id;
  }
  const manifest = {
    source: 'photo-reference' as const,
    reference: 'user photograph / pending measurements',
    metersPerUnit: 1,
    nodes,
  };
  assert.equal(bindInstrumentAsset(root, manifest).parts.plate, root.getObjectByName('plate'));
  assert.throws(() => bindInstrumentAsset(root, { ...manifest, reference: '' }));
  assert.throws(() =>
    bindInstrumentAsset(root, { ...manifest, nodes: { ...nodes, washerTop: 'missing' } }),
  );
});
