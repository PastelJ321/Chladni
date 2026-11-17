const tag = '__chladni_f32_le__';
const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
export function floatBytes(a: Float32Array) {
  if (littleEndian) return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const out = new Uint8Array(a.byteLength),
    view = new DataView(out.buffer);
  a.forEach((v, i) => view.setFloat32(i * 4, v, true));
  return out;
}
export function readFloats(bytes: Uint8Array) {
  if (bytes.byteLength % 4) throw Error('손상된 Float32 기록입니다.');
  if (littleEndian) return new Float32Array(bytes.slice().buffer);
  const a = new Float32Array(bytes.byteLength / 4),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < a.length; i++) a[i] = view.getFloat32(i * 4, true);
  return a;
}
export function jsonArrays(_key: string, v: unknown) {
  if (!(v instanceof Float32Array)) return v;
  const b = floatBytes(v);
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return { [tag]: btoa(s) };
}
export function reviveArrays(_key: string, v: unknown) {
  if (v && typeof v === 'object' && tag in v) {
    const b = atob(String((v as Record<string, unknown>)[tag]));
    return readFloats(Uint8Array.from(b, (c) => c.charCodeAt(0)));
  }
  return v;
}
/** Small JSON manifest + deduplicated Float32 payload. Native LE wire format, no precision loss. */
export function packBinary(value: unknown): Blob {
  const buffers: Uint8Array[] = [],
    seen = new Map<Float32Array, number>();
  const text = JSON.stringify(value, (_k, v) => {
    if (!(v instanceof Float32Array)) return v;
    let i = seen.get(v);
    if (i === undefined) {
      i = buffers.length;
      seen.set(v, i);
      buffers.push(floatBytes(v));
    }
    return { __block: i, length: v.length };
  });
  const manifest = new TextEncoder().encode(
    JSON.stringify({ data: JSON.parse(text), lengths: buffers.map((b) => b.byteLength) }),
  );
  const header = new Uint8Array(12);
  header.set(new TextEncoder().encode('CHLDN04\0'));
  new DataView(header.buffer).setUint32(8, manifest.length, true);
  return new Blob([header, manifest, ...(buffers as Uint8Array<ArrayBuffer>[])], {
    type: 'application/octet-stream',
  });
}
export function unpackBinary(buffer: ArrayBuffer): unknown {
  const bytes = new Uint8Array(buffer);
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== 'CHLDN04\0')
    throw Error('지원하지 않는 실험 기록입니다.');
  const length = new DataView(buffer).getUint32(8, true);
  if (length > bytes.length - 12) throw Error('기록 헤더가 손상되었습니다.');
  const manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + length)));
  let offset = 12 + length;
  const blocks: Float32Array[] = manifest.lengths.map((n: number) => {
    if (!Number.isInteger(n) || n < 0 || offset + n > bytes.length)
      throw Error('기록 배열이 손상되었습니다.');
    const a = readFloats(bytes.subarray(offset, offset + n));
    offset += n;
    return a;
  });
  if (offset !== bytes.length) throw Error('기록 길이가 일치하지 않습니다.');
  function restore(v: unknown): unknown {
    if (!v || typeof v !== 'object') return v;
    if ('__block' in v) {
      const t = v as { __block: number; length: number },
        a = blocks[t.__block];
      if (!a || a.length !== t.length) throw Error('기록 블록이 손상되었습니다.');
      return a;
    }
    if (Array.isArray(v)) return v.map(restore);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, restore(x)]));
  }
  return restore(manifest.data);
}
