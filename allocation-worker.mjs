import { allocateSeats } from './matching.mjs';

self.onmessage = ({ data }) => {
  try {
    const result = allocateSeats({ ...data, onProgress: progress => self.postMessage({ type: 'progress', progress }) });
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({ type: 'error', error: error.message });
  }
};
