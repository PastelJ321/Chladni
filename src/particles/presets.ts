import type {
  Grains,
  ParticleGroup,
  ParticleMaterialId,
  ParticlePhysicalProperties,
  ParticleVisualProperties,
} from '../experiment/types';
import { particleGroup } from '../experiment/config';
export const PARTICLE_PRESETS: Record<
  ParticleMaterialId,
  {
    label: string;
    density: number;
    diameter: number;
    spread: number;
    friction: number;
    shape: number;
    color: string;
    roughness: number;
    kind: number;
    source: string;
  }
> = {
  sand: {
    label: '규사',
    density: 2650,
    diameter: 302.5e-6,
    spread: 105 / 605,
    friction: 0.35,
    shape: 1.2,
    color: '#b79b6a',
    roughness: 0.92,
    kind: 0,
    source: '석영 대표 밀도 · 마찰/형태 비보정',
  },
  salt: {
    label: '소금',
    density: 2160,
    diameter: 427.5e-6,
    spread: 145 / 855,
    friction: 0.3,
    shape: 1,
    color: '#f0eadc',
    roughness: 0.52,
    kind: 1,
    source: 'NaCl 대표 밀도 · 마찰/형태 비보정',
  },
  sugar: {
    label: '설탕',
    density: 1590,
    diameter: 500e-6,
    spread: 0.2,
    friction: 0.4,
    shape: 1.15,
    color: '#e4d6b5',
    roughness: 0.44,
    kind: 2,
    source: '자당 대표 밀도 · 마찰/형태 비보정',
  },
  tea: {
    label: '녹차분말',
    density: 1000,
    diameter: 100e-6,
    spread: 0.5,
    friction: 0.5,
    shape: 1.8,
    color: '#657748',
    roughness: 0.96,
    kind: 5,
    source: '입경·입자 밀도 미제공 · 입력 전 계산 불가 · 벌크 밀도와 입자 밀도를 구분하세요',
  },
  glass: {
    label: '유리 비즈',
    density: 2500,
    diameter: 500e-6,
    spread: 0.1,
    friction: 0.2,
    shape: 1,
    color: '#9fb8c0',
    roughness: 0.2,
    kind: 3,
    source: '소다석회 유리 대표 밀도 · 마찰 비보정',
  },
  custom: {
    label: '사용자 정의',
    density: 2500,
    diameter: 350e-6,
    spread: 0.2,
    friction: 0.35,
    shape: 1,
    color: '#bfaaa0',
    roughness: 0.72,
    kind: 4,
    source: '사용자 지정 · 실측 여부 별도 확인',
  },
};
export function materialId(g: Grains, slot: 0 | 1): ParticleMaterialId {
  return particleGroup(g, slot).material ?? (slot ? 'salt' : 'sand');
}
export function applyParticlePreset(id: ParticleMaterialId): ParticleGroup {
  const p = PARTICLE_PRESETS[id];
  return {
    material: id,
    diameter: p.diameter,
    spread: p.spread,
    density: p.density,
    friction: p.friction,
    shape: p.shape,
    sieve: 'custom',
    ...(id === 'tea' ? { pending: ['diameter', 'density'] as ('diameter' | 'density')[] } : {}),
    evidence: { size: 'default', density: 'default', reference: p.source },
    restitution: 0.4,
  };
}
export function physicalProperties(
  g: Grains,
  slot: 0 | 1,
  diameterMeters: number,
): ParticlePhysicalProperties {
  const p = particleGroup(g, slot);
  return {
    diameterMeters,
    density: p.density,
    shape: p.shape,
    friction: p.friction,
    species: materialId(g, slot),
  };
}
export const DEFAULT_PARTICLE_VISUAL: ParticleVisualProperties = {
  mode: 'observe',
  apparentSize: 1,
  minimumPixelDiameter: 1.8,
  displayMagnification: 2.5,
  count: 0,
  LOD: 'auto',
  shadingMode: 'material',
};
/** E[d³] for a uniform diameter distribution; ratio is a number fraction, never mass fraction. */
export function expectedMass(g: Grains) {
  if (pendingParticles(g)) return NaN;
  const mean = (slot: 0 | 1) => {
    const p = particleGroup(g, slot);
    return ((p.density * Math.PI) / 6) * p.diameter ** 3 * (1 + p.spread ** 2);
  };
  const ratio = numberRatio(g);
  return g.kind === 'mixture'
    ? mean(0) * (1 - ratio) + mean(1) * ratio
    : mean(g.kind === 'salt' ? 1 : 0);
}
export function pendingParticles(g: Grains) {
  return (g.kind === 'salt' ? [1] : g.kind === 'sand' ? [0] : [0, 1]).some(
    (s) => particleGroup(g, s as 0 | 1).pending?.length,
  );
}
export function numberRatio(g: Grains) {
  if (g.ratioBasis !== 'mass') return g.ratio;
  const mass = (s: 0 | 1) => {
    const p = particleGroup(g, s);
    return p.density * p.diameter ** 3 * (1 + p.spread ** 2);
  };
  const a = mass(0),
    b = mass(1),
    den = g.ratio * a + (1 - g.ratio) * b;
  return den > 0 ? (g.ratio * a) / den : 0;
}
export function estimateCount(g: Grains, massKg: number) {
  return Math.round(massKg / expectedMass(g));
}
