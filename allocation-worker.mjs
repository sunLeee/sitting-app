import { allocateSeats } from './matching.mjs';
import { allocateRandomSeats } from './random-allocation.mjs';

self.onmessage = ({ data }) => {
  try {
    const result = data.mode === 'random'
      ? allocateRandomSeats(data)
      : allocateSeats({ ...data, onProgress: progress => self.postMessage({ type: 'progress', progress }) });
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({ type: 'error', error: error.message });
  }
};
