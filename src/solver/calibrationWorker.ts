import { calibrateConnection, type CalibrationRequest } from './calibration';
self.onmessage = (event: MessageEvent<CalibrationRequest>) => {
  try {
    const result = calibrateConnection(event.data, (value) =>
      self.postMessage({ kind: 'progress', value }),
    );
    self.postMessage({ kind: 'done', result });
  } catch (e) {
    self.postMessage({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
