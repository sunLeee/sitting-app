import { INITIAL_PARTICIPANTS, SEATS } from './data.mjs';
import { validatePreferences } from './matching.mjs';

export const DEFAULT_RANDOM_SEED = 'jari-random-2026-10-28';

function randomFor(seed) {
  let value = 2166136261;
  for (const character of seed) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let n = Math.imul(value ^ (value >>> 15), 1 | value);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRandomPreferences(participants = INITIAL_PARTICIPANTS, seats = SEATS, seed = DEFAULT_RANDOM_SEED) {
  if (!Array.isArray(participants) || !Array.isArray(seats)) throw new Error('참여자와 좌석 목록은 배열이어야 합니다.');
  if (typeof seed !== 'string' || !seed.trim() || seed.length > 128) throw new Error('랜덤 시드는 1~128자의 문자열이어야 합니다.');
  const ids = seats.map(seat => seat?.id).sort();
  const preferences = Object.fromEntries(participants.map(person => {
    const random = randomFor(JSON.stringify([seed, person?.id]));
    const ranking = [...ids];
    for (let i = ranking.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [ranking[i], ranking[j]] = [ranking[j], ranking[i]];
    }
    return [person?.id, ranking];
  }));
  const validation = validatePreferences(participants, seats, preferences);
  if (!validation.valid) throw new Error(validation.errors.join('\n'));
  return preferences;
}
