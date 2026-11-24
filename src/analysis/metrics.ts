import type { Config, Field, RecordEntry, Run } from '../experiment/types';
import { fieldAtRun, frameAt } from '../simulation/particles';
import { sampleGrid } from '../solver/response';

export type Region = [number, number, number, number];
export interface AnalysisOptions {
  nodeThreshold: number;
  antinodeThreshold: number;
  roi: Region;
  targetSpecies: 0 | 1;
  basis: 'count' | 'mass';
  bins: number;
}
export const DEFAULT_ANALYSIS: AnalysisOptions = {
  nodeThreshold: 0.15,
  antinodeThreshold: 0.8,
  roi: [0.25, 0.25, 0.75, 0.75],
  targetSpecies: 0,
  basis: 'count',
  bins: 16,
};
export function validRegion(r: Region): boolean {
  return (
    r.length === 4 &&
    r.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) &&
    r[0] < r[2] &&
    r[1] < r[3]
  );
}
export function inRegion(x: number, y: number, r: Region) {
  return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
}
function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}
export function totalVariation(a: ArrayLike<number>, b: ArrayLike<number>): number | null {
  if (a.length !== b.length) throw Error('밀도 격자의 크기가 다릅니다.');
  let sumA = 0,
    sumB = 0;
  for (let i = 0; i < a.length; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  if (!sumA || !sumB) return null;
  let distance = 0;
  for (let i = 0; i < a.length; i++) distance += Math.abs(a[i] / sumA - b[i] / sumB);
  return distance / 2;
}
/** Historical API retained for older exports/tests. New UI uses researchMetrics. */
export function metrics(run: Run, time: number) {
  const frame = frameAt(run, time),
    groups = [0, 1].map((species) => {
      let count = 0,
        distance = 0,
        left = 0;
      run.species.forEach((s, i) => {
        if (s === species) {
          count++;
          distance += frame.distance[i];
          if (frame.positions[i * 2] < 0.5) left++;
        }
      });
      return {
        species,
        count,
        meanDistance: count ? distance / count : 0,
        leftFraction: count ? left / count : 0,
      };
    });
  return {
    groups,
    total: run.species.length,
    lost: run.lost,
    region: 'x < Lx/2 (좌측 절반)',
    time: frame.time,
  };
}
export function densityGrid(positions: ArrayLike<number>, size = 16) {
  const bins = new Array<number>(size * size).fill(0);
  for (let i = 0; i < positions.length; i += 2)
    bins[
      Math.max(0, Math.min(size - 1, Math.floor(positions[i + 1] * size))) * size +
        Math.max(0, Math.min(size - 1, Math.floor(positions[i] * size)))
    ]++;
  return bins;
}
/** All denominators use integrated input particles, never representative visual grains. */
export function researchMetrics(
  run: Run,
  time: number,
  field: Field | null = fieldAtRun(run, time),
  options: Partial<AnalysisOptions> = {},
) {
  const o = { ...DEFAULT_ANALYSIS, ...options };
  if (
    !validRegion(o.roi) ||
    !(o.nodeThreshold >= 0 && o.nodeThreshold < o.antinodeThreshold && o.antinodeThreshold <= 1) ||
    !Number.isInteger(o.bins) ||
    o.bins < 2 ||
    o.bins > 64
  )
    throw Error('분석 영역 또는 진폭 기준을 확인하세요.');
  const frame = frameAt(run, time),
    initial = run.frames[0],
    bandAvailable = !!field && Number.isFinite(field.peak) && field.peak > 1e-20,
    groups = [0, 1].map((species) => {
      let count = 0,
        mass = 0,
        distance = 0,
        weightedDistance = 0,
        nodeCount = 0,
        antinodeCount = 0,
        nodeMass = 0,
        antinodeMass = 0,
        initialNodeCount = 0,
        initialNodeMass = 0,
        initialAntinodeCount = 0,
        initialAntinodeMass = 0,
        roiCount = 0,
        roiMass = 0,
        initialROICount = 0,
        initialROIMass = 0;
      const density = new Array<number>(o.bins ** 2).fill(0),
        initialDensity = new Array<number>(o.bins ** 2).fill(0),
        massDensity = new Array<number>(o.bins ** 2).fill(0),
        initialMassDensity = new Array<number>(o.bins ** 2).fill(0);
      const bin = (x: number, y: number) =>
        Math.min(o.bins - 1, Math.floor(y * o.bins)) * o.bins +
        Math.min(o.bins - 1, Math.floor(x * o.bins));
      for (let i = 0; i < run.species.length; i++) {
        if (run.species[i] !== species) continue;
        const m = run.masses[i],
          x = frame.positions[i * 2],
          y = frame.positions[i * 2 + 1],
          ix = initial.positions[i * 2],
          iy = initial.positions[i * 2 + 1];
        count++;
        mass += m;
        distance += frame.distance[i];
        weightedDistance += frame.distance[i] * m;
        density[bin(x, y)]++;
        initialDensity[bin(ix, iy)]++;
        massDensity[bin(x, y)] += m;
        initialMassDensity[bin(ix, iy)] += m;
        if (inRegion(x, y, o.roi)) {
          roiCount++;
          roiMass += m;
        }
        if (inRegion(ix, iy, o.roi)) {
          initialROICount++;
          initialROIMass += m;
        }
        if (bandAvailable) {
          const a = sampleGrid(field!.amplitude, field!.size, x, y) / field!.peak,
            ia = sampleGrid(field!.amplitude, field!.size, ix, iy) / field!.peak;
          if (a <= o.nodeThreshold) {
            nodeCount++;
            nodeMass += m;
          }
          if (a >= o.antinodeThreshold) {
            antinodeCount++;
            antinodeMass += m;
          }
          if (ia <= o.nodeThreshold) {
            initialNodeCount++;
            initialNodeMass += m;
          }
          if (ia >= o.antinodeThreshold) {
            initialAntinodeCount++;
            initialAntinodeMass += m;
          }
        }
      }
      const denominator = o.basis === 'mass' ? mass : count;
      return {
        species,
        count,
        mass,
        meanDistance: count ? distance / count : 0,
        massWeightedDistance: mass ? weightedDistance / mass : 0,
        density,
        initialDensity,
        massDensity,
        initialMassDensity,
        nodeCount,
        antinodeCount,
        nodeMass,
        antinodeMass,
        nodeFraction: bandAvailable
          ? ratio(o.basis === 'mass' ? nodeMass : nodeCount, denominator)
          : null,
        antinodeFraction: bandAvailable
          ? ratio(o.basis === 'mass' ? antinodeMass : antinodeCount, denominator)
          : null,
        initialNodeFraction: bandAvailable
          ? ratio(o.basis === 'mass' ? initialNodeMass : initialNodeCount, denominator)
          : null,
        initialAntinodeFraction: bandAvailable
          ? ratio(o.basis === 'mass' ? initialAntinodeMass : initialAntinodeCount, denominator)
          : null,
        roiCount,
        roiMass,
        initialROICount,
        initialROIMass,
        distributionChange: totalVariation(
          o.basis === 'mass' ? initialMassDensity : initialDensity,
          o.basis === 'mass' ? massDensity : density,
        ),
      };
    });
  const target = groups[o.targetSpecies],
    allROI = groups.reduce((s, g) => s + (o.basis === 'mass' ? g.roiMass : g.roiCount), 0),
    targetROI = o.basis === 'mass' ? target.roiMass : target.roiCount,
    targetInput = o.basis === 'mass' ? target.mass : target.count,
    initialAllROI = groups.reduce(
      (s, g) => s + (o.basis === 'mass' ? g.initialROIMass : g.initialROICount),
      0,
    ),
    purity = ratio(targetROI, allROI),
    initialPurity = ratio(
      o.basis === 'mass' ? target.initialROIMass : target.initialROICount,
      initialAllROI,
    ),
    speciesDistance = totalVariation(
      o.basis === 'mass' ? groups[0].massDensity : groups[0].density,
      o.basis === 'mass' ? groups[1].massDensity : groups[1].density,
    ),
    initialSpeciesDistance = totalVariation(
      o.basis === 'mass' ? groups[0].initialMassDensity : groups[0].initialDensity,
      o.basis === 'mass' ? groups[1].initialMassDensity : groups[1].initialDensity,
    );
  return {
    source: 'approximation' as const,
    time: frame.time,
    options: o,
    total: run.species.length,
    lost: run.lost,
    fieldKey: field?.key ?? null,
    fieldFrequency: field?.frequency ?? null,
    bandAvailable,
    groups,
    speciesDistance,
    initialSpeciesDistance,
    speciesDistanceChange:
      speciesDistance != null && initialSpeciesDistance != null
        ? speciesDistance - initialSpeciesDistance
        : null,
    roi: {
      targetSpecies: o.targetSpecies,
      targetInput,
      targetROI,
      allROI,
      purity,
      initialPurity,
      recovery: ratio(targetROI, targetInput),
      enrichment:
        purity != null && initialPurity != null && initialPurity > 0
          ? purity / initialPurity
          : null,
    },
  };
}
/** Fixed physical conditions, independent seeds. Repeated identical seeds are not independent samples. */
export function repeatConditionKey(config: Config) {
  const copy = structuredClone(config) as Config & { device?: unknown };
  delete (copy.grains as Partial<Config['grains']>).seed;
  delete copy.device;
  return JSON.stringify(copy);
}
function summary(values: number[]) {
  if (!values.length) return null;
  const mean = values.reduce((s, x) => s + x, 0) / values.length;
  return {
    n: values.length,
    mean,
    sampleDeviation:
      values.length > 1
        ? Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / (values.length - 1))
        : null,
  };
}
export function repeatability(
  records: RecordEntry[],
  config: Config,
  options: Partial<AnalysisOptions> = {},
) {
  const matching = records.filter(
      (r) => r.run && repeatConditionKey(r.config) === repeatConditionKey(config),
    ),
    unique = new Map<number, RecordEntry>();
  for (const r of matching)
    if (!unique.has(r.config.grains.seed)) unique.set(r.config.grains.seed, r);
  const results = [...unique.values()].map((r) =>
    researchMetrics(
      r.run!,
      r.config.drive.duration,
      fieldAtRun(r.run!, r.config.drive.duration),
      options,
    ),
  );
  return {
    records: matching.length,
    independentSeeds: unique.size,
    groups: [0, 1].map((i) => ({
      species: i,
      meanDistance: summary(results.map((r) => r.groups[i].meanDistance)),
      nodeFraction: summary(
        results.flatMap((r) =>
          r.groups[i].nodeFraction == null ? [] : [r.groups[i].nodeFraction!],
        ),
      ),
    })),
    speciesDistance: summary(
      results.flatMap((r) => (r.speciesDistance == null ? [] : [r.speciesDistance])),
    ),
  };
}
export function metricsCSV(result: ReturnType<typeof researchMetrics>) {
  const o = result.options;
  const rows = [
    'source,time_s,basis,species,input_count,input_mass_kg,mean_distance_m,node_fraction,antinode_fraction,distribution_tv,roi_target,roi_x0,roi_y0,roi_x1,roi_y1,roi_purity,roi_recovery,node_amplitude_threshold,antinode_amplitude_threshold',
  ];
  for (const g of result.groups)
    rows.push(
      [
        'approximation',
        result.time,
        o.basis,
        g.species,
        g.count,
        g.mass,
        g.meanDistance,
        g.nodeFraction ?? '',
        g.antinodeFraction ?? '',
        g.distributionChange ?? '',
        o.targetSpecies,
        ...o.roi,
        result.roi.purity ?? '',
        result.roi.recovery ?? '',
        o.nodeThreshold,
        o.antinodeThreshold,
      ].join(','),
    );
  return rows.join('\n');
}
