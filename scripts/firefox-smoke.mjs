import { firefox } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, cloneConfig } from '../src/experiment/config.ts';
const browser = await firefox.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH,
  firefoxUserPrefs: { 'webgl.force-enabled': true },
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const report = {
  date: '2026-11-24',
  browser: browser.version(),
  scope:
    'Firefox desktop native WebGL initialization, worker solve, particle playback, analysis, device clipping, resize and JSON export smoke',
  errors,
};
try {
  await page.goto('http://127.0.0.1:4173/');
  await page.waitForFunction(
    () => document.querySelector('.lab-canvas canvas')?.dataset.environment === 'hdr',
  );
  const config = cloneConfig(DEFAULT_CONFIG);
  config.grains.count = 1000;
  config.drive.duration = 1;
  await page.getByLabel('세션 파일').setInputFiles({
    name: 'synthetic-browser-config.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schema: 'chladni/5', config, records: [] })),
  });
  await page.waitForFunction(() =>
    document.querySelector('.toast')?.textContent?.includes('불러왔습니다'),
  );
  await page.getByRole('button', { name: '스윕 계산', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.compute-status')?.textContent === '판 해석 완료',
  );
  await page.getByRole('button', { name: '입자 실험', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.compute-status')?.textContent === '입자 계산 완료',
  );
  await page.getByRole('button', { name: '분석', exact: true }).click();
  await page.getByLabel('분석 레이어').selectOption('contour');
  await page.screenshot({ path: 'artifacts/laboratory-firefox.png' });
  await page.getByRole('button', { name: '장치', exact: true }).click();
  await page.getByLabel('장비 보기').selectOption('cutaway');
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.locator('.export-menu summary').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '세션 JSON 저장', exact: true }).click();
  const exported = await download;
  report.exportName = exported.suggestedFilename();
  report.physicalCount = await page
    .locator('.lab-canvas canvas')
    .getAttribute('data-physical-count');
  report.success = errors.length === 0 && report.physicalCount === '1000';
} catch (e) {
  report.success = false;
  report.error = String(e);
} finally {
  await writeFile(
    'artifacts/laboratory-firefox-smoke.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  await browser.close();
  console.log(JSON.stringify(report));
}
if (!report.success) process.exitCode = 1;
