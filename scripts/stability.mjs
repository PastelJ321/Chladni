import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: [
    '--enable-webgl',
    '--use-gl=angle',
    '--use-angle=metal',
    '--enable-precise-memory-info',
    '--js-flags=--expose-gc',
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const report = {
  date: '2026-11-24',
  browser: browser.version(),
  scope:
    'Six 8-second recorded runs replayed for 60 seconds; short stability smoke, not long-term/thermal certification',
  samples: [],
  errors,
};
try {
  await page.goto(process.env.CHLADNI_BASE_URL ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(
    () => document.querySelector('.lab-canvas canvas')?.dataset.environment === 'hdr',
  );
  await page.getByRole('button', { name: '스윕 계산', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.compute-status')?.textContent === '판 해석 완료',
  );
  await page.getByLabel('관찰 주파수').fill('249.625');
  await page.waitForFunction(
    () => document.querySelector('.compute-status')?.textContent === '판 해석 완료',
  );
  await page.getByRole('button', { name: '입자 실험', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.compute-status')?.textContent === '입자 계산 완료',
  );
  for (let cycle = 0; cycle < 6; cycle++) {
    await page.getByRole('slider', { name: '실험 시간', exact: true }).fill('0');
    const play = page.getByRole('button', { name: '재생', exact: true });
    if (await play.count()) await play.click();
    const sample = await page.evaluate(async () => {
      const frames = [];
      let first, last;
      await new Promise((resolve) => {
        const tick = (t) => {
          first ??= t;
          if (last !== undefined) frames.push(t - last);
          last = t;
          if (t - first < 10000) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      globalThis.gc?.();
      const c = document.querySelector('.lab-canvas canvas');
      return {
        elapsedMs: last - first,
        averageFPS: (frames.length * 1000) / (last - first),
        mainJSHeapBytes: performance.memory?.usedJSHeapSize ?? null,
        physicalCount: c?.dataset.physicalCount,
        canvasCount: document.querySelectorAll('.lab-canvas canvas').length,
        modalSolves: document.querySelector('.stage')?.dataset.modalSolves,
        time: document.querySelector('.time-value')?.textContent,
      };
    });
    report.samples.push({ cycle, ...sample });
    console.log(JSON.stringify({ cycle, ...sample }));
  }
  report.success =
    errors.length === 0 &&
    report.samples.every(
      (s) => s.canvasCount === 1 && s.physicalCount === '20000' && s.modalSolves === '1',
    );
  await writeFile(
    'artifacts/laboratory-stability-metal.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  if (!report.success) throw Error('Stability invariant failed');
} finally {
  await browser.close();
}
