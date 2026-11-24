import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { DEFAULT_CONFIG, cloneConfig, plateKey } from '../src/experiment/config';
import {
  applyDeviceProfile,
  createDeviceProfile,
  allDeviceMeasurements,
  measurement,
  validateDeviceProfile,
} from '../src/experiment/device';
import { bindInstrumentAsset, validateInstrumentAssetManifest } from '../src/scene/assetContract';
import { decodeSession, encodeSession } from '../src/io/session';
import { readFile } from 'node:fs/promises';
import { loadDeviceAsset, disposeDeviceAsset } from '../src/scene/deviceAsset';

test('current apparatus preserves unknown measurements and user-reported unreplicated observations', () => {
  const p = createDeviceProfile('current');
  assert.equal(p.construction, 'adhesive');
  assert.equal(p.kind, 'as-built');
  assert.equal(p.date, null);
  assert.equal(p.plate.width.value, null);
  assert.equal(p.plate.mass.value, null);
  assert.equal(p.connector.kz.value, null);
  assert.equal(p.speaker.model, '');
  assert.equal(p.observations[0].frequency.value, 100);
  assert.equal(p.observations[0].frequency.source, 'estimated');
  assert.equal(p.observations[0].reproduced, 'no');
  assert.equal(p.observations[1].frequency.value, null);
  assert.ok(allDeviceMeasurements(p).every((m) => m.source !== 'measured'));
  const config = applyDeviceProfile(DEFAULT_CONFIG, p);
  assert.equal(config.plate.width, DEFAULT_CONFIG.plate.width);
  assert.equal(config.plate.connection, undefined);
  assert.equal(plateKey(config.plate), plateKey(DEFAULT_CONFIG.plate));
});
test('profile dimensions, constitutive material and mass affect actual plate inputs with preserved evidence', () => {
  const p = createDeviceProfile('current');
  p.plate.width = {
    ...measurement('m', 0.32, 'measured', 'test fixture ruler'),
    uncertainty: 0.001,
  };
  p.plate.height = measurement('m', 0.28, 'estimated', 'fixture design');
  p.plate.thickness = measurement('m', 0.0015, 'estimated', 'fixture design');
  p.plate.mass = measurement('kg', 0.35, 'measured', 'test fixture scale');
  p.plate.material = 'steel';
  const c = applyDeviceProfile(DEFAULT_CONFIG, p);
  assert.equal(c.plate.width, 0.32);
  assert.equal(c.plate.young, 200e9);
  assert.equal(c.plate.poisson, 0.3);
  assert.equal(c.plate.density, 0.35 / (0.32 * 0.28 * 0.0015));
  assert.notEqual(plateKey(c.plate), plateKey(DEFAULT_CONFIG.plate));
  assert.equal(c.device!.plate.width.uncertainty, 0.001);
  assert.equal(p.plate.width.value, 0.32);
  const metadataOnly = structuredClone(p);
  metadataOnly.notes = 'A new observation, no physical change';
  assert.equal(plateKey(applyDeviceProfile(c, metadataOnly).plate), plateKey(c.plate));
});
test('compliant profile requires explicit stiffness and contact size instead of invented apparatus values', () => {
  const p = createDeviceProfile('reinforced');
  p.calculationAssumption = 'compliant';
  assert.throws(() => applyDeviceProfile(DEFAULT_CONFIG, p), /강성/);
  p.connector.kz = {
    ...measurement('N/m', 10000, 'estimated', 'synthetic test only'),
    range: [1000, 100000],
  };
  p.connector.krx = measurement('N·m/rad', 10, 'estimated', 'synthetic test only');
  p.connector.kry = measurement('N·m/rad', 15, 'estimated', 'synthetic test only');
  p.connector.contactWidth = measurement('m', 0.02, 'estimated', 'synthetic test only');
  p.connector.contactHeight = measurement('m', 0.03, 'estimated', 'synthetic test only');
  p.connector.positionX = measurement('Lx', 0.4, 'estimated', 'synthetic test only');
  const c = applyDeviceProfile(DEFAULT_CONFIG, p);
  assert.equal(c.plate.connection!.kz, 10000);
  assert.equal(c.plate.connection!.mass, 0);
  assert.equal(c.plate.connection!.cz, 0);
  assert.match(c.plate.connection!.reference, /효과 제외/);
  assert.equal(c.plate.connection!.status, 'estimated');
  assert.deepEqual(c.plate.connection!.ranges!.kz, [1000, 100000]);
  assert.equal(c.plate.supportX, 0.4);
  c.plate.connection!.kz = 12000;
  c.plate.connection!.status = 'calibrated';
  const annotation = structuredClone(p);
  annotation.notes = 'Added observation after fitting';
  assert.equal(applyDeviceProfile(c, annotation).plate.connection!.kz, 12000);
  assert.equal(
    applyDeviceProfile(c, annotation).device!.connector.kz.value,
    10000,
    'calibration must not rewrite original evidence',
  );
});
test('profile validation rejects untraceable measured values and preserves photo/file references in session IO', () => {
  const p = createDeviceProfile('current');
  p.plate.width = measurement('m', 0.3, 'measured');
  assert.throws(() => validateDeviceProfile(p), /측정/);
  p.plate.width.reference = 'synthetic fixture ruler';
  p.plate.width.uncertainty = -1;
  assert.throws(() => validateDeviceProfile(p), /불확도/);
  p.plate.width.uncertainty = 0.001;
  p.evidence.push({
    id: 'fixture',
    name: 'fixture.png',
    type: 'image/png',
    size: 8,
    lastModified: 0,
    dataUrl: 'data:image/png;base64,ZmFrZQ==',
  });
  const c = applyDeviceProfile(cloneConfig(DEFAULT_CONFIG), p);
  assert.deepEqual(decodeSession(encodeSession(c, [])).config, c);
  const broken = structuredClone(p);
  broken.connector.positionX = measurement('Lx', 2, 'estimated', 'fixture');
  assert.throws(() => validateDeviceProfile(broken), /위치/);
});
test('adhesive CAD contract requires no nonexistent bolt and keeps source and coordinate contract explicit', () => {
  const root = new Group(),
    nodes: Record<string, string> = {};
  for (const id of ['plate', 'coupler', 'speaker', 'support']) {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.name = id;
    root.add(mesh);
    nodes[id] = id;
  }
  const manifest = {
    source: 'concept' as const,
    reference: 'synthetic geometry fixture',
    metersPerUnit: 0.001,
    construction: 'adhesive' as const,
    coordinates: 'Y-up-XZ-plate' as const,
    nodes,
  };
  assert.equal(bindInstrumentAsset(root, manifest).parts.plate.name, 'plate');
  assert.throws(() => bindInstrumentAsset(root, { ...manifest, construction: 'bolted' }), /필수/);
  assert.throws(() => validateInstrumentAssetManifest({ ...manifest, metersPerUnit: 0 }), /단위/);
  assert.throws(
    () => bindInstrumentAsset(root, { ...manifest, nodes: { ...nodes, support: 'plate' } }),
    /같은 노드/,
  );
  root.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      o.material.dispose();
    }
  });
});
test('edited device variants survive selection and session round trip without losing original measurements', () => {
  const current = createDeviceProfile('current');
  current.notes = 'original fixture observation';
  const first = applyDeviceProfile(DEFAULT_CONFIG, current),
    second = applyDeviceProfile(first, createDeviceProfile('reinforced'));
  assert.equal(second.deviceLibrary!.find((p) => p.id === 'current')!.notes, current.notes);
  const restored = decodeSession(encodeSession(second, [])).config;
  assert.deepEqual(restored.deviceLibrary, second.deviceLibrary);
  assert.equal(
    applyDeviceProfile(
      restored,
      restored.deviceLibrary!.find((p) => p.id === 'current')!,
    ).device!.notes,
    current.notes,
  );
});
test('local embedded GLB parses real mesh nodes and rejects unsupported coordinates', async () => {
  const bytes = await readFile(new URL('./fixtures/device-reference.glb', import.meta.url));
  const file = new File([bytes], 'device-reference.glb', { type: 'model/gltf-binary' }),
    manifest = {
      source: 'concept' as const,
      reference: 'Synthetic QA geometry, not measured CAD',
      metersPerUnit: 1,
      construction: 'adhesive' as const,
      coordinates: 'Y-up-XZ-plate' as const,
      nodes: { plate: 'plate', coupler: 'coupler', speaker: 'speaker', support: 'support' },
    };
  const loaded = await loadDeviceAsset(file, manifest);
  assert.equal(loaded.parts.plate.name, 'plate');
  assert.equal(loaded.reference.name, file.name);
  assert.equal(loaded.manifest.source, 'concept');
  disposeDeviceAsset(loaded);
  await assert.rejects(loadDeviceAsset(file, { ...manifest, coordinates: undefined }), /Y-up/);
});
