import * as T from 'three';
import type { Field, Layer } from '../experiment/types';
import { densityGrid } from '../analysis/metrics';

/** Shared physical field texture: plate + particle shaders sample the same complex displacement. */
export class PlateField {
  array = new Float32Array(41 * 41 * 4);
  texture = new T.DataTexture(this.array, 41, 41, T.RGBAFormat, T.FloatType);
  densityData = new Float32Array(16 * 16);
  densityTexture = new T.DataTexture(this.densityData, 16, 16, T.RedFormat, T.FloatType);
  uniforms = {
    uField: { value: this.texture },
    uDensity: { value: this.densityTexture },
    uFieldSize: { value: 41 },
    uPhase: { value: 0 },
    uGain: { value: 200 },
    uPeak: { value: 1 },
    uLayer: { value: 0 },
    uHasField: { value: 0 },
    uThickness: { value: 1 },
    uPlateSize: { value: new T.Vector2(3.6, 3.6) },
  };
  field: Field | null = null;
  densitySource: unknown = null;
  densityCache = new WeakMap<object, Float32Array>();
  uploads = 0;

  constructor() {
    for (const t of [this.texture, this.densityTexture]) {
      t.minFilter = T.NearestFilter;
      t.magFilter = T.NearestFilter;
      t.colorSpace = T.NoColorSpace;
      t.needsUpdate = true;
    }
  }

  update(f: Field | null, phase: number, gain: number, layer: Layer) {
    if (f !== this.field) {
      if (f && f.size !== this.texture.image.width) {
        this.texture.dispose();
        this.array = new Float32Array(f.size * f.size * 4);
        this.texture = new T.DataTexture(this.array, f.size, f.size, T.RGBAFormat, T.FloatType);
        this.texture.minFilter = this.texture.magFilter = T.NearestFilter;
        this.uniforms.uField.value = this.texture;
      }
      if (f)
        for (let i = 0; i < f.real.length; i++) {
          this.array[i * 4] = f.real[i];
          this.array[i * 4 + 1] = f.imag[i];
          this.array[i * 4 + 2] = f.amplitude[i];
        }
      else this.array.fill(0);
      this.texture.needsUpdate = true;
      this.field = f;
      this.uploads++;
    }
    this.uniforms.uFieldSize.value = f?.size ?? 41;
    this.uniforms.uPhase.value = phase;
    this.uniforms.uGain.value = gain;
    this.uniforms.uPeak.value = Math.max(1e-20, f?.peak ?? 1);
    this.uniforms.uHasField.value = f ? 1 : 0;
    this.uniforms.uLayer.value =
      layer === 'amplitude' || layer === 'velocity' || layer === 'acceleration'
        ? 1
        : layer === 'displacement'
          ? 2
          : layer === 'density'
            ? 3
            : 0;
  }

  updateDensity(positions: ArrayLike<number>, source: unknown) {
    if (source === this.densitySource) return;
    let density = this.densityCache.get(source as object);
    if (!density) {
      const bins = densityGrid(positions),
        max = Math.max(1, ...bins);
      density = Float32Array.from(bins, (x) => x / max);
      this.densityCache.set(source as object, density);
    }
    this.densityData.set(density);
    this.densityTexture.needsUpdate = true;
    this.densitySource = source;
  }

  attach(material: T.Material, depth = false) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = FIELD_GLSL + '\nvarying vec2 vPlateUV;\n' + shader.vertexShader;
      if (!depth)
        shader.vertexShader = shader.vertexShader.replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>\nvec2 puv=position.xz/3.6+0.5;\nfloat h=1.0/uFieldSize;\nvec3 gx=vec3(0.0,plateLift(puv+vec2(h,0.0))-plateLift(puv-vec2(h,0.0)),0.0);\nif(abs(normal.y)>0.9)objectNormal=normalize(vec3(-gx.y/(7.2*h),normal.y,-(plateLift(puv+vec2(0.0,h))-plateLift(puv-vec2(0.0,h)))/(7.2*h)));`,
        );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvPlateUV=position.xz/3.6+0.5;transformed.y=position.y*uThickness+plateLift(vPlateUV);`,
      );
      if (!depth) {
        shader.fragmentShader =
          FIELD_GLSL +
          `
varying vec2 vPlateUV;
float densitySample(vec2 uv){
  vec2 p=clamp(uv,0.0,1.0)*15.0;
  vec2 a=floor(p),t=fract(p);
  float h=1.0/16.0;
  vec2 q=(a+0.5)*h;
  float c00=texture2D(uDensity,q).r;
  float c10=texture2D(uDensity,q+vec2(h,0.0)).r;
  float c01=texture2D(uDensity,q+vec2(0.0,h)).r;
  float c11=texture2D(uDensity,q+vec2(h,h)).r;
  return mix(mix(c00,c10,t.x),mix(c01,c11,t.x),t.y);
}
vec3 amplitudeRamp(float v){
  float t=clamp(v,0.0,1.0);
  vec3 c0=vec3(0.025,0.085,0.145);
  vec3 c1=vec3(0.055,0.255,0.345);
  vec3 c2=vec3(0.165,0.565,0.645);
  vec3 c3=vec3(0.765,0.525,0.225);
  vec3 c4=vec3(0.955,0.855,0.635);
  if(t<0.28) return mix(c0,c1,t/0.28);
  if(t<0.58) return mix(c1,c2,(t-0.28)/0.30);
  if(t<0.84) return mix(c2,c3,(t-0.58)/0.26);
  return mix(c3,c4,(t-0.84)/0.16);
}
vec3 divergingRamp(float s){
  float t=clamp(s,-1.0,1.0);
  vec3 neg=vec3(0.155,0.545,0.695);
  vec3 mid=vec3(0.082,0.148,0.205);
  vec3 pos=vec3(0.815,0.545,0.235);
  vec3 col=t<0.0?mix(mid,neg,-t):mix(mid,pos,t);
  float nodeBand=1.0-smoothstep(0.0,0.032,abs(t));
  return mix(col,vec3(0.68,0.81,0.86),nodeBand*0.35);
}
vec3 densityRamp(float v){
  float t=pow(clamp(v,0.0,1.0),0.88);
  vec3 c0=vec3(0.022,0.082,0.135);
  vec3 c1=vec3(0.065,0.255,0.345);
  vec3 c2=vec3(0.22,0.565,0.635);
  vec3 c3=vec3(0.86,0.66,0.34);
  if(t<0.36) return mix(c0,c1,t/0.36);
  if(t<0.74) return mix(c1,c2,(t-0.36)/0.38);
  return mix(c2,c3,(t-0.74)/0.26);
}
` +
          shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
if(uLayer>0.5){
  vec4 f=fieldSample(vPlateUV);
  if(uLayer<1.5) diffuseColor.rgb=amplitudeRamp(f.z/uPeak);
  else if(uLayer<2.5) diffuseColor.rgb=divergingRamp((f.x*cos(uPhase)-f.y*sin(uPhase))/uPeak);
  else diffuseColor.rgb=densityRamp(densitySample(vPlateUV));
}`,
        );
      }
    };
    material.customProgramCacheKey = () => (depth ? 'plate-field-depth-v5' : 'plate-field-v5');
    material.needsUpdate = true;
  }

  attachOverlay(material: T.LineBasicMaterial) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = FIELD_GLSL + '\nuniform vec2 uPlateSize;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed.y+=plateLift(position.xz/uPlateSize+0.5);',
      );
    };
    material.customProgramCacheKey = () => 'field-overlay-v5';
  }

  dispose() {
    this.texture.dispose();
    this.densityTexture.dispose();
  }
}

// Manual bilinear interpolation works on WebGL2 even without float-linear filtering support.
export const FIELD_GLSL = `
uniform sampler2D uField;uniform sampler2D uDensity;uniform float uFieldSize;uniform float uPhase;uniform float uGain;uniform float uPeak;uniform float uLayer;uniform float uHasField;uniform float uThickness;
vec4 fieldSample(vec2 uv){vec2 p=clamp(uv,0.0,1.0)*(uFieldSize-1.0);vec2 a=floor(p),t=fract(p);vec2 h=vec2(1.0/uFieldSize);vec2 q=(a+0.5)*h;return mix(mix(texture2D(uField,q),texture2D(uField,q+vec2(h.x,0.0)),t.x),mix(texture2D(uField,q+vec2(0.0,h.y)),texture2D(uField,q+h),t.x),t.y);}
float plateLift(vec2 uv){if(uHasField<.5||uGain==0.)return 0.;vec4 f=fieldSample(uv);return (f.x*cos(uPhase)-f.y*sin(uPhase))*uGain*12.0*uHasField;}
`;
