import { createPlateGeometry } from './plateGeometry';
import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { createMaterials } from './materials';
import { PART_SPECS, type InstrumentPartId } from './parts';
export const PLATE_Y = 2.24,
  HALF_PLATE = 1.8;
export function createInstrument(
  materials: ReturnType<typeof createMaterials>,
  construction: 'adhesive' | 'bolted' = 'bolted',
) {
  const root = new T.Group();
  root.name = `chladni-${construction}-schematic`;
  const parts = Object.fromEntries(
    PART_SPECS.map((p) => {
      const g = new T.Group();
      g.name = p.id;
      g.userData = { part: p.id, source: p.source };
      return [p.id, g];
    }),
  ) as Record<InstrumentPartId, T.Group>;
  for (const spec of PART_SPECS) {
    if (['frame', 'magnet', 'coil', 'cone', 'surround'].includes(spec.id))
      parts.speaker.add(parts[spec.id]);
    else root.add(parts[spec.id]);
  }
  const originals = new Map<T.MeshStandardMaterial, { opacity: number; color: T.Color }>();
  function mesh(
    geometry: T.BufferGeometry,
    material: T.MeshStandardMaterial,
    id: InstrumentPartId,
    x = 0,
    y = 0,
    z = 0,
  ) {
    const mat = material.clone(),
      o = new T.Mesh(geometry, mat);
    o.position.set(x, y, z);
    o.castShadow = true;
    o.receiveShadow = true;
    o.userData.part = id;
    parts[id].add(o);
    originals.set(mat, { opacity: 1, color: mat.color.clone() });
    return o;
  }
  function cylinder(
    rt: number,
    rb: number,
    h: number,
    mat: T.MeshStandardMaterial,
    id: InstrumentPartId,
    y: number,
    x = 0,
    z = 0,
    sides = 64,
  ) {
    return mesh(new T.CylinderGeometry(rt, rb, h, sides), mat, id, x, y, z);
  }
  function box(
    w: number,
    h: number,
    d: number,
    mat: T.MeshStandardMaterial,
    id: InstrumentPartId,
    x: number,
    y: number,
    z: number,
    r = 0.02,
  ) {
    return mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat, id, x, y, z);
  }
  function ring(
    radius: number,
    tube: number,
    mat: T.MeshStandardMaterial,
    id: InstrumentPartId,
    y: number,
  ) {
    const o = mesh(new T.TorusGeometry(radius, tube, 10, 80), mat, id, 0, y);
    o.rotation.x = Math.PI / 2;
    return o;
  }
  function annulus(
    inner: number,
    outer: number,
    height: number,
    mat: T.MeshStandardMaterial,
    id: InstrumentPartId,
    y: number,
  ) {
    const bevel = Math.min(0.003, height * 0.2),
      p = [
        [inner, -height / 2],
        [outer - bevel, -height / 2],
        [outer, -height / 2 + bevel],
        [outer, height / 2 - bevel],
        [outer - bevel, height / 2],
        [inner, height / 2],
        [inner, -height / 2],
      ].map((v) => new T.Vector2(...(v as [number, number])));
    return mesh(new T.LatheGeometry(p, 80), mat, id, 0, y);
  }
  box(2.25, 0.12, 2.05, materials.darkMetal, 'support', 0, 0.21, 0, 0.035);
  box(2.18, 0.025, 1.98, materials.black, 'support', 0, 0.281, 0, 0.02);
  for (const x of [-0.87, 0.87])
    for (const z of [-0.77, 0.77]) {
      cylinder(0.15, 0.17, 0.15, materials.rubber, 'support', 0.075, x, z);
      cylinder(0.047, 0.047, 0.025, materials.steel, 'support', 0.282, x, z, 6);
    }
  annulus(0.12, 0.53, 0.08, materials.steel, 'magnet', 0.34);
  ring(0.51, 0.009, materials.steel, 'magnet', 0.385);
  cylinder(0.5, 0.5, 0.32, materials.ceramic, 'magnet', 0.54);
  annulus(0.24, 0.52, 0.18, materials.steel, 'magnet', 0.79);
  cylinder(0.19, 0.19, 0.35, materials.steel, 'magnet', 0.77);
  mesh(new T.CylinderGeometry(0.215, 0.215, 0.18, 80, 1, true), materials.copper, 'coil', 0, 0.86);
  mesh(new T.CylinderGeometry(0.207, 0.207, 0.29, 80, 1, true), materials.black, 'coil', 0, 1.015);
  const windings = [];
  for (let i = 0; i <= 640; i++) {
    const a = (i / 640) * Math.PI * 28;
    windings.push(new T.Vector3(Math.cos(a) * 0.218, 0.78 + (i / 640) * 0.17, Math.sin(a) * 0.218));
  }
  mesh(
    new T.TubeGeometry(new T.CatmullRomCurve3(windings), 640, 0.0035, 5, false),
    materials.copper,
    'coil',
  );
  annulus(0.65, 0.82, 0.045, materials.darkMetal, 'frame', 1.19);
  ring(0.79, 0.008, materials.steel, 'frame', 1.216);
  ring(0.67, 0.058, materials.rubber, 'surround', 1.225);
  ring(0.59, 0.018, materials.rubber, 'surround', 1.207);
  mesh(
    new T.LatheGeometry(
      [
        [0.205, 0.99],
        [0.25, 1.04],
        [0.39, 1.13],
        [0.53, 1.19],
        [0.61, 1.205],
        [0.61, 1.213],
        [0.53, 1.198],
        [0.39, 1.138],
        [0.25, 1.048],
        [0.205, 0.998],
        [0.205, 0.99],
      ].map((v) => new T.Vector2(...(v as [number, number]))),
      96,
    ),
    materials.cone,
    'cone',
  );
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4,
      lower = new T.Vector3(Math.sin(a) * 0.46, 0.68, Math.cos(a) * 0.46),
      upper = new T.Vector3(Math.sin(a) * 0.735, 1.19, Math.cos(a) * 0.735),
      center = lower.clone().add(upper).multiplyScalar(0.5),
      rib = box(
        0.074,
        lower.distanceTo(upper),
        0.055,
        materials.darkMetal,
        'frame',
        center.x,
        center.y,
        center.z,
        0.008,
      );
    rib.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), upper.sub(lower).normalize());
    cylinder(
      0.027,
      0.027,
      0.018,
      materials.steel,
      'frame',
      1.238,
      Math.sin(a) * 0.75,
      Math.cos(a) * 0.75,
      6,
    );
  }
  if (construction === 'bolted') {
    cylinder(0.23, 0.2, 0.12, materials.aluminum, 'coupler', 1.16);
    cylinder(0.09, 0.16, 0.15, materials.aluminum, 'coupler', 1.295);
    cylinder(0.036, 0.036, 0.82, materials.steel, 'coupler', 1.77);
    annulus(0.035, 0.13, 0.046, materials.steel, 'coupler', 2.195);
    for (let i = 0; i < 5; i++) ring(0.038, 0.002, materials.steel, 'coupler', 2.105 + i * 0.012);
  } else {
    box(0.31, 0.93, 0.31, materials.foam, 'coupler', 0, 1.74, 0, 0.018);
    box(0.53, 0.045, 0.53, materials.tape, 'coupler', 0, PLATE_Y - 0.037, 0, 0.008);
    for (const z of [-0.17, 0.17])
      box(0.39, 0.018, 0.065, materials.tape, 'coupler', 0, 1.29, z, 0.005);
    for (const x of [-0.163, 0.163])
      box(0.018, 0.22, 0.2, materials.tape, 'coupler', x, 1.43, 0, 0.004);
  }
  const plateGeometry = createPlateGeometry(3.6, 3.6, 0.024, construction === 'bolted' ? 0.046 : 0);
  const plate = mesh(plateGeometry, materials.aluminum, 'plate', 0, PLATE_Y),
    restPositions = Float32Array.from(plateGeometry.attributes.position.array);
  if (construction === 'bolted') {
    annulus(0.042, 0.13, 0.01, materials.steel, 'washerBottom', PLATE_Y - 0.017);
    annulus(0.042, 0.13, 0.018, materials.steel, 'washerTop', PLATE_Y + 0.021);
    cylinder(0.036, 0.036, 0.14, materials.steel, 'bolt', 2.203);
    const headShape = new T.Shape(),
      socket = new T.Path();
    for (let i = 0; i <= 6; i++) {
      const a = (i * Math.PI) / 3,
        x = Math.cos(a) * 0.075,
        y = Math.sin(a) * 0.075;
      i ? headShape.lineTo(x, y) : headShape.moveTo(x, y);
    }
    for (let i = 0; i <= 6; i++) {
      const a = (-i * Math.PI) / 3,
        x = Math.cos(a) * 0.027,
        y = Math.sin(a) * 0.027;
      i ? socket.lineTo(x, y) : socket.moveTo(x, y);
    }
    headShape.holes.push(socket);
    const head = mesh(
      new T.ExtrudeGeometry(headShape, {
        depth: 0.045,
        steps: 1,
        bevelEnabled: true,
        bevelSize: 0.003,
        bevelThickness: 0.005,
        bevelSegments: 2,
        curveSegments: 1,
      }),
      materials.steel,
      'bolt',
      0,
      2.275,
    );
    head.rotation.x = -Math.PI / 2;
    const thread = [];
    for (let i = 0; i <= 240; i++) {
      const a = (i / 240) * Math.PI * 20;
      thread.push(new T.Vector3(0.038 * Math.cos(a), 2.14 + (i / 240) * 0.13, 0.038 * Math.sin(a)));
    }
    mesh(
      new T.TubeGeometry(new T.CatmullRomCurve3(thread), 240, 0.004, 5, false),
      materials.steel,
      'bolt',
    );
  }
  for (const x of [-0.15, 0.15]) {
    box(0.075, 0.1, 0.08, materials.black, 'frame', x, 0.68, 0.52);
    cylinder(0.023, 0.023, 0.04, materials.copper, 'frame', 0.75, x, 0.52, 12);
  }
  const cable = new T.CatmullRomCurve3(
    [
      [0.15, 0.75, 0.54],
      [0.25, 0.4, 0.8],
      [0.65, 0.29, 1.04],
      [1.8, 0.045, 1.25],
      [2.7, 0.045, 1.05],
    ].map((v) => new T.Vector3(...(v as [number, number, number]))),
  );
  mesh(new T.TubeGeometry(cable, 60, 0.014, 8, false), materials.rubber, 'support');
  const relief = mesh(
    new T.CylinderGeometry(0.028, 0.037, 0.14, 24),
    materials.rubber,
    'support',
    0.18,
    0.72,
    0.565,
  );
  relief.rotation.x = Math.PI * 0.38;
  return { root, parts, plate, restPositions, originals };
}
