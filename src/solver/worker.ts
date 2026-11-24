import { SolverKernel, type JobKind } from './kernel';
import type { Config, ModalResult } from '../experiment/types';
const kernel = new SolverKernel();
self.onmessage = (
  event: MessageEvent<{ id: number; kind: JobKind; config: Config; modal?: ModalResult }>,
) => {
  const { id, kind, config, modal } = event.data;
  try {
    const result = kernel.execute(
      kind,
      config,
      (stage, value) => self.postMessage({ id, kind: 'progress', stage, value }),
      modal,
    );
    // Transfer typed recordings rather than cloning every sample back to the UI thread.
    const transfer: Transferable[] = [];
    if (result.kind === 'run')
      for (const f of result.run.frames) {
        if (f.positions instanceof Float32Array) transfer.push(f.positions.buffer);
        if (f.distance instanceof Float32Array) transfer.push(f.distance.buffer);
        if (f.heights instanceof Float32Array) transfer.push(f.heights.buffer);
      }
    self.postMessage({ id, ...result }, { transfer });
  } catch (e) {
    self.postMessage({ id, kind: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
