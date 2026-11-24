import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, cloneConfig, configKey } from '../src/experiment/config';
import { createDeviceProfile, applyDeviceProfile } from '../src/experiment/device';
import { SolverKernel } from '../src/solver/kernel';
import {
  encodeBinarySession,
  decodeBinarySession,
  encodeSession,
  decodeSession,
  type SessionExtras,
} from '../src/io/session';
import { DEFAULT_ANALYSIS } from '../src/analysis/metrics';
import type { ObservationSnapshot } from '../src/analysis/observationTypes';
import {
  applyParticlePreset,
  numberRatio,
  pendingParticles,
  expectedMass,
} from '../src/particles/presets';
import { initialParticles, simulateParticles } from '../src/simulation/particles';
const c = cloneConfig(DEFAULT_CONFIG);
c.plate.mesh = 4;
c.grains.count = 40;
c.drive.duration = 0.5;
const kernel = new SolverKernel(),
  solved = kernel.execute('solve', c);
if (solved.kind !== 'solved') throw Error('fixture failed');
const run = simulateParticles(c, solved.modal),
  record = {
    id: 'fixture',
    name: 'Synthetic numeric fixture',
    config: c,
    modal: solved.modal,
    sweep: solved.sweep,
    run,
    created: '2026-11-24',
  };
const observations: ObservationSnapshot = {
  schema: 'chladni-observation/1',
  media: { name: 'fixture.webm', size: 1234, lastModified: 0, type: 'video/webm' },
  corners: [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.9, 0.9],
    [0.1, 0.9],
  ],
  corrected: true,
  opacity: 0.6,
  overlay: true,
  sync: true,
  offset: 0.2,
  frameTime: 0.4,
  frequency: '100',
  note: 'Synthetic metadata fixture, not an experimental observation',
  reproduced: 'unknown',
  measured: [],
  responseName: '',
  regions: [
    {
      id: 'r',
      source: 'manual-observation',
      time: 0.4,
      roi: [0, 0, 0.5, 1],
      counts: [4, null],
      note: 'Synthetic manual-count fixture',
    },
  ],
};
test('profile evidence and library edits preserve physical keys and immutable original results', () => {
  const key = configKey(c),
    next = cloneConfig(c);
  next.device!.notes = 'metadata only';
  next.deviceLibrary = [createDeviceProfile('reinforced')];
  next.device!.date = '2026-11-24';
  assert.equal(configKey(next), key);
  assert.equal(run.config.device!.notes, '');
  next.plate.thickness *= 1.2;
  assert.notEqual(configKey(next), key);
  const legacy = cloneConfig(c);
  delete legacy.device;
  delete legacy.deviceLibrary;
  assert.equal(configKey(legacy), JSON.stringify(legacy));
});
test('research metadata, manual identity, profiles, analysis and bookmarks survive binary/JSON round trips', async () => {
  const extras: SessionExtras = {
    observations,
    analysis: DEFAULT_ANALYSIS,
    bookmarks: [
      { id: 'b', name: 'fixture view', pose: { position: [4, 5, 7], target: [0, 2, 0], fov: 32 } },
    ],
  };
  const source = { ...record, observations };
  const binary = decodeBinarySession(
    await encodeBinarySession(c, [source], source, extras).arrayBuffer(),
  );
  assert.deepEqual(binary.extras, extras);
  assert.deepEqual(binary.records[0], source);
  assert.equal(binary.extras!.observations!.regions[0].counts[1], null);
  assert.deepEqual(decodeSession(encodeSession(c, [source], source, extras)), binary);
  const bad = JSON.parse(encodeSession(c, [], null, extras));
  bad.extras.bookmarks[0].pose.position[0] = 'not a number';
  assert.throws(() => decodeSession(JSON.stringify(bad)), /좌표/);
});
test('unknown green-tea measurements cannot produce a computed particle result', () => {
  const next = cloneConfig(c);
  next.grains.groups!.sand = applyParticlePreset('tea');
  assert.equal(pendingParticles(next.grains), true);
  assert.ok(Number.isNaN(expectedMass(next.grains)));
  assert.throws(() => simulateParticles(next, solved.modal), /입경/);
  next.grains.groups!.sand.diameter = 60e-6;
  next.grains.groups!.sand.density = 1200;
  next.grains.groups!.sand.pending = [];
  const computed = simulateParticles(next, solved.modal);
  assert.equal(computed.diameters.length, next.grains.count);
});
test('mass-fraction mixture converts to number sampling using independent diameter distributions', () => {
  const next = cloneConfig(c);
  next.grains.count = 20000;
  next.grains.ratioBasis = 'mass';
  next.grains.ratio = 0.5;
  assert.notEqual(numberRatio(next.grains), 0.5);
  const initial = initialParticles(next);
  const masses = [0, 0];
  initial.masses.forEach((m, i) => (masses[initial.species[i]] += m));
  assert.ok(Math.abs(masses[1] / (masses[0] + masses[1]) - 0.5) < 0.02);
  assert.equal(initial.species.length, 20000);
});
test('contact height recordings survive IO and reject invalid heights without mutating source', async () => {
  const config = cloneConfig(c);
  config.grains.count = 20;
  config.grains.model = 'contact';
  config.drive.frequency = 40;
  const state = kernel.execute('solve', config);
  if (state.kind !== 'solved') throw Error();
  const contact = simulateParticles(config, state.modal);
  assert.ok(contact.frames.every((f) => f.heights?.length === 20));
  const entry = { ...record, config, modal: state.modal, sweep: state.sweep, run: contact };
  const parsed = decodeBinarySession(await encodeBinarySession(config, [], entry).arrayBuffer());
  assert.deepEqual(parsed.active!.run!.frames, contact.frames);
  const corrupt = structuredClone(entry);
  corrupt.run.frames[0].heights![0] = -1;
  assert.throws(() => decodeSession(encodeSession(config, [], corrupt)), /손상/);
  assert.equal(contact.frames[0].heights![0], 0);
});
test('changing profile construction does not manufacture apparatus measurements', () => {
  const applied = applyDeviceProfile(c, createDeviceProfile('current'));
  assert.equal(applied.device!.construction, 'adhesive');
  assert.equal(applied.device!.plate.width.value, null);
  assert.equal(applied.plate.width, c.plate.width);
  assert.equal(applied.plate.connection, undefined);
});

test('cinematic framing follows entered plate height and size while retaining the exact manual origin', async () => {
  const { AnimationDirector } = await import('../src/animation/director');
  const d = new AnimationDirector(),
    origin = { position: [4, 5, 7], target: [0, 2, 0], fov: 32 };
  d.framing = { plateY: 3.5, scale: 2 };
  d.start('macro', origin);
  assert.deepEqual(d.sample()!.camera!.position, origin.position);
  assert.deepEqual(d.sample()!.camera!.target, origin.target);
  d.seek(9);
  assert.ok(Math.abs(d.sample()!.camera!.target[1] - 3.512) < 1e-10);
  assert.equal(d.sample()!.camera!.target[0], 1.1);
  d.interrupt();
  assert.equal(d.sample()!.camera, null);
});
