import { solvePlate } from './modal';
import { frequencySweep, responseField } from './response';
import { simulateParticles } from '../simulation/particles';
import { plateKey, responseKey, sweepKey, validateConfig } from '../experiment/config';
import type { Config, ModalResult, Field, Sweep } from '../experiment/types';
export type JobKind = 'solve' | 'field' | 'run';
/** Pure calculation service used by the persistent Worker and numerical tests. */
export class SolverKernel {
  modes = new Map<string, ModalResult>();
  fields = new Map<string, Field>();
  sweeps = new Map<string, Sweep>();
  stats = { modalSolves: 0, modalHits: 0, responseHits: 0 };
  execute(
    kind: JobKind,
    config: Config,
    progress: (stage: string, value: number) => void = () => {},
    seed?: ModalResult,
  ) {
    validateConfig(config);
    const key = plateKey(config.plate);
    if (seed && plateKey(seed.plate) === key && !this.modes.has(key))
      this.modes.set(key, seed.key === key ? seed : { ...seed, key });
    if (this.modes.size > 3) this.modes.delete(this.modes.keys().next().value!);
    let modal = this.modes.get(key);
    if (!modal) {
      modal = solvePlate(config.plate, (v) => progress('판 고유모드 계산', v * 0.55));
      this.modes.set(key, modal);
      this.stats.modalSolves++;
      if (this.modes.size > 3) this.modes.delete(this.modes.keys().next().value!);
    } else this.stats.modalHits++;
    if (kind === 'run')
      return {
        kind: 'run' as const,
        run: simulateParticles(config, modal, (v) => progress('입자 시간 적분', v)),
        modal,
        stats: { ...this.stats },
      };
    const fk = responseKey(config);
    let field = this.fields.get(fk);
    if (!field) {
      field = responseField(modal, config);
      this.fields.set(fk, field);
      if (this.fields.size > 24) this.fields.delete(this.fields.keys().next().value!);
    } else this.stats.responseHits++;
    if (kind === 'field') return { kind: 'field' as const, modal, field, stats: { ...this.stats } };
    progress('주파수 응답 계산', 0.7);
    const sk = sweepKey(config);
    let sweep = this.sweeps.get(sk);
    if (!sweep) {
      sweep = frequencySweep(modal, config);
      this.sweeps.set(sk, sweep);
      if (this.sweeps.size > 4) this.sweeps.delete(this.sweeps.keys().next().value!);
    }
    return { kind: 'solved' as const, modal, field, sweep, stats: { ...this.stats } };
  }
}
