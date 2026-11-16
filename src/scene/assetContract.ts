import type { Object3D } from 'three';
import { PART_SPECS } from './parts';
/** Binding contract for future measured GLB/CAD imports. No file is treated as measured without attribution. */
export interface InstrumentAssetManifest {
  source: 'measured-cad' | 'photo-reference' | 'concept';
  reference: string;
  metersPerUnit: number;
  nodes: Record<string, string>;
}
export function bindInstrumentAsset(root: Object3D, manifest: InstrumentAssetManifest) {
  if (
    !manifest.reference.trim() ||
    !Number.isFinite(manifest.metersPerUnit) ||
    manifest.metersPerUnit <= 0
  )
    throw Error('모델의 출처와 길이 단위를 지정하세요.');
  const required = ['plate', 'bolt', 'washerTop', 'washerBottom', 'coupler', 'speaker', 'support'];
  const parts: Record<string, Object3D> = {};
  for (const spec of PART_SPECS) {
    const name = manifest.nodes[spec.id];
    if (name) {
      const node = root.getObjectByName(name);
      if (!node) throw Error(`부품 노드 누락: ${name}`);
      parts[spec.id] = node;
    }
  }
  if (required.some((id) => !parts[id])) throw Error('장비의 필수 부품 매핑이 누락되었습니다.');
  if (new Set(Object.values(parts)).size !== Object.keys(parts).length)
    throw Error('서로 다른 부품에 같은 노드를 지정할 수 없습니다.');
  return { root, parts, manifest: structuredClone(manifest) };
}
