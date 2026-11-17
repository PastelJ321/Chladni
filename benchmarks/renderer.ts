import * as T from 'three';
import { LabRenderer, type RenderData } from '../src/render/LabRenderer';
import { DEFAULT_CONFIG, DEFAULT_VIEW, cloneConfig } from '../src/experiment/config';
import { encodeBinarySession, encodeSession } from '../src/io/session';
import type { Config, ModalResult, Run, Sweep, Field } from '../src/experiment/types';
const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
async function job(worker: Worker, id: number, kind: string, config: Config) {
  return await new Promise<any>((resolve, reject) => {
    worker.onmessage = (e) => {
      if (e.data.id !== id || e.data.kind === 'progress') return;
      e.data.kind === 'error' ? reject(Error(e.data.message)) : resolve(e.data);
    };
    worker.onerror = () => reject(Error('Worker error'));
    worker.postMessage({ id, kind, config });
  });
}
function gpuBytes(lab: LabRenderer) {
  const attrs = new Set<T.BufferAttribute | T.InterleavedBufferAttribute>(),
    textures = new Set<T.Texture>();
  let geometry = 0,
    texture = 0;
  lab.scene.traverse((o) => {
    if (o instanceof T.Mesh || o instanceof T.Points || o instanceof T.Line) {
      for (const a of Object.values(o.geometry.attributes))
        if (a instanceof T.BufferAttribute || a instanceof T.InterleavedBufferAttribute)
          attrs.add(a);
      if (o.geometry.index) attrs.add(o.geometry.index);
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        for (const v of Object.values(m)) if (v instanceof T.Texture) textures.add(v);
    }
  });
  for (const a of attrs)
    geometry +=
      a instanceof T.InterleavedBufferAttribute ? a.data.array.byteLength : a.array.byteLength;
  if (lab.scene.environment) textures.add(lab.scene.environment);
  textures.add(lab.fieldGPU.texture);
  textures.add(lab.fieldGPU.densityTexture);
  for (const t of textures) {
    const image = t.image as
      { data?: { byteLength: number }; width?: number; height?: number } | undefined;
    if (!image) continue;
    const b =
      image.data?.byteLength ??
      (image.width ?? 0) *
        (image.height ?? 0) *
        4 *
        (t.type === T.HalfFloatType ? 2 : t.type === T.FloatType ? 4 : 1);
    texture += b * (t.generateMipmaps ? 4 / 3 : 1);
  }
  // Two RG16F targets (4 B/px) and estimated 32-bit depth allocations. Not measured VRAM.
  const shadows = 2 * 1024 * 1024 * (4 + 4);
  return {
    geometryBytes: geometry,
    textureBytes: Math.round(texture),
    shadowEstimateBytes: shadows,
    totalEstimatedBytes: Math.round(geometry + texture + shadows),
    excludes: 'default framebuffer, driver overhead, global LTC textures',
  };
}
const worker = new Worker(new URL('../src/solver/worker.ts', import.meta.url), { type: 'module' });
let id = 0,
  modal: ModalResult,
  sweep: Sweep;
async function runCase(
  displayCount: number,
  quality: 'standard' | 'low' = 'standard',
  macro = false,
) {
  const config = cloneConfig(DEFAULT_CONFIG);
  config.grains.count = Math.min(50000, displayCount);
  config.drive.duration = 1;
  config.drive.frequency = 249.625;
  const begin = performance.now();
  if (!modal) {
    const s = await job(worker, ++id, 'solve', config);
    modal = s.modal;
    sweep = s.sweep;
  }
  const runStart = performance.now(),
    result = await job(worker, ++id, 'run', config),
    run: Run = result.run;
  const workerRoundTripMs = performance.now() - runStart;
  const record = {
    id: 'profile',
    name: 'profile',
    config,
    modal,
    sweep,
    run,
    created: '2026-11-17',
  };
  const jsonStart = performance.now(),
    jsonBytes = new Blob([encodeSession(config, [], record)]).size,
    jsonExportMs = performance.now() - jsonStart;
  const binaryStart = performance.now(),
    binaryBytes = encodeBinarySession(config, [], record).size,
    binaryExportMs = performance.now() - binaryStart;
  const data: RenderData = {
    config,
    modal,
    run,
    field: run.fields[0] as Field,
    time: 0,
    paint: false,
    animate: false,
    view: {
      ...DEFAULT_VIEW,
      camera: macro ? 'macro' : 'hero',
      quality,
      gain: 1,
      particleVisual: { ...DEFAULT_VIEW.particleVisual!, count: displayCount },
    },
  };
  const lab = new LabRenderer(
    document.getElementById('viewport') as HTMLDivElement,
    data,
    () => {},
    () => {},
  );
  cancelAnimationFrame(lab.raf);
  lab.adaptiveQuality = false;
  lab.rig.preset(macro ? 'macro' : 'hero', true);
  const deadline = performance.now() + 15000;
  while (!lab.environmentReady && performance.now() < deadline) await frame();
  for (let i = 0; i < 18; i++) {
    await frame();
    lab.draw();
  }
  (globalThis as typeof globalThis & { gc?: () => void }).gc?.();
  const gl = lab.renderer.getContext() as WebGL2RenderingContext,
    debug = gl.getExtension('WEBGL_debug_renderer_info'),
    ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const times: number[] = [],
    cpu: number[] = [],
    gpu: number[] = [],
    pending: WebGLQuery[] = [];
  let last = await frame(),
    start = last;
  while (last - start < 3500 || times.length < 12) {
    const now = await frame();
    times.push(now - last);
    last = now;
    data.time = ((now - start) / 1000) % config.drive.duration;
    lab.update(data);
    let query: WebGLQuery | null = null;
    if (ext && pending.length < 8) {
      query = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    }
    const a = performance.now();
    lab.draw();
    cpu.push(performance.now() - a);
    if (ext && query) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(query);
    }
    if (ext)
      for (let j = pending.length - 1; j >= 0; j--)
        if (gl.getQueryParameter(pending[j], gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT))
            gpu.push(gl.getQueryParameter(pending[j], gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(pending[j]);
          pending.splice(j, 1);
        }
  }
  for (const q of pending) gl.deleteQuery(q);
  const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null),
    sorted = [...times].sort((a, b) => a - b);
  const output = {
    displayCount,
    physicalCount: config.grains.count,
    representation:
      displayCount > config.grains.count
        ? 'representative visual expansion'
        : 'one visual per integrated particle',
    quality,
    camera: macro ? 'macro' : 'hero',
    viewportCSS: [1200, 700],
    drawingBuffer: [lab.renderer.domElement.width, lab.renderer.domElement.height],
    pixelRatio: lab.renderer.getPixelRatio(),
    backend: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    frames: times.length,
    averageFPS: 1000 / (mean(times) ?? Infinity),
    meanFrameMs: mean(times),
    p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
    cpuSubmitMs: mean(cpu),
    gpuMs: mean(gpu),
    gpuSamples: gpu.length,
    gpuTimerAvailable: !!ext,
    simulateParticlesMs: run.elapsedMs,
    workerRoundTripMs,
    setupAndCalculationMs: runStart - begin,
    mainJSHeapBytes:
      (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize ?? null,
    recordingBytes: run.frames.reduce(
      (n, f) =>
        n + (f.positions as Float32Array).byteLength + (f.distance as Float32Array).byteLength,
      0,
    ),
    jsonBytes,
    binaryBytes,
    jsonExportMs,
    binaryExportMs,
    recordHz: run.recordHz,
    gpuAssets: gpuBytes(lab),
    positionUploadBytes: lab.cloud.stats.uploadedBytes,
    detailUploadBytes: lab.cloud.stats.detailUploadedBytes,
    detailCountLastBatch: lab.cloud.stats.detailCount,
    lod: lab.cloud.stats.lod,
    renderCalls: lab.renderer.info.render.calls,
    motion: run.motion,
  };
  if (macro && lab.cloud.stats.lod !== 'splats + PBR')
    throw Error('Macro benchmark did not exercise PBR LOD');

  lab.dispose();
  const final = { ...output, resourcesAfterDispose: { ...lab.renderer.info.memory } };
  document.getElementById('output')!.textContent = JSON.stringify(final, null, 2);
  return final;
}
Object.assign(window, { chladniBenchmark: runCase });
