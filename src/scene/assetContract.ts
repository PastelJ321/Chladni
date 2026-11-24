import type { Object3D } from 'three';
import { PART_SPECS } from './parts';
/** Binding contract for future measured GLB/CAD imports. No file is treated as measured without attribution. */
export interface InstrumentAssetManifest {
  source: 'measured-cad' | 'photo-reference' | 'concept';
  reference: string;
  metersPerUnit: number;
  nodes: Record<string, string>;
  construction?: 'adhesive' | 'bolted';
  coordinates?: 'Y-up-XZ-plate';
}
export function validateInstrumentAssetManifest(
  value: unknown,
): asserts value is InstrumentAssetManifest {
  const m = value as InstrumentAssetManifest;
  if (
    !m ||
    !['measured-cad', 'photo-reference', 'concept'].includes(m.source) ||
    typeof m.reference !== 'string' ||
    !m.reference.trim() ||
    !Number.isFinite(m.metersPerUnit) ||
    m.metersPerUnit <= 0 ||
    !m.nodes ||
    typeof m.nodes !== 'object' ||
    Array.isArray(m.nodes) ||
    !Object.values(m.nodes).every((n) => typeof n === 'string') ||
    (m.construction !== undefined && !['adhesive', 'bolted'].includes(m.construction)) ||
    (m.coordinates !== undefined && m.coordinates !== 'Y-up-XZ-plate')
  )
    throw Error('모델의 출처·길이 단위·부품 매핑을 확인하세요.');
}
export function bindInstrumentAsset(root: Object3D, manifest: InstrumentAssetManifest) {
  validateInstrumentAssetManifest(manifest);
  if (
    !manifest.reference.trim() ||
    !Number.isFinite(manifest.metersPerUnit) ||
    manifest.metersPerUnit <= 0
  )
    throw Error('모델의 출처와 길이 단위를 지정하세요.');
  const required =
    manifest.construction === 'adhesive'
      ? ['plate', 'coupler', 'speaker', 'support']
      : ['plate', 'bolt', 'washerTop', 'washerBottom', 'coupler', 'speaker', 'support'];
  const parts: Record<string, Object3D> = {};
  const supported = new Set<string>([...PART_SPECS.map((p) => p.id), 'adhesive', 'foam']);
  for (const [id, name] of Object.entries(manifest.nodes)) {
    if (!supported.has(id)) throw Error(`알 수 없는 부품 식별자: ${id}`);
    if (name) {
      const node = root.getObjectByName(name);
      if (!node) throw Error(`부품 노드 누락: ${name}`);
      parts[id] = node;
    }
  }
  if (required.some((id) => !parts[id])) throw Error('장비의 필수 부품 매핑이 누락되었습니다.');
  if (new Set(Object.values(parts)).size !== Object.keys(parts).length)
    throw Error('서로 다른 부품에 같은 노드를 지정할 수 없습니다.');
  return { root, parts, manifest: structuredClone(manifest) };
}
