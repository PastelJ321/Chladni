export const MODES = [
  { id: 'm13', m: 1, n: 3, frequency: 256, name: '대각선과 곡선' },
  { id: 'm24', m: 2, n: 4, frequency: 438, name: '네 개의 고리' },
  { id: 'm35', m: 3, n: 5, frequency: 684, name: '교차하는 마디' },
  { id: 'm46', m: 4, n: 6, frequency: 1024, name: '조밀한 대칭' },
] as const;
export type Mode = (typeof MODES)[number];
export type ViewId =
  | 'hero'
  | 'exploded'
  | 'assembly'
  | 'cutaway'
  | 'section'
  | 'ghost'
  | 'mechanism'
  | 'motion'
  | 'causal'
  | 'mode'
  | 'heatmap'
  | 'contour'
  | 'trace'
  | 'vector'
  | 'compare'
  | 'before'
  | 'timeline';
export type Category = 'explore' | 'analyze' | 'compare';
export type PartId = 'plate' | 'bolt' | 'coupler' | 'speaker' | 'support' | 'particles';
export type ParticleKind = 'sand' | 'salt' | 'mixture';
export type CompareKind = 'experiment' | 'frequency' | 'inverse';
export type CameraPreset = 'hero' | 'top' | 'macro' | 'section';

export const VIEWS: {
  id: ViewId;
  category: Category;
  label: string;
  english: string;
  description: string;
}[] = [
  {
    id: 'hero',
    category: 'explore',
    label: '장비 전경',
    english: 'The instrument',
    description: '중앙 구동 방식의 진동판과 입자 패턴을 살펴보세요.',
  },
  {
    id: 'exploded',
    category: 'explore',
    label: '분해도',
    english: 'Exploded view',
    description: '입자부터 구동부까지, 부품 사이의 연결을 펼쳐 봅니다.',
  },
  {
    id: 'assembly',
    category: 'explore',
    label: '조립 과정',
    english: 'Assembly sequence',
    description: '타임라인을 움직여 아래에서 위로 조립해 보세요.',
  },
  {
    id: 'cutaway',
    category: 'explore',
    label: '부분 절개',
    english: 'Cutaway',
    description: '구동부의 한쪽을 열어 코일과 자석의 위치를 확인합니다.',
  },
  {
    id: 'section',
    category: 'explore',
    label: '단면',
    english: 'Section A—A',
    description: '중앙 축을 따라 장비를 잘라 연결 구조를 살펴봅니다.',
  },
  {
    id: 'ghost',
    category: 'explore',
    label: '투시',
    english: 'Technical reveal',
    description: '외형 너머의 구동부와 진동 전달봉을 함께 봅니다.',
  },
  {
    id: 'mechanism',
    category: 'analyze',
    label: '진동 전달',
    english: 'Energy in motion',
    description: '코일에서 전달봉을 거쳐 진동판으로 이어지는 구동 경로입니다.',
  },
  {
    id: 'motion',
    category: 'analyze',
    label: '진동 확대',
    english: 'Beyond the visible',
    description: '변위를 과장하고 시간을 늦춰 마디와 배를 드러냅니다.',
  },
  {
    id: 'causal',
    category: 'analyze',
    label: '패턴의 형성',
    english: 'From sound to structure',
    description: '입력, 공진, 정상파, 입자 이동, 패턴의 다섯 단계를 따라갑니다.',
  },
  {
    id: 'mode',
    category: 'analyze',
    label: '모드 형상',
    english: 'Mode shapes',
    description: '서로 다른 위상으로 움직이는 영역과 정지한 마디선을 봅니다.',
  },
  {
    id: 'heatmap',
    category: 'analyze',
    label: '진폭 분포',
    english: 'Amplitude field',
    description: '진동 한 주기의 최대 변위를 정규화한 분포입니다.',
  },
  {
    id: 'contour',
    category: 'analyze',
    label: '등고선',
    english: 'Contours of motion',
    description: '마디선과 진폭의 등고선을 같은 표면에서 읽습니다.',
  },
  {
    id: 'trace',
    category: 'analyze',
    label: '입자 궤적',
    english: 'Paths to stillness',
    description: '선택한 입자의 이동 경로를 시간에 따라 추적합니다.',
  },
  {
    id: 'vector',
    category: 'analyze',
    label: '이동 경향',
    english: 'Transport tendency',
    description: '입자 이동 모델의 방향장입니다. 공기 유동 해석은 아닙니다.',
  },
  {
    id: 'compare',
    category: 'compare',
    label: '나란히 비교',
    english: 'Two perspectives',
    description: '실험 기록과 모델, 두 모드, 직접·역 패턴을 비교합니다.',
  },
  {
    id: 'before',
    category: 'compare',
    label: '진동 전·후',
    english: 'Before / after',
    description: '같은 초기 입자 배치에서 시작과 끝을 비교합니다.',
  },
  {
    id: 'timeline',
    category: 'compare',
    label: '시간에 따른 변화',
    english: 'A pattern takes time',
    description: '형성 과정을 재생하거나 원하는 순간으로 돌아갑니다.',
  },
];

export const PARTS: {
  id: PartId;
  label: string;
  material: string;
  detail: string;
  index: string;
}[] = [
  {
    id: 'particles',
    label: '입자',
    material: '규사 / 소금 · 모델',
    detail: '진폭이 작은 영역으로 이동하는 입자의 경향을 나타냅니다.',
    index: '01',
  },
  {
    id: 'plate',
    label: '알루미늄 진동판',
    material: 'Al · 300 × 300 × 2 mm · 설계값',
    detail: '중앙에서 지지·구동되고 가장자리는 자유로운 판입니다.',
    index: '02',
  },
  {
    id: 'bolt',
    label: '중앙 볼트',
    material: '스테인리스 · M6 · 설계값',
    detail: '상·하 와셔 사이에서 판을 전달봉에 체결합니다.',
    index: '03',
  },
  {
    id: 'coupler',
    label: '진동 전달봉',
    material: '절삭 알루미늄',
    detail: '코일 포머에 연결된 어댑터가 축 방향 진동을 판에 전달합니다.',
    index: '04',
  },
  {
    id: 'speaker',
    label: '전자기 구동부',
    material: '페라이트 / 구리 / 고무',
    detail: '고정된 자석과 움직이는 보이스 코일·콘을 구분합니다.',
    index: '05',
  },
  {
    id: 'support',
    label: '지지 구조',
    material: '분체 도장 스틸 / 방진 고무',
    detail: '프레임과 자석을 받칩니다. 판 가장자리에 닿지 않습니다.',
    index: '06',
  },
];

export interface SceneState {
  view: ViewId;
  modeIndex: number;
  frequency: number;
  amplitude: number;
  time: number;
  playing: boolean;
  speed: number;
  explosion: number;
  selectedPart: PartId | null;
  hiddenParts: PartId[];
  particles: boolean;
  nodes: boolean;
  annotations: boolean;
  particleKind: ParticleKind;
  compareKind: CompareKind;
  compareModeIndex: number;
  split: number;
  camera: CameraPreset;
  cameraRevision: number;
  reducedMotion: boolean;
}

export const INITIAL_STATE: SceneState = {
  view: 'hero',
  modeIndex: 1,
  frequency: 438,
  amplitude: 0.68,
  time: 9.6,
  playing: false,
  speed: 1,
  explosion: 1,
  selectedPart: null,
  hiddenParts: [],
  particles: true,
  nodes: false,
  annotations: false,
  particleKind: 'sand',
  compareKind: 'frequency',
  compareModeIndex: 2,
  split: 50,
  camera: 'hero',
  cameraRevision: 0,
  reducedMotion: false,
};

export const CAUSAL_LABELS = ['주파수 입력', '공진 응답', '정상파', '입자 이동', '패턴 형성'];
export const DURATION = 12;
