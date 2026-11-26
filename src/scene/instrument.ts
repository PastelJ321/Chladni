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
    tubular = 80,
  ) {
    const o = mesh(new T.TorusGeometry(radius, tube, 14, tubular), mat, id, 0, y);
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
    sides = 80,
  ) {
    const bevel = Math.min(0.005, height * 0.22),
      p = [
        [inner, -height / 2],
        [outer - bevel, -height / 2],
        [outer, -height / 2 + bevel],
        [outer, height / 2 - bevel],
        [outer - bevel, height / 2],
        [inner + bevel * 0.5, height / 2],
        [inner, height / 2 - bevel * 0.5],
        [inner, -height / 2],
      ].map((v) => new T.Vector2(...(v as [number, number])));
    return mesh(new T.LatheGeometry(p, sides), mat, id, 0, y);
  }

  function socketBolt(
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
    id: InstrumentPartId,
  ) {
    // Machined stainless washer + cylindrical socket-head cap screw with dark hex recess
    cylinder(radius * 1.45, radius * 1.45, height * 0.24, materials.machinedTrim, id, y, x, z, 20);
    cylinder(radius, radius * 1.03, height, materials.steel, id, y + height * 0.56, x, z, 20);
    cylinder(
      radius * 0.5,
      radius * 0.5,
      height * 0.16,
      materials.black,
      id,
      y + height * 1.02,
      x,
      z,
      6,
    );
  }

  // ── 1. PRECISION ANTI-VIBRATION SUPPORT BASE ──────────────────────────────────
  // Main CNC anodized baseplate + top recessed vibration deck + chamfered perimeter trim
  box(2.36, 0.11, 2.16, materials.darkMetal, 'support', 0, 0.205, 0, 0.032);
  box(2.24, 0.022, 2.04, materials.black, 'support', 0, 0.268, 0, 0.018);
  // Machined circular mounting boss & chamfer collar under speaker magnet
  annulus(0.5, 0.64, 0.036, materials.machinedTrim, 'support', 0.292);
  ring(0.62, 0.008, materials.steel, 'support', 0.308);
  // Elastomeric multi-stage vibration isolation feet + stainless leveling rings + corner M5 bolts
  for (const x of [-0.92, 0.92])
    for (const z of [-0.82, 0.82]) {
      // Lower neoprene contact pad (rests at y = 0)
      cylinder(0.155, 0.175, 0.075, materials.rubber, 'support', 0.0375, x, z, 32);
      // Narrower damping waist
      cylinder(0.125, 0.135, 0.045, materials.rubber, 'support', 0.095, x, z, 32);
      // Machined stainless isolation collar
      cylinder(0.15, 0.145, 0.036, materials.machinedTrim, 'support', 0.134, x, z, 32);
      // Corner stainless socket-head bolt
      socketBolt(x, 0.278, z, 0.038, 0.026, 'support');
    }

  // ── 2. ELECTROMAGNETIC MOTOR / MAGNET ASSEMBLY ────────────────────────────────
  // Stepped bottom yoke plate with vent bore
  annulus(0.1, 0.545, 0.085, materials.steel, 'magnet', 0.345);
  ring(0.535, 0.008, materials.machinedTrim, 'magnet', 0.388);
  // Thick sintered ferrite ring magnet with chamfered upper/lower shoulders
  annulus(0.25, 0.515, 0.31, materials.ceramic, 'magnet', 0.542);
  // Upper magnetic top-plate defining the voice-coil air gap
  annulus(0.236, 0.535, 0.165, materials.steel, 'magnet', 0.78);
  ring(0.525, 0.007, materials.machinedTrim, 'magnet', 0.862);
  // Central vented steel pole piece + copper shorting ring inside the air gap
  annulus(0.055, 0.188, 0.37, materials.steel, 'magnet', 0.76);
  annulus(0.188, 0.198, 0.065, materials.copper, 'magnet', 0.895);

  // ── 3. VOICE COIL, FORMER & CORRUGATED SPIDER DAMPER ──────────────────────────
  // Black Kapton/anodized former cylinder
  mesh(new T.CylinderGeometry(0.207, 0.207, 0.31, 72, 1, true), materials.black, 'coil', 0, 1.005);
  // Enameled copper coil backing cylinder + multi-turn precision helical winding
  mesh(
    new T.CylinderGeometry(0.215, 0.215, 0.175, 72, 1, true),
    materials.copper,
    'coil',
    0,
    0.858,
  );
  const windings: T.Vector3[] = [];
  for (let i = 0; i <= 540; i++) {
    const a = (i / 540) * Math.PI * 26;
    windings.push(
      new T.Vector3(Math.cos(a) * 0.2185, 0.775 + (i / 540) * 0.165, Math.sin(a) * 0.2185),
    );
  }
  mesh(
    new T.TubeGeometry(new T.CatmullRomCurve3(windings), 480, 0.0036, 5, false),
    materials.copper,
    'coil',
  );
  // Corrugated phenolic-resin spider damper (classic acoustic transducer internal feature)
  const spiderPts: T.Vector2[] = [];
  for (let i = 0; i <= 32; i++) {
    const u = i / 32,
      r = 0.212 + u * 0.295,
      wave = Math.sin(u * Math.PI * 9) * 0.014 * Math.sin(u * Math.PI);
    spiderPts.push(new T.Vector2(r, 0.965 + wave));
  }
  mesh(new T.LatheGeometry(spiderPts, 72), materials.spider, 'coil');

  // ── 4. DIE-CAST SPEAKER BASKET / FRAME ────────────────────────────────────────
  // Lower basket ring mounted on magnet top-plate
  annulus(0.45, 0.56, 0.042, materials.darkMetal, 'frame', 0.885);
  // Spider landing shelf ring
  annulus(0.48, 0.555, 0.025, materials.darkMetal, 'frame', 0.965);
  // Upper precision mounting flange with recessed surround seat & machined outer bevel
  annulus(0.655, 0.835, 0.052, materials.darkMetal, 'frame', 1.19);
  annulus(0.76, 0.832, 0.018, materials.machinedTrim, 'frame', 1.222);
  ring(0.818, 0.007, materials.steel, 'frame', 1.228);

  // 8 sculpted tapered die-cast basket struts + upper M4 socket-head perimeter bolts
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4,
      sa = Math.sin(a),
      ca = Math.cos(a),
      lower = new T.Vector3(sa * 0.5, 0.88, ca * 0.5),
      upper = new T.Vector3(sa * 0.755, 1.185, ca * 0.755),
      mid = lower.clone().add(upper).multiplyScalar(0.5),
      dir = upper.clone().sub(lower),
      len = dir.length();
    // Main structural rib
    const rib = box(0.068, len, 0.048, materials.darkMetal, 'frame', mid.x, mid.y, mid.z, 0.01);
    rib.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.clone().normalize());
    // Raised stiffening spine along outer face of each die-cast arm
    const spinePos = mid.clone().add(new T.Vector3(sa * 0.026, -0.01, ca * 0.026));
    const spine = box(
      0.024,
      len * 0.88,
      0.028,
      materials.machinedTrim,
      'frame',
      spinePos.x,
      spinePos.y,
      spinePos.z,
      0.006,
    );
    spine.quaternion.copy(rib.quaternion);
    // Counterbored M4 stainless cap screw on upper basket rim
    socketBolt(sa * 0.785, 1.224, ca * 0.785, 0.022, 0.017, 'frame');
  }

  // Molded side terminal block with color-coded (+) red / (-) black knurled brass binding posts
  box(0.42, 0.14, 0.1, materials.black, 'frame', 0, 0.72, 0.55, 0.014);
  for (const [x, mat] of [
    [-0.12, materials.terminalBlack],
    [0.12, materials.terminalRed],
  ] as const) {
    cylinder(0.038, 0.042, 0.055, mat, 'frame', 0.72, x, 0.61, 20).rotation.x = Math.PI / 2;
    cylinder(0.022, 0.022, 0.045, materials.copper, 'frame', 0.72, x, 0.648, 16).rotation.x =
      Math.PI / 2;
  }

  // ── 5. ACOUSTIC CONE & HALF-ROLL BUTYL RUBBER SURROUND ────────────────────────
  // Parabolic ribbed polypropylene/composite acoustic cone
  const conePts = [
    [0.205, 0.985],
    [0.245, 1.032],
    [0.32, 1.09],
    [0.415, 1.142],
    [0.52, 1.182],
    [0.612, 1.202],
    [0.612, 1.211],
    [0.52, 1.191],
    [0.415, 1.151],
    [0.32, 1.099],
    [0.245, 1.041],
    [0.205, 0.994],
    [0.205, 0.985],
  ].map((v) => new T.Vector2(...(v as [number, number])));
  mesh(new T.LatheGeometry(conePts, 96), materials.cone, 'cone');
  // Molded cone stiffening ring & center adhesive collar
  ring(0.365, 0.0055, materials.darkMetal, 'cone', 1.119);
  annulus(0.202, 0.228, 0.022, materials.black, 'cone', 1.005);

  // Authentic half-roll butyl rubber surround with inner cone flange + outer basket clamping lip
  const surroundPts: T.Vector2[] = [new T.Vector2(0.585, 1.204), new T.Vector2(0.614, 1.206)];
  for (let i = 0; i <= 16; i++) {
    const theta = Math.PI - (i / 16) * Math.PI;
    surroundPts.push(
      new T.Vector2(0.674 + Math.cos(theta) * 0.06, 1.208 + Math.sin(theta) * 0.056),
    );
  }
  surroundPts.push(new T.Vector2(0.768, 1.212), new T.Vector2(0.768, 1.224));
  for (let i = 16; i >= 0; i--) {
    const theta = Math.PI - (i / 16) * Math.PI;
    surroundPts.push(
      new T.Vector2(0.674 + Math.cos(theta) * 0.05, 1.208 + Math.sin(theta) * 0.045),
    );
  }
  surroundPts.push(new T.Vector2(0.585, 1.196), new T.Vector2(0.585, 1.204));
  mesh(new T.LatheGeometry(surroundPts, 96), materials.rubber, 'surround');

  // ── 6. VIBRATION COUPLER (ADHESIVE AS-BUILT vs BOLTED CONCEPT) ────────────────
  if (construction === 'bolted') {
    // Conceptual machined aluminum dust-cap hub + tapered adapter + stainless drive shaft
    annulus(0.05, 0.228, 0.09, materials.machinedTrim, 'coupler', 1.15);
    cylinder(0.095, 0.175, 0.16, materials.aluminum, 'coupler', 1.275);
    ring(0.142, 0.008, materials.steel, 'coupler', 1.23);
    cylinder(0.036, 0.036, 0.84, materials.steel, 'coupler', 1.77);
    annulus(0.035, 0.132, 0.048, materials.steel, 'coupler', 2.195);
    for (let i = 0; i < 6; i++) ring(0.0385, 0.0022, materials.steel, 'coupler', 2.095 + i * 0.012);
  } else {
    // As-built unperforated plate temporary coupling: layered foamboard / wood-lock block + masking tape
    // Dust-cap seat pad inside cone throat
    cylinder(0.215, 0.225, 0.042, materials.black, 'coupler', 1.265);
    // Closed-cell foam core block + paper laminate side facings
    box(0.295, 0.91, 0.295, materials.foam, 'coupler', 0, 1.74, 0, 0.012);
    for (const x of [-0.151, 0.151])
      box(0.01, 0.905, 0.29, materials.foamPaper, 'coupler', x, 1.74, 0, 0.003);
    // Upper wide load-spreading backing pad bonded beneath unperforated plate
    box(0.54, 0.034, 0.54, materials.foamPaper, 'coupler', 0, PLATE_Y - 0.034, 0, 0.006);
    // Layered adhesive tape strips securing upper pad & lower cone collar
    for (const z of [-0.19, 0.19])
      box(0.58, 0.012, 0.11, materials.tape, 'coupler', 0, PLATE_Y - 0.019, z, 0.003);
    for (const x of [-0.19, 0.19])
      box(0.11, 0.014, 0.58, materials.tape, 'coupler', x, PLATE_Y - 0.023, 0, 0.003);
    for (const z of [-0.165, 0.165])
      box(0.42, 0.016, 0.075, materials.tape, 'coupler', 0, 1.292, z, 0.004);
    for (const x of [-0.162, 0.162])
      box(0.014, 0.24, 0.22, materials.tape, 'coupler', x, 1.41, 0, 0.003);
  }

  // ── 7. ALUMINUM VIBRATION PLATE ───────────────────────────────────────────────
  const plateGeometry = createPlateGeometry(3.6, 3.6, 0.024, construction === 'bolted' ? 0.046 : 0);
  const plate = mesh(plateGeometry, materials.aluminum, 'plate', 0, PLATE_Y),
    restPositions = Float32Array.from(plateGeometry.attributes.position.array);

  // ── 8. BOLTED CONCEPT FASTENERS (ONLY WHEN CONSTRUCTION === 'bolted') ─────────
  if (construction === 'bolted') {
    annulus(0.042, 0.132, 0.01, materials.steel, 'washerBottom', PLATE_Y - 0.017);
    annulus(0.042, 0.132, 0.018, materials.steel, 'washerTop', PLATE_Y + 0.021);
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
    // Exact contact invariant: washerTop.max.y (2.24 + 0.021 + 0.009 = 2.270) === headBox.min.y (2.275 - 0.005 bevelThickness = 2.270)
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
    const thread: T.Vector3[] = [];
    for (let i = 0; i <= 200; i++) {
      const a = (i / 200) * Math.PI * 18;
      thread.push(new T.Vector3(0.038 * Math.cos(a), 2.14 + (i / 200) * 0.13, 0.038 * Math.sin(a)));
    }
    mesh(
      new T.TubeGeometry(new T.CatmullRomCurve3(thread), 200, 0.004, 5, false),
      materials.steel,
      'bolt',
    );
  }

  // ── 9. SHIELDED SIGNAL CABLE & BASE CLAMP ─────────────────────────────────────
  // Cable clip on baseplate edge
  box(0.095, 0.045, 0.08, materials.machinedTrim, 'support', 0.62, 0.285, 0.98, 0.008);
  const cable = new T.CatmullRomCurve3(
    [
      [0.12, 0.72, 0.65],
      [0.24, 0.44, 0.82],
      [0.62, 0.285, 0.98],
      [1.35, 0.04, 1.24],
      [2.55, 0.032, 1.12],
      [3.8, 0.032, 0.95],
    ].map((v) => new T.Vector3(...(v as [number, number, number]))),
  );
  mesh(new T.TubeGeometry(cable, 64, 0.016, 10, false), materials.rubber, 'support');
  // Molded strain-relief boot at terminal
  const relief = mesh(
    new T.CylinderGeometry(0.025, 0.035, 0.13, 20),
    materials.rubber,
    'support',
    0.155,
    0.665,
    0.695,
  );
  relief.rotation.set(Math.PI * 0.32, 0, -Math.PI * 0.12);

  return { root, parts, plate, restPositions, originals };
}
