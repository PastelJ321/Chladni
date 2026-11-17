import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Config, Run, ParticleVisualProperties } from '../experiment/types';
import { initialParticles, framePair } from '../simulation/particles';
import { PARTICLE_PRESETS, materialId, DEFAULT_PARTICLE_VISUAL } from '../particles/presets';
import { PlateField, FIELD_GLSL } from './PlateField';
const attributes = `attribute vec2 iA;attribute vec2 iB;attribute float iDiameter;attribute float iSeed;attribute vec3 iColor;attribute float iHeight;attribute float iResolve;`;
const common = `
uniform vec4 uCut;uniform float uClipping;bool particleOutside(vec3 c){return uClipping>.5&&dot(vec4((modelMatrix*vec4(c,1.)).xyz,1.),uCut)<0.;}
uniform vec2 uPlate;uniform float uAlpha;uniform float uFocal;uniform float uPixelRatio;uniform float uMagnification;uniform float uMinimum;uniform float uObserve;uniform float uDetail;uniform float uKind;
vec2 particleUV(){return mix(iA,iB,uAlpha);}
vec3 particleCenter(){vec2 uv=particleUV();return vec3((uv.x-.5)*uPlate.x,plateLift(uv),(uv.y-.5)*uPlate.y);}
float particleDiameter(vec3 center){float z=max(.005,-(modelViewMatrix*vec4(center,1.0)).z);return max(iDiameter*12.0*uMagnification,uMinimum*z/uFocal)*uObserve+iDiameter*12.0*(1.0-uObserve);}
mat3 turn(float a){float c=cos(a),s=sin(a),x=.25*sin(iSeed*32.),z=.20*cos(iSeed*19.),cx=cos(x),sx=sin(x),cz=cos(z),sz=sin(z);return mat3(c,0.,s,0.,1.,0.,-s,0.,c)*mat3(1.,0.,0.,0.,cx,sx,0.,-sx,cx)*mat3(cz,sz,0.,-sz,cz,0.,0.,0.,1.);}
`;
interface Batch {
  points: T.Points;
  mesh: T.Mesh;
  shadow: T.Mesh;
  indices: Uint32Array;
  a: T.InstancedBufferAttribute;
  b: T.InstancedBufferAttribute;
  size: T.InstancedBufferAttribute;
  source: unknown;
  materials: T.Material[];
  meanDiameter: number;
  detail: T.IUniform<number>;
  resolve: T.InstancedBufferAttribute;
  detailAttributes: Record<string, T.InstancedBufferAttribute>;
}
/** Position endpoints are uploaded at recording boundaries. Interpolation/scale/LOD stay on GPU. */
export class ParticleRenderer {
  root = new T.Group();
  batches: Batch[] = [];
  source: unknown = null;
  signature = '';
  lastIndex = -2;
  lastA: unknown = null;
  lastB: unknown = null;
  stats = {
    displayCount: 0,
    physicalCount: 0,
    uploadedBytes: 0,
    detailUploadedBytes: 0,
    detailCount: 0,
    bufferBytes: 0,
    lod: 'splats',
  };
  uniforms = {
    uPlate: { value: new T.Vector2(3.6, 3.6) },
    uAlpha: { value: 0 },
    uFocal: { value: 1000 },
    uPixelRatio: { value: 1 },
    uMagnification: { value: 2.5 },
    uMinimum: { value: 1.8 },
    uObserve: { value: 1 },
    uDetail: { value: 1 },
    uKind: { value: 0 },
    uCut: { value: new T.Vector4() },
    uClipping: { value: 0 },
  };
  seeds: ReturnType<typeof initialParticles> | null = null;
  seedKey = '';
  visual = DEFAULT_PARTICLE_VISUAL;
  constructor(private field: PlateField) {}
  rebuild(c: Config, run: Run | null, visual: ParticleVisualProperties) {
    const seedKey = JSON.stringify(c.grains);
    if (!run && seedKey !== this.seedKey) {
      this.seeds = initialParticles(c);
      this.seedKey = seedKey;
    }
    const source = run ?? this.seeds!,
      physicalCount = source.diameters.length,
      displayCount = Math.min(100000, visual.count || physicalCount),
      signature = `${displayCount}:${materialId(c.grains, 0)}:${materialId(c.grains, 1)}:${visual.shadingMode}:${JSON.stringify(visual.overrides)}`;
    if (this.source === source && this.signature === signature) return;
    this.clear();
    this.source = source;
    this.signature = signature;
    this.lastIndex = -2;
    this.lastA = this.lastB = null;
    this.stats.displayCount = displayCount;
    this.stats.physicalCount = physicalCount;
    this.stats.bufferBytes = 0;
    for (const slot of [0, 1] as const) {
      const ids: number[] = [];
      for (let i = 0; i < displayCount; i++)
        if (
          source.species[
            displayCount < physicalCount
              ? Math.floor((i * physicalCount) / displayCount)
              : i % physicalCount
          ] === slot
        )
          ids.push(i);
      if (!ids.length) continue;
      const preset = PARTICLE_PRESETS[materialId(c.grains, slot)],
        n = ids.length,
        indices = Uint32Array.from(ids),
        a = new T.InstancedBufferAttribute(new Float32Array(n * 2), 2),
        b = new T.InstancedBufferAttribute(new Float32Array(n * 2), 2),
        diameter = new T.InstancedBufferAttribute(new Float32Array(n), 1),
        seed = new T.InstancedBufferAttribute(new Float32Array(n), 1),
        color = new T.InstancedBufferAttribute(new Float32Array(n * 3), 3),
        restHeight = new T.InstancedBufferAttribute(new Float32Array(n), 1),
        resolve = new T.InstancedBufferAttribute(new Uint8Array(n), 1);
      resolve.setUsage(T.DynamicDrawUsage);
      a.setUsage(T.DynamicDrawUsage);
      b.setUsage(T.DynamicDrawUsage);
      const appearance = visual.overrides?.[slot ? 'salt' : 'sand'];
      const tint = new T.Color(
        visual.shadingMode === 'species'
          ? slot
            ? '#a8d0db'
            : '#d1aa6d'
          : (appearance?.color ?? preset.color),
      );
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const id =
            displayCount < physicalCount
              ? Math.floor((indices[i] * physicalCount) / displayCount)
              : indices[i] % physicalCount,
          d = source.diameters[id];
        diameter.setX(i, d);
        seed.setX(i, Math.floor(((indices[i] * 0.61803398875) % 1) * 4096) / 4096);
        color.setXYZ(
          i,
          tint.r * (0.85 + (i % 17) / 80),
          tint.g * (0.85 + (i % 17) / 80),
          tint.b * (0.85 + (i % 17) / 80),
        );
        sum += d;
      }
      const detail = { value: 0 },
        uniforms = {
          ...this.field.uniforms,
          ...this.uniforms,
          uKind: { value: preset.kind },
          uDetail: detail,
        };
      const pg = new T.InstancedBufferGeometry();
      pg.instanceCount = n;
      pg.setAttribute('position', new T.BufferAttribute(new Float32Array(3), 3));
      const setAttributes = (g: T.BufferGeometry) => {
        g.setAttribute('iA', a);
        g.setAttribute('iB', b);
        g.setAttribute('iDiameter', diameter);
        g.setAttribute('iSeed', seed);
        g.setAttribute('iColor', color);
        g.setAttribute('iHeight', restHeight);
        g.setAttribute('iResolve', resolve);
      };
      setAttributes(pg);
      const pm = new T.ShaderMaterial({
        uniforms,
        depthTest: true,
        depthWrite: true,
        transparent: true,
        vertexShader:
          FIELD_GLSL +
          attributes +
          common +
          `
varying vec3 vColor;varying float vSeed;varying float vPixels;varying float vResolve;
void main(){vec3 c=particleCenter();float d=particleDiameter(c);c.y+=d*iHeight;vec4 mv=modelViewMatrix*vec4(c,1.);float px=d*uFocal/max(.005,-mv.z);vPixels=px;vResolve=iResolve;vColor=iColor;vSeed=iSeed;gl_PointSize=clamp(px*uPixelRatio,1.0,96.0);gl_Position=particleOutside(c)?vec4(2.,2.,2.,1.):projectionMatrix*mv;}
`,
        fragmentShader: `uniform float uPixelRatio;uniform float uDetail;uniform float uKind;varying vec3 vColor;varying float vSeed;varying float vPixels;varying float vResolve;
void main(){float detail=uDetail*vResolve*smoothstep(3.0,6.0,vPixels);if(vSeed<detail)discard;vec2 q=(gl_PointCoord-.5)*2.;float angle=vSeed*6.283;mat2 rot=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));q=rot*q;float radius=length(q);float edge=uKind>2.5&&uKind<3.5?radius:uKind>.5&&uKind<1.5?max(abs(q.x),abs(q.y)):.85*radius+.15*cos(atan(q.y,q.x)*5.0+vSeed*4.0);float coverage=1.-smoothstep(.86,1.,edge);if(coverage<.25)discard;vec3 normal=normalize(vec3(q.x*.7,-q.y*.7,sqrt(max(.05,1.-radius*radius))));float shade=.45+.55*max(0.,dot(normal,normalize(vec3(-.5,.65,1.))));vec3 color=vColor*shade+vec3(pow(max(0.,normal.z),12.)*.1);gl_FragColor=vec4(color,coverage*min(1.,pow(vPixels*uPixelRatio,2.)));
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,
      });
      const points = new T.Points(pg, pm);
      points.frustumCulled = false;
      this.root.add(points);
      const base = grainGeometry(preset.kind),
        ig = new T.InstancedBufferGeometry();
      T.BufferGeometry.prototype.copy.call(ig, base);
      ig.instanceCount = 0;
      const detailAttributes: Record<string, T.InstancedBufferAttribute> = {};
      for (const [name, attr] of Object.entries({
        iA: a,
        iB: b,
        iDiameter: diameter,
        iSeed: seed,
        iColor: color,
        iHeight: restHeight,
        iResolve: resolve,
      })) {
        const copy = new T.InstancedBufferAttribute(
          new Float32Array(4096 * attr.itemSize),
          attr.itemSize,
        );
        copy.setUsage(T.DynamicDrawUsage);
        detailAttributes[name] = copy;
        ig.setAttribute(name, copy);
      }
      const vertices = base.attributes.position,
        heights = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        const seedValue = seed.getX(i),
          x = 0.25 * Math.sin(seedValue * 32),
          z = 0.2 * Math.cos(seedValue * 19);
        const cached = heights.get(seedValue);
        if (cached !== undefined) {
          restHeight.setX(i, cached);
          continue;
        }
        let min = Infinity;
        for (let j = 0; j < vertices.count; j++) {
          const yy = Math.sin(z) * vertices.getX(j) + Math.cos(z) * vertices.getY(j) * 0.72;
          min = Math.min(min, Math.cos(x) * yy - Math.sin(x) * vertices.getZ(j));
        }
        const height = -min * 0.5;
        heights.set(seedValue, height);
        restHeight.setX(i, height);
      }
      base.dispose();
      const mm = new T.MeshPhysicalMaterial({
        color: '#ffffff',
        roughness: appearance?.roughness ?? preset.roughness,
        metalness: 0,
        clearcoat: preset.kind === 3 ? 0.45 : 0.05,
        clearcoatRoughness: 0.18,
      });
      mm.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader =
          FIELD_GLSL +
          attributes +
          common +
          '\nvarying vec3 vGrainColor;varying float vDetail;varying float vGrainSeed;\n' +
          shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>\nobjectNormal=turn(iSeed*6.283)*normalize(objectNormal*vec3(1.,1./.72,1.));`,
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `vec3 center=particleCenter();float d=particleDiameter(center);float px=d*uFocal/max(.005,-(modelViewMatrix*vec4(center,1.)).z);vDetail=uDetail*smoothstep(3.0,6.0,px);vGrainSeed=iSeed;vGrainColor=iColor;vec3 transformed=turn(iSeed*6.283)*(position*vec3(1.0,.72,1.0))*(d*.5)+center+vec3(0.,d*iHeight,0.);`,
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nif(particleOutside(center))gl_Position=vec4(2.,2.,2.,1.);',
        );
        shader.fragmentShader =
          'varying vec3 vGrainColor;varying float vDetail;varying float vGrainSeed;\n' +
          shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <clipping_planes_fragment>',
          '#include <clipping_planes_fragment>\nif(vGrainSeed>=vDetail)discard;',
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb*=vGrainColor;',
        );
      };
      mm.customProgramCacheKey = () => `grain-v4-${preset.kind}`;
      const mesh = new T.Mesh(ig, mm);
      mesh.frustumCulled = false;
      this.root.add(mesh);
      // Analytic contact attenuation only in the resolved-grain LOD, independent of particle physics.
      const sg = new T.InstancedBufferGeometry(),
        unitPlane = new T.PlaneGeometry(2, 2);
      T.BufferGeometry.prototype.copy.call(sg, unitPlane);
      unitPlane.dispose();
      sg.instanceCount = 0;
      for (const [name, a] of Object.entries(detailAttributes)) sg.setAttribute(name, a);
      const sm = new T.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        vertexShader:
          FIELD_GLSL +
          attributes +
          common +
          `varying vec2 vUv;void main(){vec3 c=particleCenter();float d=particleDiameter(c);vUv=uv*2.-1.;gl_Position=particleOutside(c)?vec4(2.,2.,2.,1.):projectionMatrix*modelViewMatrix*vec4(c+vec3(position.x*d*.55,.0003,position.y*d*.55),1.);}`,
        fragmentShader: `varying vec2 vUv;void main(){float a=.28*exp(-dot(vUv,vUv)*4.);if(a<.015)discard;gl_FragColor=vec4(.025,.025,.023,a);}`,
      });
      const shadow = new T.Mesh(sg, sm);
      shadow.frustumCulled = false;
      shadow.renderOrder = 1;
      this.root.add(shadow);
      this.batches.push({
        points,
        mesh,
        shadow,
        indices,
        a,
        b,
        size: diameter,
        source: null,
        materials: [pm, mm, sm],
        meanDiameter: sum / n,
        detail,
        resolve,
        detailAttributes,
      });
      this.stats.bufferBytes += n * (2 * 2 + 1 + 1 + 3 + 3) * 4 + indices.byteLength;
    }
  }
  update(
    c: Config,
    run: Run | null,
    time: number,
    visual: ParticleVisualProperties | undefined,
    camera: T.PerspectiveCamera,
    height: number,
    pixelRatio: number,
    low: boolean,
  ) {
    const v = visual ?? DEFAULT_PARTICLE_VISUAL;
    this.visual = v;
    this.rebuild(c, run, v);
    this.uniforms.uPlate.value.set(c.plate.width * 12, c.plate.height * 12);
    this.uniforms.uObserve.value = v.mode === 'observe' ? 1 : 0;
    this.uniforms.uMagnification.value = v.displayMagnification * v.apparentSize;
    this.uniforms.uMinimum.value = v.minimumPixelDiameter;
    this.uniforms.uFocal.value = height / (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2)));
    this.uniforms.uPixelRatio.value = pixelRatio;
    const pair = run ? framePair(run, time) : null,
      positions = this.seeds?.positions,
      aa = pair?.a.positions ?? positions!,
      bb = pair?.b.positions ?? aa,
      index = pair?.index ?? 0;
    this.uniforms.uAlpha.value = pair?.alpha ?? 0;
    if (this.lastA !== aa || this.lastB !== bb) {
      for (const batch of this.batches) {
        const sequential = this.lastIndex === index - 1 && this.lastB === aa;
        if (sequential) {
          const prev = batch.a;
          batch.a = batch.b;
          batch.b = prev;
          batch.points.geometry.setAttribute('iA', batch.a);
          batch.points.geometry.setAttribute('iB', batch.b);
        }
        for (let j = 0; j < batch.indices.length; j++) {
          const displayId = batch.indices[j],
            id =
              this.stats.displayCount < this.stats.physicalCount
                ? Math.floor((displayId * this.stats.physicalCount) / this.stats.displayCount)
                : displayId % this.stats.physicalCount,
            duplicate = Math.floor(displayId / this.stats.physicalCount),
            jitter = duplicate > 0 ? batch.size.getX(j) * 0.6 : 0,
            dx = (Math.sin(displayId * 2.39) * jitter) / c.plate.width,
            dy = (Math.cos(displayId * 1.71) * jitter) / c.plate.height;
          if (!sequential)
            batch.a.setXY(
              j,
              Math.max(0, Math.min(1, aa[id * 2] + dx)),
              Math.max(0, Math.min(1, aa[id * 2 + 1] + dy)),
            );
          batch.b.setXY(
            j,
            Math.max(0, Math.min(1, bb[id * 2] + dx)),
            Math.max(0, Math.min(1, bb[id * 2 + 1] + dy)),
          );
        }
        if (!sequential) batch.a.needsUpdate = true;
        batch.b.needsUpdate = true;
        this.stats.uploadedBytes +=
          batch.b.array.byteLength + (sequential ? 0 : batch.a.array.byteLength);
      }
      this.lastA = aa;
      this.lastB = bb;
      this.lastIndex = index;
    }
    let detail = false;
    const distance = Math.max(0.01, camera.position.distanceTo(this.root.position));
    for (const b of this.batches) {
      const px =
        (b.meanDiameter *
          12 *
          (v.mode === 'observe' ? v.displayMagnification : 1) *
          this.uniforms.uFocal.value) /
        distance;
      const enable = !low && v.LOD !== 'sprites' && px > 2.5;
      b.mesh.visible = enable;
      b.shadow.visible = enable;
      b.detail.value = enable ? 1 : 0;
      if (enable) this.resolveDetails(b, camera);
      detail ||= enable;
    }
    this.uniforms.uDetail.value = detail ? 1 : 0;
    this.stats.lod = detail ? 'splats + PBR' : 'splats';
  }
  /** Resolve only visible macro grains, with a bounded detail budget. Unresolved grains retain their splats. */
  resolveDetails(b: Batch, camera: T.PerspectiveCamera) {
    camera.updateMatrixWorld();
    const m = camera.matrixWorldInverse.elements,
      p = camera.projectionMatrix.elements,
      plate = this.uniforms.uPlate.value,
      alpha = this.uniforms.uAlpha.value,
      source = b.points.geometry.attributes;
    (b.resolve.array as Uint8Array).fill(0);
    let count = 0;
    for (let i = 0; i < b.indices.length && count < 4096; i++) {
      const x =
          (b.a.getX(i) + (b.b.getX(i) - b.a.getX(i)) * alpha - 0.5) * plate.x +
          this.root.position.x,
        z =
          (b.a.getY(i) + (b.b.getY(i) - b.a.getY(i)) * alpha - 0.5) * plate.y +
          this.root.position.z,
        y = this.root.position.y;
      const vx = m[0] * x + m[4] * y + m[8] * z + m[12],
        vy = m[1] * x + m[5] * y + m[9] * z + m[13],
        vz = m[2] * x + m[6] * y + m[10] * z + m[14];
      if (vz >= -0.005) continue;
      const px =
        Math.max(
          b.size.getX(i) * 12 * this.uniforms.uMagnification.value,
          (this.uniforms.uMinimum.value * -vz) / this.uniforms.uFocal.value,
        ) *
          this.uniforms.uObserve.value +
        b.size.getX(i) * 12 * (1 - this.uniforms.uObserve.value);
      if (
        (px * this.uniforms.uFocal.value) / -vz < 3 ||
        Math.abs((vx * p[0]) / -vz) > 1.16 ||
        Math.abs((vy * p[5]) / -vz) > 1.16
      )
        continue;
      b.resolve.setX(i, 1);
      for (const [name, dst] of Object.entries(b.detailAttributes)) {
        const src = source[name];
        for (let j = 0; j < dst.itemSize; j++)
          dst.array[count * dst.itemSize + j] =
            name === 'iResolve' ? 1 : src.array[i * src.itemSize + j];
      }
      count++;
    }
    b.resolve.needsUpdate = true;
    this.stats.detailUploadedBytes +=
      b.resolve.array.byteLength +
      count * Object.values(b.detailAttributes).reduce((n, a) => n + a.itemSize * 4, 0);
    this.stats.detailCount = count;
    for (const a of Object.values(b.detailAttributes)) {
      a.clearUpdateRanges();
      if (count) a.addUpdateRange(0, count * a.itemSize);
      a.needsUpdate = true;
    }
    (b.mesh.geometry as T.InstancedBufferGeometry).instanceCount = count;
    (b.shadow.geometry as T.InstancedBufferGeometry).instanceCount = count;
  }
  setClipping(plane: T.Plane | null) {
    this.uniforms.uClipping.value = plane ? 1 : 0;
    if (plane)
      this.uniforms.uCut.value.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  }
  clear() {
    for (const b of this.batches) {
      for (const o of [b.points, b.mesh, b.shadow]) {
        this.root.remove(o);
        o.geometry.dispose();
      }
      for (const m of b.materials) m.dispose();
    }
    this.batches = [];
  }
  dispose() {
    this.clear();
  }
}
function grainGeometry(kind: number): T.BufferGeometry {
  if (kind === 1) return new RoundedBoxGeometry(1.4, 1.35, 1.45, 2, 0.065);
  if (kind === 2) {
    const g = new T.OctahedronGeometry(1, 0);
    g.scale(0.8, 1.1, 0.7);
    return g;
  }
  if (kind === 3) return new T.SphereGeometry(1, 10, 7);
  const g = new T.IcosahedronGeometry(1, kind === 4 ? 1 : 0),
    p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i),
      s = 0.86 + 0.15 * Math.sin(x * 17 + y * 13 + z * 9);
    p.setXYZ(i, x * s, y * s, z * s);
  }
  g.computeVertexNormals();
  return g;
}
