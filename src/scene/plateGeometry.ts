import * as T from 'three';
/** Dense annular surface on a square outline, plus bevel and through-hole walls.
 * RoundedBoxGeometry only tessellates its corner fillets; its two giant face triangles cannot show modes.
 * This is rendering topology, independent of the BFS calculation mesh and its unperforated plate assumption.
 */
export function createPlateGeometry(width = 3.6, depth = 3.6, thickness = 0.024, hole = 0.046) {
  const slices = 192,
    rings = 48,
    bevel = 0.005,
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const outline = (theta: number, inset: number) =>
    Math.min(
      (width / 2 - inset) / Math.max(1e-12, Math.abs(Math.cos(theta))),
      (depth / 2 - inset) / Math.max(1e-12, Math.abs(Math.sin(theta))),
    );
  const ring = (radius: (angle: number) => number, y: number) => {
    const start = positions.length / 3;
    for (let i = 0; i < slices; i++) {
      const a = (i / slices) * Math.PI * 2,
        r = radius(a),
        x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      positions.push(x, y, z);
      uv.push(x / width + 0.5, z / depth + 0.5);
    }
    return start;
  };
  const join = (a: number, b: number, reverse = false) => {
    for (let i = 0; i < slices; i++) {
      const j = (i + 1) % slices;
      const quad = [a + i, a + j, b + i, a + j, b + j, b + i];
      if (reverse) for (let k = 0; k < 6; k += 3) indices.push(quad[k], quad[k + 2], quad[k + 1]);
      else indices.push(...quad);
    }
  };
  const faces: number[][] = [];
  for (const sign of [1, -1]) {
    const face: number[] = [];
    for (let j = hole > 0 ? 0 : 1; j <= rings; j++)
      face.push(
        ring((a) => hole + ((outline(a, bevel) - hole) * j) / rings, (sign * thickness) / 2),
      );
    if (hole === 0) {
      const centre = positions.length / 3;
      positions.push(0, (sign * thickness) / 2, 0);
      uv.push(0.5, 0.5);
      for (let i = 0; i < slices; i++) {
        const a = face[0] + i,
          b = face[0] + ((i + 1) % slices);
        indices.push(...(sign > 0 ? [centre, b, a] : [centre, a, b]));
      }
    }
    for (let j = 1; j < face.length; j++) join(face[j - 1], face[j], sign < 0);
    let last = face.at(-1)!;
    for (let j = 1; j <= 4; j++) {
      const a = ((j / 4) * Math.PI) / 2,
        next = ring(
          (t) => outline(t, bevel) + (outline(t, 0) - outline(t, bevel)) * Math.sin(a),
          sign * (thickness / 2 - bevel + bevel * Math.cos(a)),
        );
      join(last, next, sign < 0);
      last = next;
    }
    face.push(last);
    faces.push(face);
  }
  join(faces[0].at(-1)!, faces[1].at(-1)!);
  if (hole > 0) join(faces[0][0], faces[1][0], true);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
