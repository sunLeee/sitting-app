import { PARTS } from './data.mjs';
import { DEFAULT_SEED } from './matching.mjs';

function randomFor(seed) {
  let value = 2166136261;
  for (const character of JSON.stringify(seed)) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let n = Math.imul(value ^ (value >>> 15), 1 | value);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function validateInputs(participants, seats, seed) {
  if (!Array.isArray(participants) || !Array.isArray(seats)) throw new Error('참가자와 좌석 목록은 배열이어야 합니다.');
  if (!participants.length || !seats.length) throw new Error('참가자와 좌석이 각각 한 개 이상 필요합니다.');
  if (participants.length > seats.length) throw new Error('참가자 수가 좌석 수보다 많습니다.');
  if (typeof seed !== 'string' && (typeof seed !== 'number' || !Number.isFinite(seed))) throw new Error('추첨 시드는 문자열 또는 유한한 숫자여야 합니다.');
  const participantIds = new Set();
  for (const person of participants) {
    if (!person || typeof person.id !== 'string' || !person.id.trim()) throw new Error('모든 참가자에게 유효한 문자열 ID가 필요합니다.');
    if (participantIds.has(person.id)) throw new Error(`참가자 ID 중복: ${person.id}`);
    participantIds.add(person.id);
    if (!Object.hasOwn(PARTS, person.part)) throw new Error(`알 수 없는 파트: ${person.id}`);
  }
  const seatIds = new Set();
  for (const seat of seats) {
    if (!seat || typeof seat.id !== 'string' || !seat.id.trim()) throw new Error('모든 좌석에 유효한 문자열 ID가 필요합니다.');
    if (seatIds.has(seat.id)) throw new Error(`좌석 ID 중복: ${seat.id}`);
    seatIds.add(seat.id);
    if (!['A', 'B', 'C'].includes(seat.zone)) throw new Error(`알 수 없는 좌석 구역: ${seat.id}`);
    if (!Number.isFinite(seat.x) || !Number.isFinite(seat.y)) throw new Error(`좌석 좌표 오류: ${seat.id}`);
  }
}

// Every participant receives a distinct shuffled seat; preferences and parts
// do not affect selection. Part distances describe the outcome only.
export function allocateRandomSeats({ participants, seats, seed = DEFAULT_SEED } = {}) {
  validateInputs(participants, seats, seed);
  const compareIds = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const people = [...participants].sort(compareIds);
  const places = [...seats].sort(compareIds);
  const distances = places.map(a => places.map(b => Math.hypot(a.x - b.x, a.y - b.y)));
  if (distances.some(row => row.some(distance => !Number.isFinite(distance)))) throw new Error('좌석 사이 거리를 계산할 수 없습니다.');
  const shuffled = places.map((_, index) => index);
  const random = randomFor(seed);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  let totalDistance = 0;
  let pairCount = 0;
  for (let a = 0; a < people.length; a++) {
    for (let b = a + 1; b < people.length; b++) {
      if (people[a].part === people[b].part) {
        totalDistance += distances[shuffled[a]][shuffled[b]];
        pairCount++;
      }
    }
  }
  if (!Number.isFinite(totalDistance)) throw new Error('파트별 거리 합을 계산할 수 없습니다.');
  return {
    assignments: people.map((person, index) => ({ participantId: person.id, seatId: places[shuffled[index]].id, rank: null })),
    seed,
    mode: 'random',
    metrics: {
      totalDistance,
      averageDistance: pairCount ? totalDistance / pairCount : 0,
      averageRank: null,
      top3Count: null,
      matchedCount: people.length,
      vacancies: places.length - people.length,
      candidateCount: 1,
    },
    seatPriorities: null,
    anchors: null,
  };
}
