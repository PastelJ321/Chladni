import { test, expect } from '@playwright/test';
import { DEFAULT_CONFIG } from '../../src/experiment/config';
test('focused experiment, independent groups, sweep and result export', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '작업 공간' }).getByRole('button')).toHaveCount(
    3,
  );
  await expect(page.getByLabel('탄성계수')).not.toBeVisible();
  await page.screenshot({ path: 'artifacts/v03-experiment.png' });
  const salt = await page.getByLabel('소금 평균 입경', { exact: true }).inputValue();
  await page.getByLabel('규사 체 구간').selectOption('125–250');
  await expect(page.getByLabel('소금 평균 입경', { exact: true })).toHaveValue(salt);
  await expect(page.getByLabel('규사 평균 입경', { exact: true })).toHaveValue('187.5');
  await page.getByRole('button', { name: '스윕 계산', exact: true }).click();
  await expect(page.locator('.compute-status')).toHaveText('판 해석 완료');
  await page.locator('.resonance-strip button').first().click();
  await expect(page.locator('.compute-status')).toHaveText('판 해석 완료');
  await page.getByRole('button', { name: '입자 실험', exact: true }).click();
  await expect(page.locator('.compute-status')).toHaveText('입자 계산 완료');
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.getByRole('slider', { name: '실험 시간', exact: true }).fill('4');
  await expect(page.locator('.time-value')).toContainText('4.00');
  await page.getByRole('button', { name: '장면 연출', exact: true }).click();
  await page.getByLabel('연출 시퀀스').selectOption('resonance');
  await page.getByLabel('연출 타임라인').fill('9');
  await page.screenshot({ path: 'artifacts/v03-resonance.png' });
  await page.getByLabel('연출 시퀀스').selectOption('formation');
  await page.getByLabel('연출 타임라인').fill('10');
  await page.screenshot({ path: 'artifacts/v03-formation.png' });
  await expect(page.locator('.time-value')).toContainText('4.00');
  await page.getByRole('button', { name: '연출 도구 닫기', exact: true }).click();
  await page.getByRole('button', { name: '분석', exact: true }).click();
  await page.getByLabel('분석 레이어').selectOption('density');
  await page.getByLabel('조건 비교').selectOption('before');
  await page.screenshot({ path: 'artifacts/v03-analysis.png' });
  await expect(page.locator('.compare-caption.right')).toHaveText('최종 분포');
  await page.getByLabel('실측 미디어 파일').setInputFiles({
    name: 'comparison-fixture.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.getByRole('button', { name: '장면 연출', exact: true }).click();
  await page.getByLabel('연출 시퀀스').selectOption('comparison');
  await page.getByLabel('연출 타임라인').fill('6');
  await expect(page.locator('.stage-source')).toContainText('결과 재생 4.80 s');
  await expect(page.locator('.media-preview')).toContainText('원근 미보정');
  await expect(page.locator('.compare-caption')).toHaveCount(0);
  await expect(page.locator('.time-value')).toContainText('4.00');
  await page.getByRole('button', { name: '연출 도구 닫기', exact: true }).click();
  await page.locator('.export-menu summary').click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: '세션 JSON 저장', exact: true }).click();
  const file = await (await dl).path();
  await page.getByLabel('세션 파일').setInputFiles(file!);
  await expect(page.locator('.toast')).toHaveText('세션을 불러왔습니다.');
  await page.getByRole('button', { name: '실험', exact: true }).click();
  await page.getByLabel('규사 평균 입경', { exact: true }).fill('200');
  await page.getByLabel('규사 평균 입경', { exact: true }).blur();
  await expect(page.locator('.compute-status')).toHaveText('조건 변경 · 재계산 필요');
  await expect(page.getByRole('button', { name: '입자 실험', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});
test.describe('render quality fallback', () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 390, height: 844 } });
  test('DPR cap and low quality preserve the narrow viewport', async ({ page }) => {
    await page.goto('/');
    const ratio = () =>
      page.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width / c.clientWidth);
    await expect.poll(ratio).toBeGreaterThan(1.4);
    await page.locator('.export-menu summary').click();
    await page.getByRole('button', { name: '저사양 표시', exact: true }).click();
    await expect.poll(ratio).toBe(1);
    await expect(page.getByRole('button', { name: '표준 화질로', exact: true })).toBeVisible();
    await page.locator('.export-menu summary').click();
    await page.screenshot({ path: 'artifacts/v03-mobile-low.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
});
test('director can scrub, pause, return to assembly, and yield to manual controls', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '장치', exact: true }).click();
  await page.getByRole('button', { name: '장면 연출', exact: true }).click();
  await page.getByLabel('연출 시퀀스').selectOption('exploded');
  await page.getByLabel('연출 타임라인').fill('9');
  await expect(page.getByRole('button', { name: '연출 재생', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/v03-exploded.png' });
  const canvas = page.locator('canvas'),
    b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.46, b.y + b.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.58, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.director-controls')).toContainText('직접 조작');
  await page.getByLabel('연출 타임라인').fill('18');
  await page.getByRole('button', { name: '연출 정지', exact: true }).click();
  await page.getByLabel('장비 보기').selectOption('section');
  await page.getByLabel('단면 축').selectOption('x');
  await page.screenshot({ path: 'artifacts/v03-device.png' });
  await page.locator('.export-menu summary').click();
  await page
    .locator('.export-menu')
    .getByRole('button', { name: '발표 화면', exact: true })
    .click();
  await expect(page.locator('.app-header')).not.toBeVisible();
  await expect(page.getByRole('button', { name: '발표 종료' })).toBeVisible();
  await page.getByRole('button', { name: '발표 종료' }).click();
  await expect(page.getByLabel('장비 보기')).toHaveValue('section');
});
test('v0.2 session compatibility, measured media, and narrow layouts', async ({ page }) => {
  await page.goto('/');
  const legacy = structuredClone(DEFAULT_CONFIG);
  delete legacy.grains.groups;
  await page.getByLabel('세션 파일').setInputFiles({
    name: 'v02.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schema: 'chladni/2', config: legacy, records: [] })),
  });
  await expect(page.getByLabel('소금 평균 입경', { exact: true })).toHaveValue('350');
  await page.getByRole('button', { name: '분석', exact: true }).click();
  await page.getByLabel('실측 미디어 파일').setInputFiles({
    name: 'measured.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.locator('.media-preview img')).toBeVisible();
  await expect(page.locator('.media-preview')).toContainText('실측');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '실험 조건', exact: true }).click();
  await expect(page.locator('.analysis-tools')).toBeVisible();
  await page.getByRole('button', { name: '설정 닫기' }).click();
  await page.screenshot({ path: 'artifacts/v03-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '실험', exact: true }).click();
  await page.getByRole('button', { name: '실험 조건', exact: true }).click();
  await expect(page.getByLabel('규사 평균 입경', { exact: true })).toBeVisible();
});
