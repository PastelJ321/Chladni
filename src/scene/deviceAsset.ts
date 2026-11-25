import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bindInstrumentAsset, type InstrumentAssetManifest } from './assetContract';

export interface LoadedDeviceAsset {
  root: T.Group;
  parts: Record<string, T.Object3D>;
  manifest: InstrumentAssetManifest;
  reference: { name: string; size: number; lastModified: number; type: string };
  restTransforms?: Map<
    T.Object3D,
    { position: T.Vector3; quaternion: T.Quaternion; scale: T.Vector3 }
  >;
}
/** Import local embedded assets only. A user must explicitly state the CAD axes and node mapping. */
export async function loadDeviceAsset(
  file: File,
  manifest: InstrumentAssetManifest,
): Promise<LoadedDeviceAsset> {
  if (!/\.(glb|gltf)$/i.test(file.name) || file.size > 32 * 1024 * 1024)
    throw Error('32 MB 이하의 내장형 GLB/GLTF 파일을 선택하세요.');
  if (manifest.coordinates !== 'Y-up-XZ-plate')
    throw Error('모델은 Y-up, 판 표면 XZ 좌표로 준비하고 좌표계를 확인하세요.');
  let data: string | ArrayBuffer;
  if (/\.gltf$/i.test(file.name)) {
    data = await file.text();
    const json = JSON.parse(data);
    for (const entry of [...(json.buffers ?? []), ...(json.images ?? [])])
      if (entry.uri && !/^data:/.test(entry.uri))
        throw Error('외부 파일을 참조하는 GLTF입니다. 자산을 내장한 GLB로 내보내세요.');
  } else {
    data = await file.arrayBuffer();
    if (new DataView(data).getUint32(0, true) !== 0x46546c67)
      throw Error('올바른 GLB 파일이 아닙니다.');
  }
  // Reject arbitrary network fetches for URI resources even when hidden in an extension.
  const manager = new T.LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(data:|blob:)/.test(url)) return url;
    throw Error('모델의 외부 리소스 요청을 허용하지 않습니다. 내장형 GLB를 사용하세요.');
  });
  const gltf = await new GLTFLoader(manager).parseAsync(data, '');
  try {
    const bound = bindInstrumentAsset(gltf.scene, manifest);
    const box = new T.Box3().setFromObject(bound.parts.plate);
    if (box.isEmpty() || ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite))
      throw Error('판 노드에 관찰할 수 있는 유효한 메시가 없습니다.');
    return {
      root: gltf.scene,
      parts: bound.parts,
      manifest: bound.manifest,
      reference: {
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        type: file.type,
      },
    };
  } catch (error) {
    disposeDeviceAsset(gltf.scene);
    throw error;
  }
}
export function disposeDeviceAsset(asset: LoadedDeviceAsset | T.Object3D) {
  const root = 'root' in asset ? asset.root : asset;
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m);
      for (const v of Object.values(m)) if (v instanceof T.Texture) textures.add(v);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
}
