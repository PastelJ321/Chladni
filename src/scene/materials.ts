import * as T from 'three';
import { seededRandom } from '../concept/physics';
/** All normal/roughness/bump maps are linear data, independent of albedo color space. */
export function createMaterials() {
  const n = 512,
    rand = seededRandom(42),
    normals = new Uint8Array(n * n * 4),
    rough = new Uint8Array(n * n * 4),
    fibers = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4,
        ny = (Math.sin(y * 2.71) + Math.sin(y * 1.33) * 0.35) * 0.025 + (rand() - 0.5) * 0.012,
        nx = (rand() - 0.5) * 0.009,
        z = Math.sqrt(1 - nx * nx - ny * ny),
        r = 177 + Math.floor(rand() * 7);
      normals.set(
        [
          Math.round((nx + 1) * 127.5),
          Math.round((ny + 1) * 127.5),
          Math.round((z + 1) * 127.5),
          255,
        ],
        i,
      );
      rough.set([r, r, r, 255], i);
    }
  for (let i = 0; i < 128 * 128; i++) {
    const v = 120 + Math.floor(rand() * 20);
    fibers.set([v, v, v, 255], i * 4);
  }
  const data = (a: Uint8Array, w: number, h: number) => {
    const t = new T.DataTexture(a, w, h, T.RGBAFormat);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.magFilter = T.LinearFilter;
    t.minFilter = T.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.colorSpace = T.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const brush = data(normals, n, n),
    roughness = data(rough, n, n),
    fiber = data(fibers, 128, 128);
  brush.repeat.set(3, 4);
  roughness.repeat.set(3, 4);
  fiber.repeat.set(12, 5);
  const aluminum = new T.MeshPhysicalMaterial({
    color: '#a5adb3',
    metalness: 0.96,
    roughness: 0.44,
    roughnessMap: roughness,
    anisotropy: 0.4,
    anisotropyRotation: Math.PI / 2,
    normalMap: brush,
    normalScale: new T.Vector2(0.16, 0.16),
    envMapIntensity: 0.9,
  });
  const steel = new T.MeshStandardMaterial({ color: '#b4bcc2', metalness: 0.95, roughness: 0.29 });
  const darkMetal = new T.MeshStandardMaterial({
    color: '#414b52',
    metalness: 0.78,
    roughness: 0.38,
  });
  const black = new T.MeshStandardMaterial({ color: '#20262b', metalness: 0.3, roughness: 0.55 });
  const rubber = new T.MeshStandardMaterial({
    color: '#171c21',
    metalness: 0,
    roughness: 0.86,
    bumpMap: fiber,
    bumpScale: 0.0015,
  });
  const cone = new T.MeshStandardMaterial({
    color: '#454b4d',
    metalness: 0.02,
    roughness: 0.86,
    bumpMap: fiber,
    bumpScale: 0.004,
    side: T.DoubleSide,
  });
  const copper = new T.MeshStandardMaterial({ color: '#b17c53', metalness: 0.9, roughness: 0.3 });
  const ceramic = new T.MeshStandardMaterial({ color: '#55575a', metalness: 0.1, roughness: 0.68 });
  const sand = new T.MeshStandardMaterial({ color: '#cfb681', roughness: 0.92 });
  return {
    aluminum,
    steel,
    darkMetal,
    black,
    rubber,
    cone,
    copper,
    ceramic,
    sand,
    brush,
    roughness,
    fiber,
  };
}
