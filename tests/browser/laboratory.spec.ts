import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_CONFIG, cloneConfig } from '../../src/experiment/config';
import { solvePlate } from '../../src/solver/modal';
const errors = (page: Page) => {
  const a: string[] = [];
  page.on('pageerror', (e) => a.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') a.push(m.text());
  });
  return a;
};
async function ready(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.lab-canvas canvas')).toHaveAttribute('data-environment', 'hdr');
  await expect(page.locator('.render-error')).toHaveCount(0);
}
async function load(page: Page, count = 2000, duration = 2) {
  const c = cloneConfig(DEFAULT_CONFIG);
  c.grains.count = count;
  c.drive.duration = duration;
  await upload(page, c);
  return c;
}
async function upload(page: Page, config: typeof DEFAULT_CONFIG) {
  await page.getByLabel('세션 파일').setInputFiles({
    name: 'fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schema: 'chladni/4', config, records: [] })),
  });
  await expect(page.locator('.toast')).toContainText('불러왔습니다');
}
async function solve(page: Page) {
  await page.getByRole('button', { name: '스윕 계산', exact: true }).click();
  await expect(page.locator('.compute-status')).toHaveText('판 해석 완료');
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: `artifacts/laboratory-${name}.png` });
}
test('dark laboratory, actual apparatus constraints, physical/display independence and macro shading', async ({
  page,
}) => {
  const errs = errors(page);
  await ready(page);
  const canvas = page.locator('.lab-canvas canvas');
  await expect(page.getByRole('navigation', { name: '작업 공간' }).getByRole('button')).toHaveCount(
    3,
  );
  await expect(page.getByLabel('실험 장치 프로필')).toHaveValue('current');
  expect(await page.locator('body').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
    'rgb(7, 26, 43)',
  );
  await expect(canvas).toHaveAttribute('data-display-count', '20000');
  await shot(page, 'dark');
  await shot(page, 'mixed');
  await expect(canvas).toHaveScreenshot('hero.png', { maxDiffPixelRatio: 0.035 });
  const diameter = await page.getByLabel('규사 평균 입경', { exact: true }).inputValue();
  await page.locator('.particle-display>summary').click();
  await page.getByRole('radio', { name: '실제 크기', exact: true }).check();
  await page.locator('.particle-display>summary').click();
  await shot(page, 'actual-size');
  await page.locator('.particle-display>summary').click();
  await page.getByRole('radio', { name: '관찰용 확대', exact: true }).check();
  await page.locator('.particle-display>summary').click();
  await shot(page, 'observation');
  await page.getByRole('button', { name: '접사', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-lod', 'splats + PBR');
  await shot(page, 'macro');
  await expect(canvas).toHaveScreenshot('macro.png', { maxDiffPixelRatio: 0.04, timeout: 45000 });
  await expect(page.getByLabel('규사 평균 입경', { exact: true })).toHaveValue(diameter);
  await expect(page.locator('.stage')).toHaveAttribute('data-modal-solves', '0');
  await page.locator('.particle-display>summary').click();
  await page.getByLabel('표시 입자 수').selectOption('100000');
  await expect(canvas).toHaveAttribute('data-physical-count', '20000');
  await expect(canvas).toHaveAttribute('data-display-count', '100000');
  expect(errs).toEqual([]);
});
test('sweep, latest frequency response, particle interpolation, analysis and complete research session restore', async ({
  page,
}) => {
  const errs = errors(page);
  await ready(page);
  await load(page, 5000, 8);
  await solve(page);
  await expect(page.locator('.stage')).toHaveAttribute('data-modal-solves', '1');
  await page.locator('.resonance-strip button').first().click();
  await expect(page.locator('.compute-status')).toHaveText('판 해석 완료');
  await page.getByRole('button', { name: '입자 실험', exact: true }).click();
  await expect(page.locator('.motion-result')).toContainText('임계 미도달');
  for (const v of ['280', '290', '249.625']) await page.getByLabel('관찰 주파수').fill(v);
  await expect(page.locator('.compute-status')).toHaveText('판 해석 완료');
  await expect(page.locator('.stage')).toHaveAttribute('data-modal-solves', '1');
  await page.getByRole('button', { name: '입자 실험', exact: true }).click();
  await expect(page.locator('.compute-status')).toHaveText('입자 계산 완료');
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await page.getByRole('slider', { name: '실험 시간', exact: true }).fill('1.025');
  await expect(page.locator('.time-value')).toContainText('1.02');
  await page.getByRole('slider', { name: '실험 시간', exact: true }).fill('8');
  await page.getByRole('button', { name: '수직', exact: true }).click();
  await shot(page, 'formed');
  await page.getByRole('button', { name: '시점 저장', exact: true }).click();
  await page.getByRole('button', { name: '실험 기록', exact: true }).click();
  await page.getByRole('button', { name: '분석', exact: true }).click();
  await page.getByLabel('분석 레이어').selectOption('amplitude');
  await shot(page, 'amplitude');
  await page.getByLabel('계산된 고유모드').check();
  await shot(page, 'mode');
  await expect(page.locator('.particle-caption')).toContainText('고유모드');
  await page.getByLabel('계산된 고유모드').uncheck();
  await page.getByLabel('분석 레이어').selectOption('contour');
  await shot(page, 'contour');
  await page.getByLabel('분석 레이어').selectOption('density');
  await page.getByLabel('조건 비교').selectOption('before');
  await shot(page, 'analysis');
  await page.locator('.export-menu summary').click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: '실험 바이너리 저장', exact: true }).click();
  const file = await dl,
    path = await file.path();
  await page.getByLabel('세션 파일').setInputFiles(path!);
  await expect(page.locator('.toast')).toContainText('불러왔습니다');
  await expect(page.getByLabel('카메라 북마크')).toHaveCount(1);
  await expect(page.locator('.lab-canvas canvas')).toHaveAttribute('data-physical-count', '5000');
  await page.locator('.export-menu summary').click();
  await page.getByRole('button', { name: '실험', exact: true }).click();
  await page.getByLabel('규사 평균 입경', { exact: true }).fill('270');
  await page.getByLabel('규사 평균 입경', { exact: true }).blur();
  await expect(page.getByRole('button', { name: '입자 실험', exact: true })).toBeEnabled();
  await expect(page.locator('.stage')).toHaveAttribute('data-modal-solves', '1');
  expect(errs).toEqual([]);
});
test('as-built measurements persist across profile switches and imported CAD stays a marked reference', async ({
  page,
}) => {
  const errs = errors(page);
  await ready(page);
  await page.getByRole('button', { name: '장치', exact: true }).click();
  await expect(page.getByRole('button', { name: '체결 볼트', exact: true })).toHaveCount(0);
  await page.getByText('장치 기록·측정값', { exact: true }).click();
  await page.getByLabel('장치 판 가로', { exact: true }).fill('320');
  await page.getByRole('button', { name: '장치 기록 적용', exact: true }).click();
  await expect(page.locator('.scene-values')).toContainText('320');
  await page.getByLabel('장치 프로필', { exact: true }).selectOption('reinforced');
  await page.getByLabel('장치 프로필', { exact: true }).selectOption('current');
  if (!(await page.locator('.device-editor').evaluate((e) => (e as HTMLDetailsElement).open)))
    await page.getByText('장치 기록·측정값', { exact: true }).click();
  await expect(page.getByLabel('장치 판 가로', { exact: true })).toHaveValue('320');
  await page.getByText('사진·CAD 모델 연결', { exact: true }).click();
  await page.getByLabel('장치 3D 모델 파일').setInputFiles('tests/fixtures/device-reference.glb');
  const manifest = {
    source: 'concept',
    reference: 'Synthetic QA geometry, not measured CAD',
    metersPerUnit: 1,
    construction: 'adhesive',
    coordinates: 'Y-up-XZ-plate',
    nodes: { plate: 'plate', coupler: 'coupler', speaker: 'speaker', support: 'support' },
  };
  await page.getByLabel('3D 자산 매핑').fill(JSON.stringify(manifest));
  await page.getByRole('button', { name: '3D 모델 적용', exact: true }).click();
  await expect(page.locator('.stage-source')).toContainText('가져온 구조 참조');
  await shot(page, 'cad-reference');
  await page.getByRole('button', { name: '개념 모델로 돌아가기', exact: true }).click();
  await expect(page.locator('.stage-source')).toContainText('외형 개념');
  expect(errs).toEqual([]);
});
test('connector calibration uses explicitly sourced synthetic fit and held-out validation data', async ({
  page,
}) => {
  const errs = errors(page);
  await ready(page);
  const c = cloneConfig(DEFAULT_CONFIG);
  c.plate.mesh = 4;
  c.grains.count = 100;
  c.drive.duration = 1;
  c.plate.connection = {
    enabled: true,
    kz: 10000,
    krx: 20,
    kry: 30,
    cz: 0.1,
    crx: 0,
    cry: 0,
    mass: 0.001,
    width: 0.03,
    height: 0.03,
    status: 'estimated',
    reference: 'Synthetic QA parameters, not real device measurements',
  };
  const target = cloneConfig(c);
  target.plate.connection!.kz = 20000;
  const frequencies = solvePlate(target.plate).frequencies;
  await upload(page, c);
  await page.getByRole('button', { name: '분석', exact: true }).click();
  await page.getByText('장치 응답 보정', { exact: true }).click();
  await page
    .getByLabel('보정 자료 출처')
    .fill('Synthetic QA generated frequencies; no actual experiment claim');
  await page.getByLabel('보정 주파수 CSV').setInputFiles({
    name: 'synthetic-resonances.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'mode,frequency_hz,role\n3,' +
        frequencies[2] +
        ',fit\n6,' +
        frequencies[5] +
        ',fit\n8,' +
        frequencies[7] +
        ',validation',
    ),
  });
  await page.getByLabel('강성 탐색 하한').fill('5000');
  await expect(page.getByLabel('보정 자료 출처')).toHaveValue(
    'Synthetic QA generated frequencies; no actual experiment claim',
  );
  await page.getByLabel('강성 탐색 상한').fill('40000');
  await page.getByRole('button', { name: '강성 보정 계산', exact: true }).click();
  await expect(page.getByRole('button', { name: '보정 모델 적용', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await shot(page, 'calibration');
  await page.getByRole('button', { name: '보정 모델 적용', exact: true }).click();
  await expect(page.locator('.study-heading')).toContainText('등가 연결부');
  await page.getByRole('button', { name: '실험', exact: true }).click();
  await page.getByRole('button', { name: '분석', exact: true }).click();
  await page.getByText('장치 응답 보정', { exact: true }).click();
  await expect(page.locator('.calibration-result')).toContainText('검증');
  await expect(page.getByRole('button', { name: '원래 모델 복원', exact: true })).toBeEnabled();
  expect(errs).toEqual([]);
});
test('unknown tea values require entry, mass ratio and actual contact calculation remain distinct', async ({
  page,
}) => {
  const errs = errors(page);
  await ready(page);
  await load(page, 80, 0.5);
  await page.getByLabel('첫째 입자 종류').selectOption('tea');
  await expect(page.getByLabel('녹차분말 평균 입경', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: '입자 실험', exact: true })).toBeDisabled();
  await page.getByLabel('녹차분말 평균 입경', { exact: true }).fill('80');
  await page.getByLabel('녹차분말 평균 입경', { exact: true }).blur();
  await page.getByLabel('녹차분말 밀도', { exact: true }).fill('1200');
  await page.getByLabel('녹차분말 밀도', { exact: true }).blur();
  await page.getByLabel('혼합 비율 기준').selectOption('mass');
  await page.locator('.particle-model>summary').click();
  await page.getByLabel('입자 운동 모델', { exact: true }).selectOption('contact');
  await page.getByLabel('관찰 주파수').fill('100');
  await solve(page);
  await page.getByRole('button', { name: '입자 실험', exact: true }).click();
  await expect(page.locator('.compute-status')).toHaveText('입자 계산 완료');
  await expect(page.locator('.stage-source')).toContainText('구형 접촉');
  await shot(page, 'contact');
  expect(errs).toEqual([]);
});
test('cinematic controls, stored views, section/ghost, context recovery and real presentation fullscreen', async ({
  page,
}) => {
  const errs = errors(page);
  await ready(page);
  await page.getByRole('button', { name: '시점 저장', exact: true }).click();
  await page.getByRole('button', { name: '장치', exact: true }).click();
  await page.getByRole('button', { name: '장면 연출', exact: true }).click();
  await page.getByLabel('연출 시퀀스').selectOption('exploded');
  await page.getByLabel('연출 타임라인').fill('9');
  const a = (await page.locator('.stage').boundingBox())!,
    b = (await page.locator('.director-controls').boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
  await shot(page, 'exploded');
  const canvas = page.locator('.lab-canvas canvas'),
    rect = (await canvas.boundingBox())!;
  await page.mouse.move(rect.x + rect.width * 0.7, rect.y + rect.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.8, rect.y + rect.height * 0.65, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.director-controls')).toContainText('직접 조작');
  await page.getByRole('button', { name: '연출 정지', exact: true }).click();
  await page.getByRole('button', { name: '연출 도구 닫기', exact: true }).click();
  await page.getByLabel('장비 보기').selectOption('cutaway');
  await shot(page, 'cutaway');
  await page.getByLabel('장비 보기').selectOption('section');
  await page.getByLabel('단면 축').selectOption('x');
  await shot(page, 'section');
  await page.getByLabel('장비 보기').selectOption('ghost');
  await shot(page, 'ghost');
  await page.getByLabel('장비 보기').selectOption('assembled');
  const supported = await canvas.evaluate((c) => {
    const ext = (c as HTMLCanvasElement).getContext('webgl2')?.getExtension('WEBGL_lose_context');
    (window as unknown as { loss: unknown }).loss = ext;
    ext?.loseContext();
    return !!ext;
  });
  expect(supported).toBe(true);
  await expect(page.locator('.lab-canvas')).toHaveAttribute('data-context-state', 'lost');
  await page.evaluate(() => {
    (window as unknown as { loss: { restoreContext: () => void } }).loss.restoreContext();
  });
  await expect(page.locator('.lab-canvas')).toHaveAttribute('data-context-state', 'ready');
  await expect(page.locator('.lab-canvas canvas')).toHaveAttribute('data-environment', 'hdr');
  await expect(page.locator('.render-error')).toHaveCount(0);
  await page.locator('.export-menu summary').click();
  await page
    .locator('.export-menu')
    .getByRole('button', { name: '발표 화면', exact: true })
    .click();
  await expect(page.locator('.app-header')).not.toBeVisible();
  await shot(page, 'presentation');
  await page.getByRole('button', { name: '발표 종료', exact: true }).click();
  await expect(page.locator('.app-header')).toBeVisible();
  expect(errs).toEqual([]);
});
test('stored scientific results and all local renderer assets reload offline', async ({
  page,
  context,
}) => {
  const errs = errors(page);
  await ready(page);
  await load(page, 300, 0.5);
  await solve(page);
  await page.getByRole('button', { name: '입자 실험', exact: true }).click();
  await expect(page.locator('.compute-status')).toHaveText('입자 계산 완료');
  await page.getByRole('button', { name: '실험 기록', exact: true }).click();
  await expect(page.locator('.offline-status')).toHaveText('오프라인 준비됨');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.locator('.export-menu summary').click();
  await page.getByRole('button', { name: '이 기기에 보관', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('보관했습니다');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.lab-canvas canvas')).toHaveAttribute('data-environment', 'hdr');
  await page.locator('.export-menu summary').click();
  await page.getByRole('button', { name: '기기 기록 불러오기', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('보관한 세션');
  await expect(page.locator('.lab-canvas canvas')).toHaveAttribute('data-physical-count', '300');
  await context.setOffline(false);
  expect(errs).toEqual([]);
});
test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  test('dark tools and low quality remain readable without changing research count', async ({
    page,
  }) => {
    await ready(page);
    await shot(page, 'mobile');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: '실험 조건', exact: true }).click();
    await expect(page.getByLabel('실험 장치 프로필')).toBeVisible();
    await page.getByRole('button', { name: '설정 닫기', exact: true }).click();
    await page.locator('.export-menu summary').click();
    await page.getByRole('button', { name: '저사양 표시', exact: true }).click();
    await expect(page.locator('.lab-canvas canvas')).toHaveAttribute('data-quality', 'low');
    await expect
      .poll(() =>
        page
          .locator('.lab-canvas canvas')
          .evaluate((c: HTMLCanvasElement) => c.width / c.clientWidth),
      )
      .toBe(1);
    await page.locator('.export-menu summary').click();
    await shot(page, 'mobile-low');
    await expect(page.locator('.lab-canvas canvas')).toHaveAttribute(
      'data-physical-count',
      '20000',
    );
  });
});

test('cancellation, workspace changes and conditions-only imports cannot retain stale particle results', async ({
  page,
}) => {
  const errs = errors(page);
  await ready(page);
  const c = await load(page, 50000, 20);
  await solve(page);
  await page.getByRole('button', { name: '입자 실험', exact: true }).click();
  await page.getByRole('button', { name: '분석', exact: true }).click();
  await page.getByRole('button', { name: '계산 취소', exact: true }).click();
  await page.getByRole('button', { name: '실험', exact: true }).click();
  await expect(page.locator('.compute-status')).toHaveText('중지됨');
  c.grains.count = 100;
  c.drive.duration = 0.5;
  await upload(page, c);
  await solve(page);
  await page.getByRole('button', { name: '입자 실험', exact: true }).click();
  await expect(page.locator('.compute-status')).toHaveText('입자 계산 완료');
  await expect(page.locator('.time-value')).toContainText('0.5');
  await upload(page, c);
  await expect(page.locator('.compute-status')).toContainText('조건 불러옴');
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeDisabled();
  await solve(page);
  await expect(page.locator('.stage')).toHaveAttribute('data-modal-solves', '1');
  expect(errs).toEqual([]);
});
