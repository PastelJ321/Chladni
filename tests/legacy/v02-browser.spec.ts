import { test, expect } from '@playwright/test';
import { DEFAULT_CONFIG } from '../../src/experiment/config';
test('real worker solve, sweep selection, simulation and cache invalidation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.screenshot({ path: 'artifacts/v02-design.png' });
  await page.getByRole('button', { name: '판 해석 · 스윕 계산' }).click();
  await expect(page.locator('.compute-status')).toHaveText('판 해석 완료');
  await expect(page.locator('.mode-list button')).toHaveCount(16);
  await expect(page.getByRole('button', { name: '입자 실험 실행' })).toBeEnabled();
  await page.locator('.peak-list button').first().click();
  await expect(page.locator('.compute-status')).toHaveText('판 해석 완료');
  await page.getByRole('button', { name: '입자 실험 실행' }).click();
  await expect(page.locator('.compute-status')).toHaveText('입자 계산 완료');
  await expect(page.locator('.metric-grid strong')).toHaveCount(1);
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.getByLabel('실험 시간', { exact: true }).fill('4');
  await expect(page.locator('.time-value')).toContainText('4.00');
  await page.getByLabel('시각화 레이어').selectOption('density');
  await page.screenshot({ path: 'artifacts/v02-simulation.png' });
  await page.getByLabel('시각화 레이어').selectOption('mesh');
  await page.screenshot({ path: 'artifacts/v02-mesh.png' });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: '입자 CSV', exact: true }).click();
  expect((await dl).suggestedFilename()).toBe('particles.csv');
  await page.getByLabel('두께', { exact: true }).fill('3');
  await page.getByLabel('두께', { exact: true }).press('Tab');
  await expect(page.locator('.compute-status')).toContainText('재계산 필요');
  await expect(page.getByRole('button', { name: '입자 실험 실행' })).toBeDisabled();
  await expect(page.locator('.mode-list button')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('session round trip, condition comparison, structure, presentation and mobile', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '판 해석 · 스윕 계산' }).click();
  await expect(page.locator('.compute-status')).toHaveText('판 해석 완료');
  await page.getByRole('button', { name: '실험 기록', exact: true }).click();
  await page.getByRole('button', { name: '연구 기록', exact: true }).click();
  await expect(page.locator('.record-row')).toHaveCount(1);
  await page.getByLabel('조건 비교').selectOption({ index: 2 });
  await page.screenshot({ path: 'artifacts/v02-comparison.png' });
  await page.getByLabel('조건 비교').selectOption('');
  await page.getByRole('button', { name: '장비 구조', exact: true }).click();
  await page.getByLabel('장비 보기').selectOption('section');
  await page.getByLabel('단면 축').selectOption('x');
  await page.getByLabel('단면 위치').fill('.2');
  await page.getByLabel('단면 위치').press('Tab');
  await page.screenshot({ path: 'artifacts/v02-section.png' });
  await page.getByRole('button', { name: '발표', exact: true }).click();
  await expect(page.locator('.app-header')).not.toBeVisible();
  await page.getByRole('button', { name: '투시', exact: true }).click();
  await page.getByRole('button', { name: '발표 종료' }).click();
  await expect(page.getByLabel('장비 보기')).toHaveValue('section');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON 저장' }).click();
  const file = await (await dl).path();
  await page.getByLabel('세션 파일').setInputFiles(file!);
  await expect(page.locator('.toast')).toContainText('세션을 불러왔습니다');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '실험 조건', exact: true }).click();
  await expect(page.locator('.configuration')).toBeVisible();
  await page.getByRole('button', { name: '설정 닫기' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/v02-mobile.png' });
});
test('local measured media and particle configuration are attributed honestly', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '입자', exact: true }).click();
  await page.getByLabel('입자 종류').selectOption('mixture');
  await page.getByLabel('입자 수', { exact: true }).fill('80');
  await page.getByLabel('입자 수', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '판 위에 직접 뿌리기' }).click();
  await expect(page.locator('.paint-hint')).toBeVisible();
  await page.getByRole('button', { name: '연구 기록', exact: true }).click();
  await page.getByLabel('실측 미디어 파일').setInputFiles({
    name: 'measured.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.locator('.media-overlay img')).toBeVisible();
  await expect(page.locator('.media-overlay')).toContainText('실측 기록');
  await page.getByLabel('세션 파일').setInputFiles({
    name: 'test.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ schema: 'chladni/2', config: DEFAULT_CONFIG, records: [] }),
    ),
  });
  await expect(page.locator('.toast')).toContainText('세션을 불러왔습니다');
});
