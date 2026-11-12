import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PartId } from '../model/catalog';
import { createMaterials } from './materials';

export const PLATE_Y = 2.24;
export const HALF_PLATE = 1.8;

export function createInstrument(materials: ReturnType<typeof createMaterials>) {
  const root = new THREE.Group();
  const parts = Object.fromEntries(
    ['plate', 'bolt', 'coupler', 'speaker', 'support', 'particles'].map((id) => {
      const group = new THREE.Group();
      group.name = id;
      group.userData.part = id;
      root.add(group);
      return [id, group];
    }),
  ) as Record<PartId, THREE.Group>;
  const originals = new Map<THREE.MeshStandardMaterial, { opacity: number; color: THREE.Color }>();

  function mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.MeshStandardMaterial,
    part: PartId,
    x: number,
    y: number,
    z: number,
  ) {
    const localMaterial = material.clone();
    const object = new THREE.Mesh(geometry, localMaterial);
    object.position.set(x, y, z);
    object.castShadow = true;
    object.receiveShadow = true;
    object.userData.part = part;
    parts[part].add(object);
    originals.set(localMaterial, { opacity: 1, color: material.color.clone() });
    return object;
  }
  const cylinder = (
    rt: number,
    rb: number,
    h: number,
    mat: THREE.MeshStandardMaterial,
    part: PartId,
    y: number,
    x = 0,
    z = 0,
    sides = 64,
  ) => mesh(new THREE.CylinderGeometry(rt, rb, h, sides), mat, part, x, y, z);
  const box = (
    w: number,
    h: number,
    d: number,
    mat: THREE.MeshStandardMaterial,
    part: PartId,
    x: number,
    y: number,
    z: number,
    radius = 0.025,
  ) => mesh(new RoundedBoxGeometry(w, h, d, 3, radius), mat, part, x, y, z);
  const torus = (
    radius: number,
    tube: number,
    mat: THREE.MeshStandardMaterial,
    part: PartId,
    y: number,
  ) => {
    const object = mesh(new THREE.TorusGeometry(radius, tube, 12, 80), mat, part, 0, y, 0);
    object.rotation.x = Math.PI / 2;
    return object;
  };

  // The stationary frame supports the driver only; nothing touches the free plate edges.
  box(2.25, 0.12, 2.05, materials.darkMetal, 'support', 0, 0.21, 0, 0.07);
  for (const x of [-0.87, 0.87])
    for (const z of [-0.77, 0.77]) {
      cylinder(0.16, 0.18, 0.15, materials.rubber, 'support', 0.075, x, z);
      cylinder(0.06, 0.06, 0.035, materials.steel, 'support', 0.283, x, z, 6);
    }
  cylinder(0.53, 0.53, 0.09, materials.steel, 'speaker', 0.34);
  cylinder(0.5, 0.5, 0.32, materials.ceramic, 'speaker', 0.54);
  const topPole = [
    new THREE.Vector2(0.24, -0.1),
    new THREE.Vector2(0.52, -0.1),
    new THREE.Vector2(0.52, 0.1),
    new THREE.Vector2(0.24, 0.1),
    new THREE.Vector2(0.24, -0.1),
  ];
  mesh(new THREE.LatheGeometry(topPole, 64), materials.steel, 'speaker', 0, 0.8, 0);
  // Fixed pole, annular air gap, and the copper voice-coil carried by the moving cone.
  cylinder(0.19, 0.19, 0.35, materials.steel, 'speaker', 0.77);
  mesh(
    new THREE.CylinderGeometry(0.217, 0.217, 0.18, 64, 1, true),
    materials.copper,
    'speaker',
    0,
    0.86,
    0,
  );
  for (let i = 0; i < 14; i++) torus(0.218, 0.004, materials.copper, 'speaker', 0.78 + i * 0.012);
  mesh(
    new THREE.CylinderGeometry(0.208, 0.208, 0.3, 64, 1, true),
    materials.black,
    'speaker',
    0,
    1.01,
    0,
  );
  torus(0.75, 0.048, materials.darkMetal, 'speaker', 1.19);
  torus(0.67, 0.065, materials.rubber, 'speaker', 1.23);
  torus(0.57, 0.023, materials.rubber, 'speaker', 1.205);
  const conePoints = [
    new THREE.Vector2(0.2, 0.99),
    new THREE.Vector2(0.24, 1.025),
    new THREE.Vector2(0.52, 1.18),
    new THREE.Vector2(0.61, 1.2),
  ];
  mesh(new THREE.LatheGeometry(conePoints, 80), materials.cone, 'speaker', 0, 0, 0);
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const rib = box(
      0.095,
      0.63,
      0.065,
      materials.darkMetal,
      'speaker',
      Math.sin(angle) * 0.6,
      0.93,
      Math.cos(angle) * 0.6,
    );
    rib.rotation.set(Math.cos(angle) * -0.47, 0, Math.sin(angle) * 0.47);
    cylinder(
      0.034,
      0.034,
      0.025,
      materials.steel,
      'speaker',
      1.25,
      Math.sin(angle) * 0.75,
      Math.cos(angle) * 0.75,
      6,
    );
  }
  // Rigid adapter replaces a decorative dust-cap; it connects to the coil former.
  cylinder(0.23, 0.2, 0.12, materials.aluminum, 'coupler', 1.16);
  cylinder(0.11, 0.16, 0.15, materials.aluminum, 'coupler', 1.295);
  cylinder(0.068, 0.068, 0.82, materials.steel, 'coupler', 1.77);
  cylinder(0.15, 0.15, 0.09, materials.steel, 'coupler', 2.195);
  for (let i = 0; i < 12; i++) torus(0.072, 0.006, materials.steel, 'coupler', 2.02 + i * 0.013);

  // Finely tessellated solid plate with a center aperture under the washer.
  const plateGeometry = new THREE.BoxGeometry(3.6, 0.024, 3.6, 82, 1, 82);
  const indices = plateGeometry.index!;
  const vertices = plateGeometry.attributes.position;
  const filtered: number[] = [];
  for (let i = 0; i < indices.count; i += 3) {
    const ids = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
    const x = ids.reduce((sum, id) => sum + vertices.getX(id), 0) / 3;
    const z = ids.reduce((sum, id) => sum + vertices.getZ(id), 0) / 3;
    if (Math.hypot(x, z) > 0.054) filtered.push(...ids);
  }
  plateGeometry.setIndex(filtered);
  const plate = mesh(plateGeometry, materials.aluminum, 'plate', 0, PLATE_Y, 0);
  const restPositions = Float32Array.from(plate.geometry.attributes.position.array);
  cylinder(0.15, 0.15, 0.017, materials.steel, 'bolt', PLATE_Y + 0.023);
  cylinder(0.105, 0.105, 0.075, materials.steel, 'bolt', PLATE_Y + 0.062, 0, 0, 6);
  cylinder(0.052, 0.052, 0.017, materials.darkMetal, 'bolt', PLATE_Y + 0.108, 0, 0, 6);

  // Two insulated terminals and a cable on the stationary side of the driver.
  for (const x of [-0.15, 0.15]) {
    box(0.09, 0.12, 0.08, materials.black, 'speaker', x, 0.69, 0.52);
    cylinder(0.028, 0.028, 0.06, materials.copper, 'speaker', 0.78, x, 0.52, 12);
  }
  const cablePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.15, 0.75, 0.54),
    new THREE.Vector3(0.22, 0.4, 0.8),
    new THREE.Vector3(0.65, 0.28, 1.04),
    new THREE.Vector3(1.8, 0.05, 1.25),
    new THREE.Vector3(2.7, 0.05, 1.05),
  ]);
  mesh(
    new THREE.TubeGeometry(cablePath, 48, 0.018, 8, false),
    materials.rubber,
    'support',
    0,
    0,
    0,
  );
  return { root, parts, plate, restPositions, originals };
}
