import * as T from 'three';
import { seededRandom } from '../concept/physics';

/** All normal/roughness/bump maps are linear data, independent of albedo color space. */
export function createMaterials() {
  const n = 512,
    rand = seededRandom(42),
    normals = new Uint8Array(n * n * 4),
    rough = new Uint8Array(n * n * 4),
    albedo = new Uint8Array(n * n * 4),
    fibers = new Uint8Array(256 * 256 * 4),
    tableNormals = new Uint8Array(n * n * 4),
    tableRough = new Uint8Array(n * n * 4);

  // Fine directional brushed anodized aluminum: subtle hairline normal + roughness + rolling-mill luminance.
  const rowBias = new Float32Array(n);
  for (let y = 0; y < n; y++) {
    rowBias[y] =
      (Math.sin(y * 1.17) * 0.35 +
        Math.sin(y * 3.73 + 1.2) * 0.25 +
        Math.sin(y * 7.91 + 0.5) * 0.15 +
        (rand() - 0.5) * 0.55) *
      0.032;
  }
  for (let y = 0; y < n; y++) {
    const rb = rowBias[y],
      nextRb = rowBias[(y + 1) % n],
      prevRb = rowBias[(y + n - 1) % n],
      millBand = Math.sin((y / n) * Math.PI * 6) * 2.5;
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4,
        streak = Math.sin(x * 0.08 + y * 1.7) * 0.008 + (rand() - 0.5) * 0.011,
        ny = (nextRb - prevRb) * 0.65 + (rand() - 0.5) * 0.012,
        nx = streak,
        z = Math.sqrt(Math.max(0.01, 1 - nx * nx - ny * ny));
      normals.set(
        [
          Math.round((nx + 1) * 127.5),
          Math.round((ny + 1) * 127.5),
          Math.round((z + 1) * 127.5),
          255,
        ],
        i,
      );
      const r = Math.max(
        130,
        Math.min(215, Math.round(168 + rb * 420 + (rand() - 0.5) * 10 + millBand)),
      );
      rough.set([r, r, r, 255], i);
      const tone = Math.max(
        185,
        Math.min(238, Math.round(212 + rb * 260 + (rand() - 0.5) * 6 + millBand)),
      );
      albedo.set([tone - 4, tone, tone + 5, 255], i);
    }
  }

  // Fine isotropic organic/elastomeric micro-grain for cone, rubber, sintered ferrite, foamboard.
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4,
        weave = Math.sin(x * 0.55) * Math.sin(y * 0.55) * 6 + Math.sin((x + y) * 0.25) * 4,
        v = Math.max(80, Math.min(180, Math.round(128 + weave + (rand() - 0.5) * 22)));
      fibers.set([v, v, v, 255], i);
    }

  // Optical breadboard table: dark anodized surface with precision M6 tapped hole grid.
  const cell = 32; // 16x16 holes per tile
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4,
        cx = (x % cell) - cell * 0.5 + 0.5,
        cy = (y % cell) - cell * 0.5 + 0.5,
        dist = Math.hypot(cx, cy),
        grain = (rand() - 0.5) * 0.015;
      let nx = grain,
        ny = Math.sin(y * 0.7) * 0.008 + grain,
        rVal = 138 + Math.floor((rand() - 0.5) * 14);
      if (dist < 4.2) {
        if (dist > 2.3) {
          // Chamfered countersink rim
          const inv = 1 / Math.max(0.001, dist);
          nx = -cx * inv * 0.36;
          ny = -cy * inv * 0.36;
          rVal = 105;
        } else {
          // Dark threaded bore interior
          nx = 0;
          ny = 0;
          rVal = 232;
        }
      }
      const nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
      tableNormals.set(
        [
          Math.round((nx + 1) * 127.5),
          Math.round((ny + 1) * 127.5),
          Math.round((nz + 1) * 127.5),
          255,
        ],
        i,
      );
      tableRough.set([rVal, rVal, rVal, 255], i);
    }

  const dataTex = (a: Uint8Array, w: number, h: number, srgb = false) => {
    const t = new T.DataTexture(a, w, h, T.RGBAFormat);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.magFilter = T.LinearFilter;
    t.minFilter = T.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };

  const brush = dataTex(normals, n, n, false),
    roughness = dataTex(rough, n, n, false),
    albedoMap = dataTex(albedo, n, n, true),
    fiber = dataTex(fibers, 256, 256, false),
    tableNormalMap = dataTex(tableNormals, n, n, false),
    tableRoughMap = dataTex(tableRough, n, n, false);

  brush.repeat.set(2.5, 2.5);
  roughness.repeat.set(2.5, 2.5);
  albedoMap.repeat.set(2.5, 2.5);
  fiber.repeat.set(10, 6);
  tableNormalMap.repeat.set(5, 3.3);
  tableRoughMap.repeat.set(5, 3.3);

  const aluminum = new T.MeshPhysicalMaterial({
    color: '#9aa7b0',
    map: albedoMap,
    metalness: 0.9,
    roughness: 0.42,
    roughnessMap: roughness,
    anisotropy: 0.48,
    anisotropyRotation: 0,
    normalMap: brush,
    normalScale: new T.Vector2(0.14, 0.14),
    clearcoat: 0.08,
    clearcoatRoughness: 0.34,
    envMapIntensity: 0.92,
  });
  const steel = new T.MeshPhysicalMaterial({
    color: '#c4cdd4',
    metalness: 0.94,
    roughness: 0.24,
    anisotropy: 0.28,
    envMapIntensity: 1.15,
  });
  const machinedTrim = new T.MeshPhysicalMaterial({
    color: '#768692',
    metalness: 0.88,
    roughness: 0.3,
    anisotropy: 0.22,
    envMapIntensity: 1.05,
  });
  const darkMetal = new T.MeshPhysicalMaterial({
    color: '#25323d',
    metalness: 0.8,
    roughness: 0.37,
    clearcoat: 0.12,
    clearcoatRoughness: 0.44,
    envMapIntensity: 1.0,
  });
  const black = new T.MeshStandardMaterial({
    color: '#192129',
    metalness: 0.22,
    roughness: 0.54,
    envMapIntensity: 0.85,
  });
  const rubber = new T.MeshPhysicalMaterial({
    color: '#151a1f',
    metalness: 0.02,
    roughness: 0.72,
    clearcoat: 0.08,
    clearcoatRoughness: 0.52,
    bumpMap: fiber,
    bumpScale: 0.0014,
    envMapIntensity: 0.75,
  });
  const cone = new T.MeshStandardMaterial({
    color: '#2d373f',
    metalness: 0.06,
    roughness: 0.74,
    bumpMap: fiber,
    bumpScale: 0.0032,
    side: T.DoubleSide,
    envMapIntensity: 0.85,
  });
  const spider = new T.MeshStandardMaterial({
    color: '#8c6434',
    metalness: 0.05,
    roughness: 0.76,
    bumpMap: fiber,
    bumpScale: 0.004,
    side: T.DoubleSide,
  });
  const copper = new T.MeshPhysicalMaterial({
    color: '#c47c44',
    metalness: 0.92,
    roughness: 0.22,
    clearcoat: 0.35,
    clearcoatRoughness: 0.2,
    envMapIntensity: 1.2,
  });
  const ceramic = new T.MeshStandardMaterial({
    color: '#343a40',
    metalness: 0.14,
    roughness: 0.7,
    bumpMap: fiber,
    bumpScale: 0.0024,
    envMapIntensity: 0.75,
  });
  const terminalRed = new T.MeshStandardMaterial({
    color: '#9c362e',
    metalness: 0.08,
    roughness: 0.42,
  });
  const terminalBlack = new T.MeshStandardMaterial({
    color: '#181e24',
    metalness: 0.08,
    roughness: 0.44,
  });
  const sand = new T.MeshStandardMaterial({ color: '#cfb681', roughness: 0.88 });
  const foam = new T.MeshStandardMaterial({
    color: '#c0c5bc',
    roughness: 0.95,
    metalness: 0,
    bumpMap: fiber,
    bumpScale: 0.0075,
  });
  const foamPaper = new T.MeshStandardMaterial({
    color: '#cfd3cb',
    roughness: 0.86,
    metalness: 0,
    bumpMap: fiber,
    bumpScale: 0.002,
  });
  const tape = new T.MeshPhysicalMaterial({
    color: '#bfa97c',
    roughness: 0.42,
    metalness: 0.02,
    clearcoat: 0.18,
    clearcoatRoughness: 0.38,
    bumpMap: fiber,
    bumpScale: 0.0008,
  });
  const opticalTable = new T.MeshPhysicalMaterial({
    color: '#10212f',
    metalness: 0.48,
    roughness: 0.56,
    roughnessMap: tableRoughMap,
    normalMap: tableNormalMap,
    normalScale: new T.Vector2(0.32, 0.32),
    clearcoat: 0.06,
    clearcoatRoughness: 0.52,
    envMapIntensity: 0.72,
  });

  return {
    aluminum,
    steel,
    machinedTrim,
    darkMetal,
    black,
    rubber,
    cone,
    spider,
    copper,
    ceramic,
    terminalRed,
    terminalBlack,
    sand,
    foam,
    foamPaper,
    tape,
    opticalTable,
    brush,
    roughness,
    albedoMap,
    fiber,
    tableNormalMap,
    tableRoughMap,
  };
}
