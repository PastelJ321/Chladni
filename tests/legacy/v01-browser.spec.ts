import { test, expect } from '@playwright/test';

test('all structural and analysis views render without runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.loading-state')).toHaveCount(0);
  await expect(page.locator('.error-state')).toHaveCount(0);
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(2400);
  await page.screenshot({ path: 'artifacts/hero-desktop.png' });
  for (const label of ['분해도', '조립 과정', '부분 절개', '단면', '투시']) {
    await page.locator('.view-item').filter({ hasText: label }).click();
    await expect(page.locator('.view-item.active')).toContainText(label);
    if (label === '단면') {
      await page.waitForTimeout(1200);
      await page.screenshot({ path: 'artifacts/section.png' });
    }
  }
  await page.getByRole('button', { name: '현상 분석', exact: true }).click();
  for (const label of [
    '진동 전달',
    '진동 확대',
    '패턴의 형성',
    '모드 형상',
    '진폭 분포',
    '등고선',
    '입자 궤적',
    '이동 경향',
  ]) {
    await page.locator('.view-item').filter({ hasText: label }).click();
    await expect(page.locator('.view-item.active')).toContainText(label);
  }
  expect(errors).toEqual([]);
});

test('capture structural, data, comparison and presentation scenes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.loading-state')).toHaveCount(0);
  await page.locator('.view-item').filter({ hasText: '분해도' }).click();
  await page.getByLabel('부품 라벨', { exact: true }).check();
  await page.waitForTimeout(2400);
  await page.screenshot({ path: 'artifacts/exploded.png' });
  await page.getByLabel('부품 라벨', { exact: true }).uncheck();
  await page.getByRole('button', { name: '현상 분석', exact: true }).click();
  await page.locator('.view-item').filter({ hasText: '진폭 분포' }).click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'artifacts/amplitude.png' });
  await page.getByRole('button', { name: '실험 비교', exact: true }).click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'artifacts/comparison.png' });
  await page.getByRole('button', { name: '장비 탐색', exact: true }).click();
  await page.getByRole('button', { name: '클린 모드', exact: true }).click();
  await page.waitForTimeout(1800);
  await page
    .locator('canvas')
    .screenshot({ path: 'artifacts/hero-shot.png', style: '.restore-ui { visibility: hidden; }' });
});

test('parameters, timeline, layers, screenshot and session export work', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.loading-state')).toHaveCount(0);
  await page.getByRole('button', { name: '모드 3, 684 Hz 예시' }).click();
  await expect(page.locator('#frequency')).toHaveValue('684');
  await page.locator('#frequency').fill('710');
  await expect(page.locator('.response-meter')).not.toContainText('100%');
  await page.getByLabel('입자 재질').selectOption('mixture');
  await page.getByLabel('실험 타임라인').fill('3');
  await expect(page.locator('.time-readout>span')).toHaveText('3.0');
  await page.getByRole('button', { name: '재생', exact: true }).click();
  await expect(page.locator('.time-readout>span')).not.toHaveText('3.0');
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.getByLabel('마디선', { exact: true }).check();
  await page.getByLabel('부품 라벨', { exact: true }).check();
  await expect(page.locator('.scene-label:not(.hidden)')).toHaveCount(6);
  await page.getByRole('button', { name: '구조 · 레이어', exact: true }).click();
  await page.getByRole('button', { name: '입자 숨기기', exact: true }).click();
  await page.getByRole('button', { name: '실험 조건', exact: true }).click();
  await expect(page.getByLabel('입자', { exact: true })).not.toBeChecked();
  await page.getByLabel('입자', { exact: true }).check();
  await page.getByRole('button', { name: '구조 · 레이어', exact: true }).click();
  await expect(page.getByRole('button', { name: '입자 숨기기', exact: true })).toBeVisible();
  await page.locator('.part-select').filter({ hasText: '알루미늄 진동판' }).click();
  await expect(page.locator('.selected-part-detail h3')).toHaveText('알루미늄 진동판');
  await page.getByRole('button', { name: '알루미늄 진동판 숨기기' }).click();
  await expect(page.getByRole('button', { name: '알루미늄 진동판 표시' })).toBeVisible();
  const capture = page.waitForEvent('download');
  await page.getByRole('button', { name: '장면 PNG 저장' }).click();
  expect((await capture).suggestedFilename()).toContain('.png');
  const session = page.waitForEvent('download');
  await page.getByRole('button', { name: '조건 저장' }).click();
  expect((await session).suggestedFilename()).toBe('chladni-session.json');
});

test('split comparison and local experiment media work', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.loading-state')).toHaveCount(0);
  await page.getByRole('button', { name: '실험 비교', exact: true }).click();
  await page.getByLabel('비교 방식').selectOption('inverse');
  await expect(page.locator('.split-label.right')).toContainText('개념 모델');
  await page.getByLabel('비교 방식').selectOption('experiment');
  await page.getByLabel('실험 기록 파일 선택').setInputFiles({
    name: 'experiment.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.locator('.experiment-record img')).toBeVisible();
  await page.getByLabel('실측 주파수 (Hz)').fill('440');
  await expect(page.locator('.record-caption')).toContainText('440 Hz');
  await page.locator('.view-item').filter({ hasText: '진동 전·후' }).click();
  await expect(page.locator('.split-label.left')).toHaveText('진동 전');
  await expect(page.locator('.split-label.right')).toHaveText('패턴 형성 후');
  await page.locator('.view-item').filter({ hasText: '시간에 따른 변화' }).click();
  await expect(page.locator('.view-item.active')).toContainText('시간에 따른 변화');
});

test('clean mode, model dialog, demo and narrow layouts remain usable', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.loading-state')).toHaveCount(0);
  await page.getByRole('button', { name: '모델 안내', exact: true }).click();
  await expect(page.locator('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '클린 모드', exact: true }).click();
  await expect(page.locator('.topbar')).not.toBeVisible();
  await page.getByRole('button', { name: '컨트롤 표시 C' }).click();
  await page.locator('#frequency').fill('500');
  await page.getByRole('button', { name: '데모 재생', exact: true }).click();
  await expect(page.locator('.presentation-controls')).toBeVisible();
  await expect(page.locator('#frequency')).toHaveValue('438');
  await page.getByRole('button', { name: '다음 데모 장면' }).click();
  await expect(page.locator('.presentation-controls')).toContainText('구조를 펼치다');
  await page.getByRole('button', { name: '발표 종료' }).click();
  await expect(page.locator('#frequency')).toHaveValue('500');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.mobile-tools')).toBeVisible();
  await expect(page.locator('.stage')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.locator('.mobile-tools').getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.locator('.inspector')).toBeVisible();
  await page.getByRole('button', { name: '설정 닫기' }).click();
  await page.screenshot({ path: 'artifacts/hero-mobile.png' });
});
