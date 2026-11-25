import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { cloneConfig, DEFAULT_CONFIG } from '../../src/experiment/config';
test('synthetic image is corner-registered, counted manually and exported with source coordinates', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.render-error')).toHaveCount(0);
  await page.getByRole('button', { name: '분석', exact: true }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 160;
    const ctx = canvas.getContext('2d')!;
    for (const [color, x, y] of [
      ['#ff0000', 0, 0],
      ['#00ff00', 80, 0],
      ['#0000ff', 0, 80],
      ['#ffff00', 80, 80],
    ] as const) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 80, 80);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('실측 미디어 파일').setInputFiles({
    name: 'synthetic-registration-fixture.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(page.locator('.media-preview')).toContainText('원근 미보정');
  await page.getByRole('button', { name: '판의 네 모서리 지정', exact: true }).click();
  const b = (await page.locator('.corner-picker').boundingBox())!;
  for (const [i, [x, y]] of [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.9, 0.9],
    [0.1, 0.9],
  ].entries()) {
    await page.locator('.corner-picker').click({ position: { x: b.width * x, y: b.height * y } });
    await expect(page.locator('.corner-markers circle')).toHaveCount(i + 1);
  }
  await page.getByRole('button', { name: '원근 보정 보기', exact: true }).click();
  const canvas = page.getByRole('img', { name: '판 좌표로 원근 보정한 실측 영상' });
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBe(512);
  await expect
    .poll(() =>
      canvas.evaluate((c: HTMLCanvasElement) =>
        Array.from(c.getContext('2d')!.getImageData(20, 20, 1, 1).data),
      ),
    )
    .toEqual([255, 0, 0, 255]);
  await page.getByText('영역 입자 수 직접 기록', { exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  const rect = (await canvas.boundingBox())!;
  await page.mouse.move(rect.x + rect.width * 0.1, rect.y + rect.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.4, rect.y + rect.height * 0.7);
  await page.mouse.up();
  await page.getByLabel('관측 1 입자 수').fill('12');
  await page.getByLabel('관측 2 입자 수').fill('5');
  await page
    .getByLabel('영역 관찰 메모')
    .fill('Synthetic test counts; not measured experiment data.');
  await page.getByRole('button', { name: '수동 영역 관측 기록', exact: true }).click();
  await expect(page.locator('.manual-region-row')).toContainText('12 / 5');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '수동 관측 JSON 저장', exact: true }).click();
  const file = await downloaded,
    data = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(data.source).toBe('manual-observation');
  expect(data.media.name).toBe('synthetic-registration-fixture.png');
  expect(data.regions[0].counts).toEqual([12, 5]);
  expect(data.regions[0].roi[0]).toBeCloseTo(0.1, 2);
  expect(data.regions[0].roi[2]).toBeCloseTo(0.4, 2);
  expect(JSON.stringify(data)).not.toContain('blob:');
  await page.screenshot({ path: 'artifacts/research-registration-fixture.png' });
  expect(errors).toEqual([]);
});

test('synthetic video preserves frame/offset metadata and requests the same source after session restore', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const config = cloneConfig(DEFAULT_CONFIG);
  config.grains.count = 100;
  config.drive.duration = 0.5;
  await page.getByLabel('세션 파일').setInputFiles({
    name: 'fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schema: 'chladni/5', config, records: [] })),
  });
  await expect(page.locator('.toast')).toContainText('불러왔습니다');
  await page.getByRole('button', { name: '스윕 계산', exact: true }).click();
  await expect(page.locator('.compute-status')).toHaveText('판 해석 완료');
  await page.getByRole('button', { name: '입자 실험', exact: true }).click();
  await expect(page.locator('.compute-status')).toHaveText('입자 계산 완료');
  const file = 'tests/fixtures/synthetic-timeline.webm';
  await page.getByRole('button', { name: '분석', exact: true }).click();
  await page.getByLabel('실측 미디어 파일').setInputFiles(file);
  await expect
    .poll(() =>
      page.locator('.media-preview video').evaluate((v: HTMLVideoElement) => v.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await page.getByLabel('관찰 프레임 시간').fill('0.2');
  await expect
    .poll(() =>
      page.locator('.media-preview video').evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(0.2, 2);
  await page.getByLabel('영상 오프셋', { exact: true }).fill('0.1');
  await page.getByLabel('실측 주파수', { exact: true }).fill('100');
  await page
    .getByLabel('실제 관찰', { exact: true })
    .fill('Synthetic video fixture. Not a measured school experiment.');
  await page.getByRole('button', { name: '판의 네 모서리 지정', exact: true }).click();
  const b = (await page.locator('.corner-picker').boundingBox())!;
  for (const [x, y] of [
    [0.05, 0.05],
    [0.95, 0.05],
    [0.95, 0.95],
    [0.05, 0.95],
  ])
    await page.locator('.corner-picker').click({ position: { x: b.width * x, y: b.height * y } });
  await page.getByRole('button', { name: '원근 보정 보기', exact: true }).click();
  await expect(page.getByRole('img', { name: '판 좌표로 원근 보정한 실측 영상' })).toBeVisible();
  await page.getByLabel('판 좌표에서 계산과 중첩').check();
  await page.screenshot({ path: 'artifacts/laboratory-video-comparison-fixture.png' });
  const frame = page.waitForEvent('download');
  await page.getByRole('button', { name: '원본 프레임 PNG', exact: true }).click();
  expect((await frame).suggestedFilename()).toContain('measured-frame-0.200s');
  await page.locator('.export-menu summary').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '세션 JSON 저장', exact: true }).click();
  const saved = await download,
    path = (await saved.path())!;
  const data = JSON.parse(await readFile(path, 'utf8'));
  expect(data.extras.observations.offset).toBe(0.1);
  expect(data.extras.observations.media.name).toBe('synthetic-timeline.webm');
  expect(data.extras.observations.media.embedded).toBeUndefined();
  await page.getByLabel('세션 파일').setInputFiles(path);
  await expect(page.locator('.toast')).toContainText('불러왔습니다');
  await expect(page.locator('.media-preview')).toHaveCount(0);
  await expect(page.locator('.research-tools')).toContainText('저장한 원본 참조');
  await page.getByLabel('실측 미디어 파일').setInputFiles(file);
  await expect(page.getByLabel('영상 오프셋', { exact: true })).toHaveValue('0.1');
  await expect(page.getByRole('img', { name: '판 좌표로 원근 보정한 실측 영상' })).toBeVisible();
});
