import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const mode = process.env.CHLADNI_GPU_MODE ?? 'metal';
const baseURL = process.env.CHLADNI_BASE_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({
  executablePath,
  args: [
    '--enable-webgl',
    '--use-gl=angle',
    `--use-angle=${mode}`,
    '--enable-precise-memory-info',
    '--js-flags=--expose-gc',
    ...(mode === 'swiftshader' ? ['--enable-unsafe-swiftshader'] : []),
  ],
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1.5,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const report = {
  date: '2026-11-24',
  browser: browser.version(),
  backendRequested: mode,
  platform: process.platform,
  architecture: process.arch,
  cpu: os.cpus()[0]?.model,
  logicalCores: os.cpus().length,
  systemRAM: os.totalmem(),
  durationPerRunSeconds: 1,
  measurement:
    '3500 ms continuous GPU-interpolated playback after 18 warmup frames; 1200x700 CSS viewport; DPR 1.5 standard / 1 low; adaptive display disabled for comparable measurements',
  results: [],
  uiResults: [],
  contactResults: [],
  errors,
};
try {
  await page.goto(`${baseURL}/benchmarks/index.html`);
  await page.waitForFunction(() => typeof window.chladniBenchmark === 'function');
  for (const n of [5000, 20000, 50000, 100000]) {
    const result = await page.evaluate((n) => window.chladniBenchmark(n), n);
    report.results.push(result);
    console.log(JSON.stringify({ count: n, ...result }));
  }
  for (const [n, quality, macro] of [
    [100000, 'low', false],
    [20000, 'standard', true],
  ]) {
    const result = await page.evaluate(
      ([n, q, m]) => window.chladniBenchmark(n, q, m),
      [n, quality, macro],
    );
    report.results.push({ ...result, macro });
    console.log(JSON.stringify({ count: n, ...result, macro }));
  }
  // Separate full-application sampling: includes React, Glass chrome and result analysis.
  for (const n of [100, 500]) {
    const result = await page.evaluate((n) => window.chladniContactBenchmark(n), n);
    report.contactResults.push(result);
    console.log(JSON.stringify({ contact: result }));
  }
  await page.goto(`${baseURL}/`);
  await page.waitForFunction(() => document.querySelector('canvas')?.dataset.environment === 'hdr');
  await page.getByRole('button', { name: '스윕 계산', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.compute-status')?.textContent === '판 해석 완료',
  );
  await page.locator('.resonance-strip button').nth(1).click();
  await page.waitForFunction(
    () => document.querySelector('.compute-status')?.textContent === '판 해석 완료',
  );
  await page.getByRole('button', { name: '입자 실험', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.compute-status')?.textContent === '입자 계산 완료',
  );
  for (const workspace of ['실험', '분석']) {
    if (workspace === '분석')
      await page.getByRole('button', { name: workspace, exact: true }).click();
    const sample = await page.evaluate(async () => {
      const times = [];
      let start, last;
      await new Promise((resolve) => {
        function tick(t) {
          start ??= t;
          if (last != null) times.push(t - last);
          last = t;
          if (t - start < 3500) requestAnimationFrame(tick);
          else resolve();
        }
        requestAnimationFrame(tick);
      });
      const canvas = document.querySelector('canvas'),
        mean = times.reduce((a, b) => a + b, 0) / times.length;
      return {
        averageFPS: 1000 / mean,
        meanFrameMs: mean,
        p95FrameMs: times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)],
        frames: times.length,
        canvasCSS: [canvas.clientWidth, canvas.clientHeight],
        pixelRatio: canvas.width / canvas.clientWidth,
        physicalCount: +canvas.dataset.physicalCount,
        quality: canvas.dataset.quality,
        lod: canvas.dataset.lod,
        experimentTime: document.querySelector('.time-value')?.textContent,
        modalSolves: document.querySelector('.stage')?.dataset.modalSolves,
        mainJSHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      };
    });
    report.uiResults.push({ workspace, ...sample });
    console.log(JSON.stringify({ workspace, ...sample }));
  }
  await writeFile(
    `artifacts/laboratory-performance-${mode}.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
} finally {
  await browser.close();
}
