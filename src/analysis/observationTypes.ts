export type ImagePoint = [number, number];
export interface MediaReference {
  name: string;
  type: string;
  size: number;
  lastModified: number;
  embedded?: string; // Small original images only; never object URLs.
}
export interface ManualRegionObservation {
  id: string;
  source: 'manual-observation';
  time: number;
  roi: [number, number, number, number];
  counts: [number | null, number | null];
  note: string;
}
export interface ObservationSnapshot {
  schema: 'chladni-observation/1';
  media: MediaReference | null;
  corners: ImagePoint[];
  corrected: boolean;
  opacity: number;
  overlay: boolean;
  sync: boolean;
  offset: number;
  frameTime: number;
  frequency: string;
  note: string;
  reproduced: 'unknown' | 'yes' | 'no';
  measured: { frequency: number; amplitude: number }[];
  responseName: string;
  regions: ManualRegionObservation[];
}
export function validateObservationSnapshot(value: unknown): ObservationSnapshot {
  const x = value as ObservationSnapshot;
  if (
    !x ||
    x.schema !== 'chladni-observation/1' ||
    !Array.isArray(x.corners) ||
    x.corners.length > 4 ||
    x.corners.some(
      (p) =>
        !Array.isArray(p) || p.length !== 2 || p.some((v) => !Number.isFinite(v) || v < 0 || v > 1),
    )
  )
    throw Error('관측 정합 기록이 올바르지 않습니다.');
  if (
    ![x.opacity, x.offset, x.frameTime].every(Number.isFinite) ||
    ![x.corrected, x.overlay, x.sync].every((v) => typeof v === 'boolean') ||
    x.opacity < 0 ||
    x.opacity > 1 ||
    x.frameTime < 0 ||
    typeof x.frequency !== 'string' ||
    typeof x.note !== 'string' ||
    x.note.length > 16000 ||
    !['unknown', 'yes', 'no'].includes(x.reproduced)
  )
    throw Error('관측 조건을 확인하세요.');
  if (
    x.media &&
    (typeof x.media.name !== 'string' ||
      !/^(image\/(png|jpeg|webp)|video\/(mp4|webm|quicktime))$/.test(x.media.type) ||
      !Number.isFinite(x.media.size) ||
      x.media.size < 0 ||
      !Number.isFinite(x.media.lastModified) ||
      (x.media.embedded &&
        (!/^data:image\/(png|jpeg|webp);base64,/.test(x.media.embedded) ||
          x.media.embedded.length > 3_000_000)))
  )
    throw Error('미디어 참조를 확인하세요.');
  if (
    !Array.isArray(x.measured) ||
    x.measured.length > 100000 ||
    x.measured.some(
      (p) =>
        !Number.isFinite(p.frequency) ||
        p.frequency <= 0 ||
        !Number.isFinite(p.amplitude) ||
        p.amplitude < 0,
    ) ||
    typeof x.responseName !== 'string'
  )
    throw Error('실측 응답 기록을 확인하세요.');
  if (
    !Array.isArray(x.regions) ||
    x.regions.length > 200 ||
    x.regions.some(
      (r) =>
        r.source !== 'manual-observation' ||
        !Number.isFinite(r.time) ||
        r.time < 0 ||
        !Array.isArray(r.roi) ||
        r.roi.length !== 4 ||
        r.roi.some((v) => !Number.isFinite(v) || v < 0 || v > 1) ||
        r.roi[0] >= r.roi[2] ||
        r.roi[1] >= r.roi[3] ||
        !Array.isArray(r.counts) ||
        r.counts.length !== 2 ||
        r.counts.some((n) => n !== null && (!Number.isInteger(n) || n < 0)) ||
        typeof r.note !== 'string',
    )
  )
    throw Error('수동 영역 관측을 확인하세요.');
  return structuredClone(x);
}
