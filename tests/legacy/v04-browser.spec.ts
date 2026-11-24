import { test, expect } from '@playwright/test';
import { DEFAULT_CONFIG, cloneConfig } from '../../src/experiment/config';
async function ready(page: import('@playwright/test').Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('canvas')).toHaveAttribute('data-environment', 'hdr');
  await expect(page.locator('.render-error')).toHaveCount(0);
}
async function loadConfig(page: import('@playwright/test').Page, count = 2000, duration = 1) {
  const c = cloneConfig(DEFAULT_CONFIG);
  c.grains.count = count;
  c.drive.duration = duration;
  await page.getByLabel('세션 파일').setInputFiles({
    name: 'conditions.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schema: 'chladni/3', config: c, records: [] })),
  });
}
async function shot(page: import('@playwright/test').Page, name: string) {
  await page.screenshot({ path: `artifacts/v04-${name}.png` });
}
test('visible grains, independent physical/display scale, density and macro LOD', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await expect(page.getByRole('navigation', { name: '작업 공간' }).getByRole('button')).toHaveCount(
    3,
  );
  await expect(page.locator('canvas')).toHaveAttribute('data-display-count', '20000');
  await shot(page, 'laboratory');
  await shot(page, 'mixed');
  await expect(page.locator('canvas')).toHaveScreenshot('laboratory.png', {
    maxDiffPixelRatio: 0.035,
  });
  const diameter = await page.getByLabel('규사 평균 입경', { exact: true }).inputValue();
  await page.locator('.particle-display>summary').click();
  await page.getByRole('radio', { name: '실제 크기', exact: true }).check();
  await expect(page.locator('.particle-caption')).toContainText('실제 크기');
  await page.locator('.particle-display>summary').click();
  await shot(page, 'actual-size');
  await page.locator('.particle-display>summary').click();
  await page.getByRole('radio', { name: '관찰용 확대', exact: true }).check();
  await page.locator('.particle-display>summary').click();
  await shot(page, 'observation');
  await expect(page.getByLabel('규사 평균 입경', { exact: true })).toHaveValue(diameter);
  await expect(page.locator('.stage')).toHaveAttribute('data-modal-solves', '0');
  await page.getByRole('button', { name: '접사', exact: true }).click();
  await expect(page.locator('canvas')).toHaveAttribute('data-lod', 'splats + PBR');
  await expect(page.locator('canvas')).toHaveScreenshot('macro.png', {
    maxDiffPixelRatio: 0.04,
    timeout: 45000,
  });
  await shot(page, 'macro');
  await page.locator('.particle-display>summary').click();
  await page.getByLabel('표시 입자 수').selectOption('100000');
  await expect(page.locator('canvas')).toHaveAttribute('data-display-count', '100000');
  await expect(page.locator('canvas')).toHaveAttribute('data-physical-count', '20000');
  expect(errors).toEqual([]);
});
test('FEM reuse, smooth result timeline, model no-motion state and binary round trip', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await ready(page);
  await loadConfig(page, 5000, 8);
  await page.getByRole('button', { name: '스윕 계산', exact: true }).click();
  await expect(page.locator('.compute-status')).toHaveText('판 해석 완료');
  await expect(page.locator('.stage')).toHaveAttribute('data-modal-solves', '1');
  await page.locator('.resonance-strip button').first().click();
  await expect(page.locator('.compute-status')).toHaveText('판 해석 완료');
  await page.getByRole('button', { name: '입자 실험', exact: true }).click();
  await expect(page.locator('.compute-status')).toHaveText('입자 계산 완료');
  await expect(page.locator('.motion-result')).toContainText('모델 이동 임계 미도달');
  await page.locator('.resonance-strip button').nth(1).click();
  await expect(page.locator('.compute-status')).toHaveText('판 해석 완료');
  await expect(page.locator('.stage')).toHaveAttribute('data-modal-solves', '1');
  await page.getByRole('button', { name: '입자 실험', exact: true }).click();
  await expect(page.locator('.compute-status')).toHaveText('입자 계산 완료');
  await expect(page.locator('.motion-result')).toContainText('이동 관찰');
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.getByRole('slider', { name: '실험 시간', exact: true }).fill('1.025');
  await expect(page.locator('.time-value')).toContainText('1.02');
  await page.getByRole('slider', { name: '실험 시간', exact: true }).fill('8');
  await page.getByRole('button', { name: '수직', exact: true }).click();
  await shot(page, 'formed');
  await page.getByRole('button', { name: '실험 기록', exact: true }).click();
  await page.locator('.export-menu summary').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '실험 바이너리 저장', exact: true }).click();
  const path = await (await download).path();
  await page.getByLabel('세션 파일').setInputFiles(path!);
  await expect(page.locator('.toast')).toHaveText('세션을 불러왔습니다.');
  await expect(page.locator('canvas')).toHaveAttribute('data-physical-count', '5000');
  await page.locator('.export-menu summary').click();
  await page.getByRole('slider', { name: '실험 시간', exact: true }).fill('8');
  await page.getByRole('button', { name: '분석', exact: true }).click();
  await page.getByLabel('분석 레이어').selectOption('amplitude');
  await shot(page, 'amplitude');
  await page.getByLabel('계산된 고유모드').check();
  await expect(page.locator('.particle-caption')).toContainText('고유모드 형상');
  await page.getByLabel('계산된 고유모드').uncheck();
  await page.getByLabel('분석 레이어').selectOption('contour');
  await shot(page, 'contour');
  await page.getByLabel('분석 레이어').selectOption('trace');
  await page.getByLabel('분석 레이어').selectOption('density');
  await page.getByLabel('조건 비교').selectOption('before');
  await shot(page, 'analysis');
  await page.getByRole('button', { name: '실험', exact: true }).click();
  await page.getByLabel('규사 평균 입경', { exact: true }).fill('260');
  await page.getByLabel('규사 평균 입경', { exact: true }).blur();
  await expect(page.getByRole('button', { name: '입자 실험', exact: true })).toBeEnabled();
  await expect(page.locator('.stage')).toHaveAttribute('data-modal-solves', '1');
  expect(errors).toEqual([]);
});
test('species presets, material independence and physical values survive v0.3 import', async ({
  page,
}) => {
  await ready(page);
  await loadConfig(page);
  await page.getByLabel('첫째 입자 종류').selectOption('sugar');
  await expect(page.getByLabel('설탕 평균 입경', { exact: true })).toHaveValue('500');
  await expect(page.getByLabel('소금 평균 입경', { exact: true })).toHaveValue('427.5');
  await page.getByLabel('둘째 입자 종류').selectOption('glass');
  await expect(page.getByLabel('유리 비즈 평균 입경', { exact: true })).toHaveValue('500');
  await page.locator('.grain-card').first().locator('details>summary').click();
  await expect(page.getByLabel('설탕 밀도', { exact: true })).toHaveValue('1590');
  await page.getByLabel('설탕 체 구간').selectOption('125–250');
  await expect(page.getByLabel('설탕 평균 입경', { exact: true })).toHaveValue('187.5');
  await shot(page, 'species');
});
test('cinematic director stays outside scene, releases manual camera, returns to contacts and captures PNG', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await ready(page);
  await page.getByRole('button', { name: '장치', exact: true }).click();
  await page.getByRole('button', { name: '장면 연출', exact: true }).click();
  await page.getByLabel('연출 시퀀스').selectOption('exploded');
  await page.getByLabel('연출 타임라인').fill('9');
  const scene = (await page.locator('.stage').boundingBox())!,
    director = (await page.locator('.director-controls').boundingBox())!;
  expect(director.y).toBeGreaterThanOrEqual(scene.y + scene.height);
  await shot(page, 'exploded');
  const canvas = page.locator('canvas'),
    b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.75, b.y + b.height * 0.65, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.director-controls')).toContainText('직접 조작');
  await page.getByLabel('연출 타임라인').fill('18');
  await page.getByRole('button', { name: '연출 정지', exact: true }).click();
  await page.getByLabel('장비 보기').selectOption('section');
  await page.getByLabel('단면 축').selectOption('x');
  await shot(page, 'section');
  await page.getByRole('button', { name: '연출 도구 닫기', exact: true }).click();
  const png = page.waitForEvent('download');
  await page.getByRole('button', { name: '고해상도 PNG 저장', exact: true }).click();
  expect((await png).suggestedFilename()).toBe('chladni-v04.png');
  await page.locator('.export-menu summary').click();
  await page
    .locator('.export-menu')
    .getByRole('button', { name: '발표 화면', exact: true })
    .click();
  await expect(page.locator('.app-header')).not.toBeVisible();
  await page.getByRole('button', { name: '발표 종료' }).click();
  await expect(page.getByLabel('장비 보기')).toHaveValue('section');
  expect(errors).toEqual([]);
});
test('old session arrays and measured media remain separate from calculated results', async ({
  page,
}) => {
  await ready(page);
  const legacy = cloneConfig(DEFAULT_CONFIG);
  legacy.grains.count = 1800;
  delete legacy.grains.groups;
  await page.getByLabel('세션 파일').setInputFiles({
    name: 'legacy.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schema: 'chladni/2', config: legacy, records: [] })),
  });
  await expect(page.getByLabel('소금 평균 입경', { exact: true })).toHaveValue('350');
  await page.getByRole('button', { name: '분석', exact: true }).click();
  await page.getByLabel('실측 미디어 파일').setInputFiles({
    name: 'fixture.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.locator('.media-preview')).toContainText('원근 미보정');
});
test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  test('readable controls, particle LOD and explicit low quality', async ({ page }) => {
    await ready(page);
    await shot(page, 'mobile');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: '실험 조건', exact: true }).click();
    await expect(page.getByLabel('규사 평균 입경', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '설정 닫기' }).click();
    await page.locator('.export-menu summary').click();
    await page.getByRole('button', { name: '저사양 표시', exact: true }).click();
    await expect(page.locator('canvas')).toHaveAttribute('data-quality', 'low');
    await expect
      .poll(() =>
        page.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width / c.clientWidth),
      )
      .toBe(1);
    await page.locator('.export-menu summary').click();
    await shot(page, 'mobile-low');
  });
});
