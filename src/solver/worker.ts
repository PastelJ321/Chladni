import { solvePlate } from './modal';
import { frequencySweep, responseField } from './response';
import { simulateParticles } from '../simulation/particles';
import { plateKey, validateConfig } from '../experiment/config';
import type { Config, ModalResult } from '../experiment/types';
let cached: ModalResult | null = null;
self.onmessage = (event: MessageEvent<{ id: number; kind: 'solve' | 'run'; config: Config }>) => {
  const { id, kind, config } = event.data;
  try {
    validateConfig(config);
    const progress = (stage: string, value: number) =>
      self.postMessage({ id, kind: 'progress', stage, value });
    if (!cached || cached.key !== plateKey(config.plate))
      cached = solvePlate(config.plate, (v) => progress('강성·질량 행렬 / 고유치', v * 0.5));
    if (kind === 'run') {
      const run = simulateParticles(config, cached, (v) => progress('입자 시간 적분', v));
      self.postMessage({ id, kind: 'run', run });
    } else {
      progress('주파수 응답', 0.65);
      const sweep = frequencySweep(cached, config),
        field = responseField(cached, config);
      self.postMessage({ id, kind: 'solved', modal: cached, sweep, field });
    }
  } catch (error) {
    self.postMessage({
      id,
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
