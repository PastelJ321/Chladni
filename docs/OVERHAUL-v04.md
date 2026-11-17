# v0.4 코드 감사와 변경 기록

2026-11-17. 기준 897b04d. 기존 로컬 저장소와 요청 브랜치 codex/chladni-v0.2를 유지했다. 지정된 렌더러·카메라·솔버·입자·설정·기구·연출·CSS 파일 및 v03 스크린샷 6장을 검토했다.

| 문제                              | 실제 변경                                                                |
| --------------------------------- | ------------------------------------------------------------------------ |
| 최근접 20 Hz 프레임               | 시간 기반 보간, GPU 끝점 재사용, 절대 재생 시계                          |
| Worker 재생성으로 캐시 소실       | Persistent Worker + 명시적 모드 캐시, 물리/응답 키 분리                  |
| 33단계 스윕장 전환                | 실수·허수 보간 후 가속도 에너지 계산                                     |
| 작고 희미한 1,800개 메시          | 기본 20k, 실제/관찰 크기 분리, 스플랫/PBR                                |
| 모든 입자의 CPU 행렬 갱신         | 정적 속성·동적 끝점 분리, 최대 100k 대표 표시                            |
| 숫자 배열 기록 비용               | Float32 기록/전송, 기록 예산, 바이너리 파일                              |
| 판 정점·법선·색상/오버레이 재생성 | 공유 GPU 장, 레이어 캐시, 캡처 전용 경로                                 |
| RoundedBox 판의 큰 면 삼각형      | 스크린샷에서 판/입자 변위 불일치 발견, 내부 정점 메시와 회귀 테스트 추가 |
| 단순 부품·굵은 금속 줄무늬        | 베벨·소켓·와셔·프레임·콘 두께, 미세 선형 데이터 맵과 HDR                 |
| 장면을 가리는 연출·나열형 폼      | 장면 아래 도크, 두 입자군 카드, 실버/그라파이트 위계                     |
| 모든 입자 PBR의 접사 부담         | 최소 카메라 거리 수정, 가시 입자 선택·군별 4096개 예산                   |

BFS 요소·기준식·24모드 계산, 기존 연구 데이터·개념 모델·실측 비교를 보존했다. 기존 27개 수치·상태 테스트에 9개를 추가했다. 이전 UI 테스트는 tests/legacy/v03-browser.spec.ts에 보존했다.

계산 수명은 solver/client와 kernel, 과학 시간은 simulation/clock, GPU 계층은 render/PlateField·ParticleRenderer·quality, 독립 물성/표현은 particles/presets, 기록은 io/arrays로 분리했다. Three.js 객체는 연구 데이터의 원본이 아니다.

WebGPU는 검토했으나 현재 ShaderMaterial/onBeforeCompile 경로의 전환 비용 때문에 도입하지 않았다. [Three.js 공식 전환 안내](https://threejs.org/manual/pages/webgpurenderer)를 기준으로 WebGL 2를 유지한다. WebGPU 폴백을 구현했다고 표시하지 않는다.

후속: 실측 스피커 응답/이동 계수 보정, 실제 CAD, 원근 정합, 적응적 스윕, 접촉·공기 모델, 장시간 기록 부분 로드, Worker 내보내기, Safari/실기 모바일 검증. 실제 역 클라드니·분리 효율 예측이나 장비 디지털 트윈은 완성하지 않았다.

## 주요 변경 파일

| 범위         | 파일                                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 계산 수명·키 | src/experiment/useExperiment.ts, config.ts, types.ts; src/solver/client.ts, kernel.ts, worker.ts, response.ts                                                           |
| 입자·재생    | src/simulation/particles.ts, clock.ts; src/particles/presets.ts                                                                                                         |
| GPU          | src/render/LabRenderer.ts, PlateField.ts, ParticleRenderer.ts, CameraRig.ts, quality.ts                                                                                 |
| 기구·재질    | src/scene/instrument.ts, plateGeometry.ts, materials.ts; public/environment/                                                                                            |
| 화면·연출    | src/App.tsx; src/ui/ConfigurationPanel.tsx, ParticleDisplay.tsx, AnalysisTools.tsx, DirectorControls.tsx, styles/focused.css; src/animation/director.ts, useDirector.ts |
| 기록·분석    | src/io/session.ts, arrays.ts; src/analysis/metrics.ts                                                                                                                   |
| 검증         | tests/overhaul.test.ts, focused.test.ts, research.test.ts, browser/overhaul.spec.ts; benchmarks/, scripts/benchmark.mjs, playwright.config.ts, tsconfig.json            |
| 산출물       | artifacts/v04-*.png, v04-performance-metal.json; README.md, docs/DESIGN.md, VALIDATION.md, archive/v03 문서                                                             |

표시 확대에서 클리핑으로 배율이 달라지지 않게 하고, 메시/등고선/궤적도 공통 GPU 변위장에 연결했다. 해제 시 중복 material/geometry dispose를 피하고 그림자와 컨텍스트를 정리한다.
