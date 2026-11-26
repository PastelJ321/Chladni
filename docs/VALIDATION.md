# 통합 개편 검증 기록

2026-11-24. 기준 커밋 `200c7b3`, 기존 로컬 저장소와 `codex/chladni-v0.2` 브랜치를 유지했다. 이전 [v0.4 검증 기록](archive/VALIDATION-v04.md)과 기존 `artifacts/v04-*`는 보존했다.

## 2026-11-26 게시 전 확인

현재 장비·입자 재질, 조명, 카메라 연출, 데이터 색상, High 표시 화질과 UI 개편을 포함한 로컬 변경본을 확인했다. `npm test` 70/70, TypeScript/Vite 빌드, production Chromium 브라우저 흐름 11/11 및 시각 회귀가 통과했다. 변경 파일의 포맷과 `git diff --check`도 확인했다. 기존 연구 계산과 기록을 유지한 채 main과 Pages에 게시한다.

아래 성능표와 Firefox/60초 측정은 이전 통합 개편 당시의 기록이다. 이번 High 화질 설정의 성능 보장으로 일반화하지 않는다.

## 실행 결과

- 수정 전 기준: TypeScript/Vite 빌드, 수치·상태 테스트 36개, Chromium 브라우저 테스트 6개 통과.
- 수정 후 `npm test`: **70/70 통과**. 기존 36개와 연결부 7개, 접촉 7개, 장치 7개, 분석 6개, 통합 기록/출처/프레이밍 7개.
- `npm run build`: TypeScript와 production 빌드 통과. Three.js 청크 586.00 kB의 크기 경고는 남는다. LTC 조명 데이터는 별도 지연 청크다.
- `npm run test:browser`: production preview·Chromium 153·SwiftShader에서 **11/11 통과**. 실제 Worker 계산과 다운로드/재입력, 시각 회귀 기준을 사용했다. 이후 CAD 파일 식별/계층·초기 카메라 복원 보완은 해당 2개 검사로, CSV 출처 보존은 보정/입자 2개 검사로 다시 통과했다.
- `git diff --check`, Prettier 검사 통과. GitHub Actions 워크플로는 없으며 CI 사용량 한도는 코드 오류로 분류하지 않는다.

브라우저 테스트는 기본적으로 빌드 결과의 4173 포트를 사용한다. `CHLADNI_TEST_PRODUCTION=0`은 개발 서버 반복 작업용이며 오프라인 검사는 production에서 실행한다.

## 계산과 상태

| 범위        | 검증한 내용                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 기존 판 FEM | Navier 기준 수렴/잔차, 치수·두께·탄성·밀도 스케일링, 경계/지지/구동 참여·감쇠                                                     |
| 연결부      | 평균 패치 강체 이동·회전, 강성/질량/면적 민감도, SDOF 절대 전달률, 비대각 감쇠 복소 직접해, FEM/응답 캐시 구분                    |
| 강성 보정   | 구간 내 합성 강성 복원, 검증 데이터의 목적함수 제외, 출처/모드 대응, 반전력 입력 검증. 실제 장치 보정 성공을 뜻하지 않음          |
| 접촉        | 폐형식 충격·Coulomb 제한·에너지 수동성, 정지판 무이동, 균일 진동 도약, 해석 경사 구름, 32/64/128 표본 수렴, 예산 초과 거부        |
| 입자·저장   | 시드 재현성, 수/질량·유한성, 실제/표시 독립, 질량/개수 비율, 녹차 미입력 차단, 높이/위치 Float32·과거 세션 왕복                   |
| 연구 지표   | 같은 FEM 장의 저/고진폭 분류, 군별 밀도, TV, ROI 순도/회수율, 빈 분모 처리, 중복 시드 제외 반복 편차                              |
| 출처        | 사진/불확도/관측·보정·북마크 세션 왕복, 메타데이터 수정 시 물리 키와 원자료 불변                                                  |
| 시간·카메라 | 저장 타임스탬프 보간/스크럽·프레임 드롭, 연출/과학 데이터 분리, 입력한 판 높이·크기 프레이밍, 직접 조작 시 인계, 조립 원변환 복귀 |

연결부와 접촉의 식·가정·검증 범위는 [CONNECTOR-MODEL](CONNECTOR-MODEL.md), [CONTACT-MODEL](CONTACT-MODEL.md)에 기록했다. FEM 원래 기준값은 [v02-validation.json](../artifacts/v02-validation.json)에 있다.

## 실제 브라우저 흐름

다크 시작 화면 → 장치/입자 독립 조건 → FEM 스윕 → 공진/주파수 연속 변경 → 입자 계산 → 보간/스크럽 → 분석 레이어·초기/최종 → 기록·바이너리 복원 흐름을 수행했다. 주파수·입경을 바꾼 뒤에도 브라우저 `modalSolves=1`을 확인했다. 무이동 조건은 임계 미달 결과로 남는다.

장치 치수를 입력한 뒤 프로필을 왕복하고 값 보존을 확인했다. 합성 GLB를 출처가 있는 구조 참조로 불러오고 개념 외형으로 복귀했다. 강성 보정은 명시적인 합성 관측 2개와 독립 검증 1개를 사용했으며 화면 전환 후 보정 보고서가 유지됐다.

계산 중 분석 화면으로 이동해 취소하고 재시작했다. 계산 없는 조건 파일을 열면 이전 Run이 제거됐다. WebGL 컨텍스트를 실제 확장으로 강제 손실/복구하고 HDR와 캔버스 복원을 확인했다. 연출 중 드래그 인계, 분해/단면/투시, 실제 Fullscreen API 진입·종료를 검사했다.

기기 보관한 결과를 네트워크 오프라인 상태에서 새로고침하고 다시 불러왔다. 번들·폰트·HDRI·Worker는 로컬 캐시를 사용했다. 미디어 정합은 합성 색면 이미지와 2초 VP9 테스트 영상으로 검사했다. 네 모서리 보정 후 픽셀 좌표, ROI 수동 기록과 원본 프레임 PNG, 시간 오프셋/파일 참조 보존 및 같은 원본 재연결을 확인했다. 실제 학교 촬영 데이터는 제공되지 않았다.

검사 중 발견하고 수정한 문제: Vite의 `Vary: Origin` 때문에 오프라인 모듈 캐시가 빗나가던 현상, 영상 아래 설명이 모서리 클릭을 가리던 현상, 길어진 분석 설정이 3D 장면을 밀어내던 스크롤, 결과 없는 조건 파일이 같은 물리 키의 이전 Run을 남기던 현상. 보정에서 강성 민감도가 없는 모드는 의도대로 거부했으며 검증용 fixture를 민감한 모드로 바꿨다. 테스트 입력의 허용 시간 범위·실험 화면 전용 상태 셀렉터·생성 영상의 시간축도 바로잡았다.

## 화면 검토

기존 v04의 전경·분포·접사·분석·분해·등고선 6개 파일을 실제로 열고 새 캡처와 비교했다. 밝은 UI를 심해색 계층으로 교체하고, 실제 장치 설명과 다른 판 관통 볼트를 현재 프로필에서 제거했다. 접사 결정의 크기/베벨/법선과 카메라 거리, 구동부 조명·재질, 밝은 판 위 등고선 대비를 수정했다. 연출 도구는 장면 아래에 유지했다. 실측 설정은 별도로 스크롤되어 장면을 보며 영역을 기록할 수 있다. 발표 화면에서 도구/표시가 겹치던 위치도 조정했다.

| 장면                          | 캡처                                                                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 다크 UI·장비 전경             | [dark](../artifacts/laboratory-dark.png)                                                                                                                                                     |
| 실제 크기·관찰 확대·규사/소금 | [actual](../artifacts/laboratory-actual-size.png), [observe](../artifacts/laboratory-observation.png), [mixed](../artifacts/laboratory-mixed.png)                                            |
| 계산 후 분포                  | [formed](../artifacts/laboratory-formed.png), 249.625 Hz·8 s·5,000개 드리프트 근사                                                                                                           |
| FEM 모드·진폭·등고선          | [mode](../artifacts/laboratory-mode.png), [amplitude](../artifacts/laboratory-amplitude.png), [contour](../artifacts/laboratory-contour.png)                                                 |
| 초기/최종 밀도                | [analysis](../artifacts/laboratory-analysis.png)                                                                                                                                             |
| 정밀 분해·절개·단면·투시      | [exploded](../artifacts/laboratory-exploded.png), [cutaway](../artifacts/laboratory-cutaway.png), [section](../artifacts/laboratory-section.png), [ghost](../artifacts/laboratory-ghost.png) |
| 접사·접촉 계산                | [macro](../artifacts/laboratory-macro.png), [contact](../artifacts/laboratory-contact.png)                                                                                                   |
| 합성 보정·CAD 참조            | [calibration](../artifacts/laboratory-calibration.png), [CAD](../artifacts/laboratory-cad-reference.png)                                                                                     |
| 원근/ROI·영상 비교 QA         | [image fixture](../artifacts/research-registration-fixture.png), [video fixture](../artifacts/laboratory-video-comparison-fixture.png)                                                       |
| 발표·모바일                   | [presentation](../artifacts/laboratory-presentation.png), [mobile](../artifacts/laboratory-mobile.png), [low](../artifacts/laboratory-mobile-low.png)                                        |

합성 미디어의 색면/테스트 패턴과 수동 개수는 QA 입력이다. 실험 관찰이나 실제 분리 성공으로 보고하지 않는다. 390×844 DPR 2 모바일 캡처는 뷰포트·가독성·LOD 검사이며 실기 모바일 성능 측정이 아니다.

## 성능

Apple M5 · 17.2 GB · Chromium 153.0.8010.12 · ANGLE Metal. 개발 서버의 1200×700 CSS px 하네스에서 표준 DPR 1.5, 저사양 DPR 1로 18프레임 워밍업 뒤 3.5초씩 측정했다. 자동 품질 변경은 끄고 1초의 실제 계산 기록을 반복 보간했다. GPU 값은 disjoint가 아닌 timer query, FPS는 rAF 간격이다.

| 표시 / 적분      | 시점·품질      |  FPS | 평균/P95 ms | CPU 제출 ms | GPU ms | 주 heap MB | GPU 자산 추정 MB | 호출 |
| ---------------- | -------------- | ---: | ----------: | ----------: | -----: | ---------: | ---------------: | ---: |
| 5,000 / 5,000    | hero·standard  | 60.0 | 16.67/16.70 |        2.20 |   8.89 |       29.1 |             31.7 |   59 |
| 20,000 / 20,000  | hero·standard  | 60.0 | 16.67/16.80 |        2.37 |   9.50 |       59.8 |             32.5 |   59 |
| 50,000 / 50,000  | hero·standard  | 60.0 | 16.67/16.80 |        2.29 |  11.48 |       61.9 |             33.9 |   59 |
| 100,000 / 50,000 | hero·standard  | 60.0 | 16.67/16.80 |        3.59 |  11.00 |       59.3 |             36.4 |   59 |
| 100,000 / 50,000 | hero·low       | 60.0 | 16.67/16.70 |        3.85 |   5.99 |       67.0 |             36.4 |   59 |
| 20,000 / 20,000  | macro·standard | 60.0 | 16.67/16.70 |        3.20 |  12.04 |       33.8 |             32.5 |   43 |

| 표시 / 적분      | 1 s 입자 계산 ms | 기록 MB | JSON MB | 바이너리 MB | JSON/바이너리 내보내기 ms |
| ---------------- | ---------------: | ------: | ------: | ----------: | ------------------------: |
| 5,000 / 5,000    |             58.4 |    1.26 |    2.08 |        1.66 |                  22.2/3.2 |
| 20,000 / 20,000  |            170.8 |    5.04 |    7.80 |        6.13 |                  76.5/8.2 |
| 50,000 / 50,000  |            390.0 |   12.60 |   19.26 |       15.06 |                214.7/20.7 |
| 100,000 / 50,000 |            372.2 |   12.60 |   19.26 |       15.06 |                194.4/19.8 |

100k 표시는 50k 직접 적분의 대표 확장이다. 연구 통계/질량에 추가 표시는 포함하지 않는다. GPU 자산은 geometry·texture·그림자/깊이의 추정이며 프레임버퍼·드라이버·전역 LTC를 제외한다. heap은 주 스레드 표본으로 Worker와 전체 프로세스 메모리가 아니다. 해제 후 Three 내부 계수는 모든 조건에서 geometry 1·texture 3으로 같았다. MB는 10⁶ bytes다.

전체 앱은 1600×1000 창, 1230×713 CSS px 캔버스, DPR 1.5, 20k 입자에서 각각 3.5초 측정했다. Glass·React·분석 갱신을 포함한다.

| 전체 앱 |  FPS | 평균/P95 ms | 주 heap MB |
| ------- | ---: | ----------: | ---------: |
| 실험    | 58.3 | 17.15/16.70 |      116.8 |
| 분석    | 60.0 | 16.67/16.70 |      124.7 |

독립 구 접촉 모델은 249.625 Hz·0.5 s·3,995 substeps에서 추가 측정했다.

| 적분 수 | 계산 ms | Worker 왕복 ms | 기록 MB | 최대 관통 µm |
| ------- | ------: | -------------: | ------: | -----------: |
| 100     |    79.6 |           85.0 |  0.0976 |         29.6 |
| 500     |   271.4 |          274.3 |  0.4880 |         32.8 |

접촉 관통은 시간 이산화 오차이며 실물 정확도를 뜻하지 않는다. 별도 수렴 검증 없는 실험 조건의 도약/분리 정확도를 보장하지 않는다.

production 앱에서 8초 결과를 6회, 총 약 60초 재생했다. 각 10초 구간은 약 60.0fps, GC 후 주 heap 63.2–64.5 MB였다. 끝 두 표본은 63.542→63.543 MB, 캔버스 1개·적분 수 20k·modalSolves=1·페이지/콘솔 오류 0개를 유지했다. 이는 짧은 안정성 검사이며 장시간 열화/누수 인증이 아니다.

[GPU/계산 원시 JSON](../artifacts/laboratory-performance-metal.json) · [60초 안정성 JSON](../artifacts/laboratory-stability-metal.json). 재현: 개발 서버를 켠 뒤 `CHLADNI_BASE_URL=http://127.0.0.1:해당포트 npm run benchmark`, production preview에서 `npm run test:stability`. 실행 파일이 기본 캐시 경로와 다르면 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`를 지정한다.

## 브라우저 및 남은 범위

Firefox 159.0에서도 실제 WebGL 초기화, Worker FEM/입자 계산, 분석 등고선, 장치 절개, 창 크기 변경과 JSON 다운로드가 통과했다. headless 검사에서 `webgl.force-enabled`를 사용했다. [원시 결과](../artifacts/laboratory-firefox-smoke.json), [실제 화면](../artifacts/laboratory-firefox.png). 시스템에 있던 구 Firefox는 Playwright 프로토콜과 맞지 않아 도구가 요구하는 런타임을 설치했다. 이 도구 오류를 앱의 Firefox 실패로 보고하지 않는다.

Safari와 실기 모바일, 저사양 노트북의 GPU/열화는 미검증이다. 60초 반복 재생은 수 시간의 발표 안정성을 보증하지 않는다. 현재 환경의 M5 수치를 모든 데스크톱 성능으로 일반화하지 않는다.

- 실제 장치 치수·스피커 전달함수·접착층 물성·사진/CAD·실측 반복 자료는 미제공이다. 기본 판 치수와 외형은 설계/개념이고 미입력 값은 미보정 상태다.
- 등가 연결부는 선형 수직/회전 스프링·감쇠·질량이며 접착 파괴·기울기 중력 프리로드·동적 흔들림을 계산하지 않는다.
- 입자는 비보정 드리프트 또는 독립 구 접촉이다. 입자 간 DEM·구름 저항·응집·실제 결정 접촉·공기 속도장은 없다. 역패턴과 실물 분리 효율은 검증되지 않았다.
- 스윕은 33개 준정상 복소 장의 보간이다. 급속 chirp의 판 과도응답이나 적응 공진 추적이 아니다.
- GLB는 실제로 불러오는 구조 참조이고 자동 FEM 메시 생성은 아니다. 절단면 cap, 광학 DOF/정확한 유리 굴절, 앱 내 영상 녹화는 없다.
- 큰 영상/CAD는 원본 재연결이 필요하다. 바이너리는 전체 파일을 한 번에 읽으며 256 MB 입력 상한이 있다. 다중 대용량 기록의 메인 스레드 JSON 직렬화는 조작을 잠시 멈출 수 있다. Float32 기록은 원본 고정밀 연속 궤적과 동일하지 않다.

## 변경 파일 묶음

장치/계산: `experiment/device.ts`, `types.ts`, `config.ts`, `useExperiment.ts`, `solver/connector.ts`, `modal.ts`, `compliantResponse.ts`, `response.ts`, `calibration.ts`, `calibrationWorker.ts`, `simulation/contact.ts`, `particles.ts`.

분석/기록: `analysis/metrics.ts`, `registration.ts`, `observationTypes.ts`, `io/session.ts`, `ui/ResearchTools.tsx`, `RegisteredMedia.tsx`, `AnalysisTools.tsx`, `CalibrationPanel.tsx`, `DeviceProfilePanel.tsx`.

장면/제품: `render/LabRenderer.ts`, `LabViewport.tsx`, `CameraRig.ts`, `ParticleRenderer.ts`, `scene/instrument.ts`, `plateGeometry.ts`, `materials.ts`, `deviceAsset.ts`, `assetContract.ts`, `animation/director.ts`, `App.tsx`, UI 스타일, `presentation/session.ts`, `offline-plugin.ts`.

검증: 수치 테스트 5개 파일, 브라우저 2개 파일, 이전 v04 테스트/스냅샷 보존, `benchmarks/renderer.ts`, `scripts/benchmark.mjs`, `stability.mjs`, `firefox-smoke.mjs`와 `artifacts/laboratory-*`.
