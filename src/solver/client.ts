import { plateKey } from '../experiment/config';
import type { Config, ModalResult } from '../experiment/types';
import type { JobKind, SolverKernel } from './kernel';
type Result = ReturnType<SolverKernel['execute']>;
export class SolverClient {
  worker: Worker | null = null;
  sequence = 0;
  active: { reject: (e: Error) => void } | null = null;
  modes = new Map<string, ModalResult>();
  stats = { modalSolves: 0, modalReuses: 0 };
  seed(m: ModalResult) {
    this.modes.set(plateKey(m.plate), m);
    if (this.modes.size > 3) this.modes.delete(this.modes.keys().next().value!);
  }
  cancel() {
    this.sequence++;
    if (this.active) {
      this.active.reject(new Error('cancelled'));
      this.worker?.terminate();
      this.worker = null;
      this.active = null;
    }
  }
  dispose() {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
  request(
    kind: JobKind,
    config: Config,
    progress: (stage: string, value: number) => void,
  ): Promise<Result> {
    this.cancel();
    const id = ++this.sequence,
      modal = this.modes.get(plateKey(config.plate));
    if (modal) this.stats.modalReuses++;
    if (!this.worker)
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    return new Promise((resolve, reject) => {
      this.active = { reject };
      this.worker!.onerror = () => {
        this.active = null;
        this.worker?.terminate();
        this.worker = null;
        reject(new Error('계산 작업을 시작하지 못했습니다.'));
      };
      this.worker!.onmessage = (event) => {
        const d = event.data;
        if (d.id !== id || this.sequence !== id) return;
        if (d.kind === 'progress') {
          progress(d.stage, d.value);
          return;
        }
        this.active = null;
        if (d.kind === 'error') {
          reject(new Error(d.message));
          return;
        }
        if (!modal) this.stats.modalSolves++;
        this.seed(d.modal);
        resolve(d);
      };
      this.worker!.postMessage({ id, kind, config, modal });
    });
  }
}
