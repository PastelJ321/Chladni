import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Config, Run, ParticleVisualProperties } from '../experiment/types';
import { initialParticles, framePair } from '../simulation/particles';
import { PARTICLE_PRESETS, materialId, DEFAULT_PARTICLE_VISUAL } from '../particles/presets';
import { PlateField, FIELD_GLSL } from './PlateField';

const attributes = `attribute vec3 iA;attribute vec3 iB;attribute float iDiameter;attribute float iSeed;attribute vec3 iColor;attribute float iHeight;attribute float iResolve;`;

const common = `
uniform vec4 uCut;uniform float uClipping;bool particleOutside(vec3 c){return uClipping>.5&&dot(vec4((modelMatrix*vec4(c,1.)).xyz,1.),uCut)<0.;}
uniform vec2 uPlate;uniform float uAlpha;uniform float uFocal;uniform float uPixelRatio;uniform float uMagnification;uniform float uMinimum;uniform float uObserve;uniform float uDetail;uniform float uKind;
vec2 particleUV(){return mix(iA.xy,iB.xy,uAlpha);}
float particleHop(){return max(0.,mix(iA.z,iB.z,uAlpha))*12.;}
vec3 particleCenter(){vec2 uv=particleUV();return vec3((uv.x-.5)*uPlate.x,plateLift(uv)+particleHop(),(uv.y-.5)*uPlate.y);}
float particleDiameter(vec3 center){float z=max(.005,-(modelViewMatrix*vec4(center,1.0)).z);return max(iDiameter*12.0*uMagnification,uMinimum*z/uFocal)*uObserve+iDiameter*12.0*(1.0-uObserve);}
vec3 seedHash(float s){return fract(sin(vec3(s*127.1+1.3,s*311.7+7.1,s*74.7+3.9))*43758.5453);}
vec3 grainScale(float s,float kind){
  vec3 h=seedHash(s);
  if(kind>0.5&&kind<1.5) return vec3(0.84+0.30*h.x, 0.70+0.26*h.y, 0.84+0.30*h.z);
  if(kind>1.5&&kind<2.5) return vec3(1.16+0.34*h.x, 0.56+0.22*h.y, 0.70+0.22*h.z);
  if(kind>2.5&&kind<3.5) return vec3(0.95+0.10*h.x);
  if(kind>4.5) return vec3(0.88+0.50*h.x, 0.34+0.22*h.y, 0.80+0.48*h.z);
  return vec3(0.82+0.36*h.x, 0.58+0.28*h.y, 0.78+0.36*h.z);
}
mat3 turn(float a){
  vec3 h=seedHash(iSeed);
  float tilt=uKind>2.5&&uKind<3.5?0.1:(uKind>0.5&&uKind<1.5?0.14:0.26);
  float c=cos(a),s=sin(a),x=tilt*(h.x*2.-1.),z=tilt*(h.y*2.-1.),cx=cos(x),sx=sin(x),cz=cos(z),sz=sin(z);
  return mat3(c,0.,s,0.,1.,0.,-s,0.,c)*mat3(1.,0.,0.,0.,cx,sx,0.,-sx,cx)*mat3(cz,sz,0.,-sz,cz,0.,0.,0.,1.);
}
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
  maxDetail: number;
}

const MAX_DETAIL_CAPACITY = 6144;

function fract(x: number) {
  return x - Math.floor(x);
}

function hash3(s: number): [number, number, number] {
  return [
    fract(Math.sin(s * 127.1 + 1.3) * 43758.5453),
    fract(Math.sin(s * 311.7 + 7.1) * 43758.5453),
    fract(Math.sin(s * 74.7 + 3.9) * 43758.5453),
  ];
}

function grainColorForSpecies(
  kind: number,
  base: T.Color,
  h0: number,
  h1: number,
  h2: number,
  isSpeciesMode: boolean,
): [number, number, number] {
  if (isSpeciesMode) {
    const shade = 0.88 + h0 * 0.22;
    return [base.r * shade, base.g * shade, base.b * shade];
  }
  if (kind === 0) {
    // Natural silica quartz sand: ochre-buff, pale quartz, warm amber, occasional smoky mineral grain
    const palette = [
      [1.06, 0.99, 0.88], // warm buff quartz
      [1.16, 1.12, 1.04], // translucent pale quartz
      [0.95, 0.82, 0.65], // warm amber iron-stained quartz
      [0.82, 0.8, 0.76], // smoky feldspar grain
      [0.72, 0.6, 0.46], // darker mineral fleck
    ];
    const pick = h0 < 0.36 ? 0 : h0 < 0.66 ? 1 : h0 < 0.86 ? 2 : h0 < 0.96 ? 3 : 4;
    const mult = palette[pick];
    const v = 0.92 + h1 * 0.16;
    return [
      Math.min(1, base.r * mult[0] * v),
      Math.min(1, base.g * mult[1] * v),
      Math.min(1, base.b * mult[2] * v),
    ];
  }
  if (kind === 1) {
    // Halite NaCl crystals: translucent crystalline off-white with subtle facet brilliance variation
    const v = 0.82 + h0 * 0.16;
    const cool = (h1 - 0.5) * 0.06;
    return [
      Math.min(1, base.r * v * (0.96 - cool)),
      Math.min(1, base.g * v * 0.98),
      Math.min(1, base.b * v * (1.02 + cool * 1.4)),
    ];
  }
  if (kind === 2) {
    // Sucrose crystals: warm vitreous translucent ivory
    const v = 0.89 + h0 * 0.15;
    return [
      Math.min(1, base.r * v * 1.02),
      Math.min(1, base.g * v),
      Math.min(1, base.b * v * (0.94 + h2 * 0.08)),
    ];
  }
  if (kind === 5) {
    // Matcha green tea powder: organic chlorophyll olive-jade variance
    const v = 0.8 + h0 * 0.34;
    const warm = 0.92 + h1 * 0.16;
    return [
      Math.min(1, base.r * v * warm),
      Math.min(1, base.g * v * (0.96 + h2 * 0.1)),
      Math.min(1, base.b * v * 0.9),
    ];
  }
  const v = 0.88 + h0 * 0.2;
  return [Math.min(1, base.r * v), Math.min(1, base.g * v), Math.min(1, base.b * v)];
}

/** Position endpoints are uploaded at recording boundaries. Interpolation/scale/LOD stay on GPU. */
export class ParticleRenderer {
  root = new T.Group();
  batches: Batch[] = [];
  microNormal = createGrainNormal();
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
    const seedKey = JSON.stringify([c.grains, c.plate.width, c.plate.height]);
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
        a = new T.InstancedBufferAttribute(new Float32Array(n * 3), 3),
        b = new T.InstancedBufferAttribute(new Float32Array(n * 3), 3),
        diameter = new T.InstancedBufferAttribute(new Float32Array(n), 1),
        seed = new T.InstancedBufferAttribute(new Float32Array(n), 1),
        color = new T.InstancedBufferAttribute(new Float32Array(n * 3), 3),
        restHeight = new T.InstancedBufferAttribute(new Float32Array(n), 1),
        resolve = new T.InstancedBufferAttribute(new Uint8Array(n), 1);

      resolve.setUsage(T.DynamicDrawUsage);
      a.setUsage(T.DynamicDrawUsage);
      b.setUsage(T.DynamicDrawUsage);

      const appearance = visual.overrides?.[slot ? 'salt' : 'sand'];
      const isSpecies = visual.shadingMode === 'species';
      const tint = new T.Color(
        isSpecies ? (slot ? '#7fd1e0' : '#d9a45b') : (appearance?.color ?? preset.color),
      );

      let sum = 0;
      for (let i = 0; i < n; i++) {
        const id =
            displayCount < physicalCount
              ? Math.floor((indices[i] * physicalCount) / displayCount)
              : indices[i] % physicalCount,
          d = source.diameters[id],
          sv = Math.floor(((indices[i] * 0.61803398875) % 1) * 4096) / 4096;
        diameter.setX(i, d);
        seed.setX(i, sv);
        const [h0, h1, h2] = hash3(sv);
        const [cr, cg, cb] = grainColorForSpecies(preset.kind, tint, h0, h1, h2, isSpecies);
        color.setXYZ(i, cr, cg, cb);
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
void main(){
  vec3 c=particleCenter();
  float d=particleDiameter(c);
  c.y+=d*iHeight;
  vec4 mv=modelViewMatrix*vec4(c,1.);
  float px=d*uFocal/max(.005,-mv.z);
  vPixels=px;
  vResolve=iResolve;
  vColor=iColor;
  vSeed=iSeed;
  gl_PointSize=clamp(px*uPixelRatio,1.15,96.0);
  gl_Position=particleOutside(c)?vec4(2.,2.,2.,1.):projectionMatrix*mv;
}`,
        fragmentShader: `
uniform float uPixelRatio;uniform float uDetail;uniform float uKind;
varying vec3 vColor;varying float vSeed;varying float vPixels;varying float vResolve;
void main(){
  float detail=uDetail*vResolve*smoothstep(2.8,5.6,vPixels);
  if(vSeed<detail)discard;
  vec2 q=(gl_PointCoord-.5)*2.;
  float angle=vSeed*6.283185;
  mat2 rot=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));
  vec2 rq=rot*q;
  float h1=fract(sin(vSeed*127.1)*43758.5453);
  float h2=fract(sin(vSeed*311.7)*43758.5453);
  float edge;
  if(uKind>2.5&&uKind<3.5){
    // Optical glass bead
    edge=length(q);
  } else if(uKind>0.5&&uKind<1.5){
    // Cleaved cubic/orthorhombic halite crystal
    vec2 boxScale=vec2(0.88+0.24*h1,0.86+0.24*h2);
    vec2 bq=abs(rq)/boxScale;
    edge=max(bq.x,bq.y)*0.88+length(bq)*0.14;
  } else if(uKind>1.5&&uKind<2.5){
    // Oblique monoclinic sucrose crystal
    vec2 sq=vec2(rq.x+rq.y*0.24,rq.y)/vec2(1.08,0.72);
    edge=max(abs(sq.x),abs(sq.y))*0.9+length(sq)*0.12;
  } else if(uKind>4.5){
    // Irregular matte matcha powder cluster
    float ang=atan(rq.y,rq.x);
    edge=length(rq)*(0.86+0.18*cos(ang*3.0+vSeed*11.0)+0.10*sin(ang*5.0-vSeed*7.0));
  } else {
    // Sub-angular fractured silica quartz sand grain
    float ang=atan(rq.y,rq.x);
    vec2 sq=rq/vec2(0.90+0.22*h1,0.82+0.22*h2);
    edge=length(sq)*(0.88+0.12*cos(ang*4.0+vSeed*9.0)+0.07*sin(ang*3.0+vSeed*17.0));
  }
  float aa=max(0.06,1.2/max(1.5,vPixels*uPixelRatio));
  float coverage=1.-smoothstep(0.92-aa,1.0,edge);
  if(coverage<0.18)discard;

  float r2=min(0.96,dot(q,q));
  vec3 normal=normalize(vec3(q.x*0.78,-q.y*0.78,sqrt(max(0.04,1.-r2))));
  vec3 keyDir=normalize(vec3(-0.48,0.72,0.85));
  vec3 fillDir=normalize(vec3(0.65,0.25,0.45));
  float ndl=max(0.0,dot(normal,keyDir));
  float fill=max(0.0,dot(normal,fillDir));
  float rim=pow(1.0-max(0.0,normal.z),2.2);
  // Subtle contact ambient occlusion near the bottom rim of each grain
  float contactAO=mix(0.76,1.0,smoothstep(-0.95,0.35,-q.y));
  vec3 lit=vColor*(0.34+0.64*ndl+0.22*fill)*contactAO;

  // Material-specific crystalline / vitreous specular glints
  vec3 halfVec=normalize(keyDir+vec3(0.0,0.0,1.0));
  float specPow=uKind>2.5&&uKind<3.5?36.0:(uKind>0.5&&uKind<2.5?22.0:12.0);
  float specAmp=uKind>4.5?0.02:(uKind>2.5&&uKind<3.5?0.42:(uKind>0.5&&uKind<2.5?0.34:0.14));
  float spec=pow(max(0.0,dot(normal,halfVec)),specPow)*specAmp;
  vec3 color=lit+vec3(0.95,0.98,1.0)*spec+vColor*rim*0.14;
  gl_FragColor=vec4(color,coverage*min(1.0,pow(vPixels*uPixelRatio,1.7)));
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
          new Float32Array(MAX_DETAIL_CAPACITY * attr.itemSize),
          attr.itemSize,
        );
        copy.setUsage(T.DynamicDrawUsage);
        detailAttributes[name] = copy;
        ig.setAttribute(name, copy);
      }

      // Compute accurate seated rest height per grain using the same scale + tilt as the vertex shader
      const vertices = base.attributes.position,
        heights = new Map<number, number>();
      const tiltMag = preset.kind === 3 ? 0.1 : preset.kind === 1 ? 0.14 : 0.26;
      for (let i = 0; i < n; i++) {
        const sv = seed.getX(i);
        const cached = heights.get(sv);
        if (cached !== undefined) {
          restHeight.setX(i, cached);
          continue;
        }
        const [h0, h1, h2] = hash3(sv);
        const sx =
          preset.kind === 1
            ? 0.84 + 0.3 * h0
            : preset.kind === 2
              ? 1.16 + 0.34 * h0
              : preset.kind === 3
                ? 0.95 + 0.1 * h0
                : preset.kind === 5
                  ? 0.88 + 0.5 * h0
                  : 0.82 + 0.36 * h0;
        const sy =
          preset.kind === 1
            ? 0.7 + 0.26 * h1
            : preset.kind === 2
              ? 0.56 + 0.22 * h1
              : preset.kind === 3
                ? 0.95 + 0.1 * h0
                : preset.kind === 5
                  ? 0.34 + 0.22 * h1
                  : 0.58 + 0.28 * h1;
        const sz =
          preset.kind === 1
            ? 0.84 + 0.3 * h2
            : preset.kind === 2
              ? 0.7 + 0.22 * h2
              : preset.kind === 3
                ? 0.95 + 0.1 * h0
                : preset.kind === 5
                  ? 0.8 + 0.48 * h2
                  : 0.78 + 0.36 * h2;
        const xRot = tiltMag * (h0 * 2 - 1),
          zRot = tiltMag * (h1 * 2 - 1);
        let minY = Infinity;
        for (let j = 0; j < vertices.count; j++) {
          const vx = vertices.getX(j) * sx,
            vy = vertices.getY(j) * sy,
            vz = vertices.getZ(j) * sz;
          const yy = Math.sin(zRot) * vx + Math.cos(zRot) * vy;
          minY = Math.min(minY, Math.cos(xRot) * yy - Math.sin(xRot) * vz);
        }
        const height = Math.max(0.05, -minY * 0.5);
        heights.set(sv, height);
        restHeight.setX(i, height);
      }
      base.dispose();

      // Physically grounded PBR material per mineral species
      const isSalt = preset.kind === 1,
        isSugar = preset.kind === 2,
        isGlass = preset.kind === 3,
        isTea = preset.kind === 5;
      const defaultRoughness = isSalt ? 0.2 : isSugar ? 0.16 : isGlass ? 0.08 : isTea ? 0.95 : 0.56;
      const mm = new T.MeshPhysicalMaterial({
        color: '#ffffff',
        roughness: appearance?.roughness ?? defaultRoughness,
        metalness: 0,
        clearcoat: isGlass ? 1.0 : isSugar ? 0.88 : isSalt ? 0.82 : isTea ? 0.0 : 0.18,
        clearcoatRoughness: isGlass ? 0.06 : isSugar ? 0.1 : isSalt ? 0.12 : 0.42,
        sheen: isSalt || isSugar ? 0.28 : isTea ? 0.18 : 0.08,
        sheenRoughness: isTea ? 0.9 : 0.35,
        sheenColor: new T.Color(isSalt ? '#d8edf6' : isSugar ? '#f2e6cf' : '#d2c9b4'),
        normalMap: this.microNormal,
        normalScale: new T.Vector2(
          isTea ? 0.34 : isSalt ? 0.08 : isGlass ? 0.02 : 0.24,
          isTea ? 0.34 : isSalt ? 0.08 : isGlass ? 0.02 : 0.24,
        ),
        envMapIntensity: isGlass ? 1.5 : isSalt || isSugar ? 1.15 : isTea ? 0.45 : 0.95,
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
          `#include <beginnormal_vertex>
vec3 gScaleN=grainScale(iSeed,uKind);
objectNormal=turn(iSeed*6.283185)*normalize(objectNormal/gScaleN);`,
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `vec3 center=particleCenter();
float d=particleDiameter(center);
float px=d*uFocal/max(.005,-(modelViewMatrix*vec4(center,1.)).z);
vDetail=uDetail*smoothstep(2.8,5.6,px);
vGrainSeed=iSeed;
vGrainColor=iColor;
vec3 gScale=grainScale(iSeed,uKind);
vec3 localPos=position*gScale;
// Subtle per-instance organic micro-variation on quartz sand and tea powder so no two grains match
if(uKind<0.5||uKind>4.5){
  float morph=1.0+0.11*sin(position.x*4.7+iSeed*37.0)*cos(position.z*4.3-iSeed*29.0);
  localPos*=morph;
}
vec3 transformed=turn(iSeed*6.283185)*localPos*(d*.5)+center+vec3(0.,d*iHeight,0.);`,
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
      mm.customProgramCacheKey = () => `grain-v5-${preset.kind}`;

      const mesh = new T.Mesh(ig, mm);
      mesh.frustumCulled = false;
      this.root.add(mesh);

      // Analytic height-attenuated directional contact shadow for macro PBR grains
      const sg = new T.InstancedBufferGeometry(),
        unitPlane = new T.PlaneGeometry(2, 2);
      T.BufferGeometry.prototype.copy.call(sg, unitPlane);
      unitPlane.dispose();
      sg.instanceCount = 0;
      for (const [name, attr] of Object.entries(detailAttributes)) sg.setAttribute(name, attr);

      const sm = new T.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        vertexShader:
          FIELD_GLSL +
          attributes +
          common +
          `varying vec2 vUv;varying float vHopFade;
void main(){
  vec3 c=particleCenter();
  float d=particleDiameter(c);
  float hop=particleHop();
  vHopFade=exp(-hop*32.0);
  vUv=uv*2.-1.;
  // Subtle offset opposite the key light (-3.8, 7.8, 4.2) so every grain casts a directional grounding shadow
  vec3 basePos=vec3(c.x+d*0.14,plateLift(particleUV())+0.0004,c.z-d*0.12);
  vec3 spread=vec3(position.x*d*0.66,0.0,position.y*d*0.66);
  gl_Position=particleOutside(c)?vec4(2.,2.,2.,1.):projectionMatrix*modelViewMatrix*vec4(basePos+spread,1.);
}`,
        fragmentShader: `varying vec2 vUv;varying float vHopFade;
void main(){
  float r2=dot(vUv,vUv);
  float a=0.38*vHopFade*exp(-r2*3.6);
  if(a<0.012)discard;
  gl_FragColor=vec4(0.012,0.022,0.032,a);
}`,
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
        maxDetail: 4096,
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
    high = false,
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
            batch.a.setXYZ(
              j,
              Math.max(0, Math.min(1, aa[id * 2] + dx)),
              Math.max(0, Math.min(1, aa[id * 2 + 1] + dy)),
              pair?.a.heights?.[id] ?? 0,
            );
          batch.b.setXYZ(
            j,
            Math.max(0, Math.min(1, bb[id * 2] + dx)),
            Math.max(0, Math.min(1, bb[id * 2 + 1] + dy)),
            pair?.b.heights?.[id] ?? 0,
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
    const detailBudget = high ? MAX_DETAIL_CAPACITY : 4096;
    for (const b of this.batches) {
      b.maxDetail = detailBudget;
      const px =
        (b.meanDiameter *
          12 *
          (v.mode === 'observe' ? v.displayMagnification : 1) *
          this.uniforms.uFocal.value) /
        distance;
      const enable = !low && v.LOD !== 'sprites' && px > 2.4;
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
    for (let i = 0; i < b.indices.length && count < b.maxDetail; i++) {
      const x =
          (b.a.getX(i) + (b.b.getX(i) - b.a.getX(i)) * alpha - 0.5) * plate.x +
          this.root.position.x,
        z =
          (b.a.getY(i) + (b.b.getY(i) - b.a.getY(i)) * alpha - 0.5) * plate.y +
          this.root.position.z,
        y = this.root.position.y + (b.a.getZ(i) + (b.b.getZ(i) - b.a.getZ(i)) * alpha) * 12;
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
        (px * this.uniforms.uFocal.value) / -vz < 2.8 ||
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
    this.microNormal.dispose();
    this.clear();
  }
}

function grainGeometry(kind: number): T.BufferGeometry {
  if (kind === 1) {
    // Halite (NaCl) cubic crystal: crisp beveled cleavage faces, NOT puffy marshmallows
    const g = new RoundedBoxGeometry(1.18, 1.06, 1.14, 1, 0.055);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i);
      // Slight hopper-crystal face indentation on the flat centers
      const edge = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
      const indent = edge > 0.45 ? 1 - 0.03 * (1 - Math.min(1, Math.hypot(x, z) * 0.85)) : 1;
      p.setXYZ(i, x * indent, y * indent, z * indent);
    }
    g.computeVertexNormals();
    return g;
  }
  if (kind === 2) {
    // Sucrose monoclinic crystal: oblique sheared hexagonal/rhombic prism
    const g = new RoundedBoxGeometry(1.36, 0.92, 0.94, 1, 0.06);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i);
      // Characteristic ~103 deg monoclinic shear + slight tapered crystal termination
      const taper = 1 - Math.abs(x) * 0.12;
      p.setXYZ(i, x + y * 0.24, y * taper, z * taper);
    }
    g.computeVertexNormals();
    return g;
  }
  if (kind === 5) {
    // Matcha green tea powder: irregular flattened multi-lobed organic powder flake/agglomerate
    const g = new T.IcosahedronGeometry(1, 1),
      p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i);
      const lobe =
        0.74 +
        0.22 * Math.sin(x * 5.2 + z * 3.8) +
        0.16 * Math.cos(z * 6.4 - x * 2.9) +
        0.12 * Math.sin((x + y + z) * 8.1);
      p.setXYZ(i, x * lobe * 1.15, y * lobe * 0.42, z * lobe * 0.92);
    }
    g.computeVertexNormals();
    return g;
  }
  if (kind === 3) {
    // Optical soda-lime glass microsphere
    return new T.SphereGeometry(1, 14, 10);
  }
  // Silica quartz sand (kind === 0) & custom (kind === 4): sub-angular faceted mineral grain
  const g = new T.IcosahedronGeometry(1, 1),
    p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    // Natural conchoidal fracture ridges + eroded sub-angular planes
    const facet =
      0.86 +
      0.14 * Math.sin(x * 4.9 + y * 3.7 - z * 2.8) +
      0.09 * Math.cos(x * 8.3 - z * 7.1) +
      0.06 * Math.sin(y * 11.2 + x * 5.4);
    // Slightly flatter resting base so quartz grains settle naturally on the aluminum plate
    const baseFlat = y < -0.25 ? 0.86 : 1.0;
    p.setXYZ(i, x * facet, y * facet * baseFlat, z * facet);
  }
  g.computeVertexNormals();
  return g;
}

function createGrainNormal() {
  const size = 64,
    a = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const n = Math.sin(i * 12.9898 + 7) * 43758.5453,
      m = Math.sin(i * 5.39 + 19) * 19341.21;
    a.set(
      [
        128 + Math.floor((n - Math.floor(n) - 0.5) * 48),
        128 + Math.floor((m - Math.floor(m) - 0.5) * 48),
        252,
        255,
      ],
      i * 4,
    );
  }
  const t = new T.DataTexture(a, size, size, T.RGBAFormat);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.repeat.set(4, 4);
  t.magFilter = T.LinearFilter;
  t.minFilter = T.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = T.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
