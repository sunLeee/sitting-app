/**
 * Applicant-proposing Gale–Shapley seating allocation.
 * Distance mode searches distinct spatial anchors for the three parts, then
 * chooses the smallest actual within-part distance among those stable results
 * and the seeded baseline. This is not a proof of a global distance optimum.
 * Every candidate has its own receiver priorities and is stable under them.
 */
const PARTS = ['data', 'dispatch', 'map'];
export const DEFAULT_SEED = 'seating-2026';

export function validatePreferences(participants, seats, preferences) {
  const errors = [];
  if (!Array.isArray(participants)) errors.push('참가자 목록은 배열이어야 합니다.');
  if (!Array.isArray(seats)) errors.push('좌석 목록은 배열이어야 합니다.');
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    errors.push('지망 목록은 참가자 ID를 키로 하는 객체여야 합니다.');
  }
  if (errors.length) return { valid: false, errors };
  if (!participants.length) errors.push('참가자가 한 명 이상 필요합니다.');
  if (!seats.length) errors.push('좌석이 한 개 이상 필요합니다.');
  if (participants.length > seats.length) errors.push('참가자 수가 좌석 수보다 많습니다.');
  const participantIds = new Set();
  for (const participant of participants) {
    if (!participant || typeof participant.id !== 'string' || !participant.id.trim()) {
      errors.push('모든 참가자에게 유효한 문자열 ID가 필요합니다.');
      continue;
    }
    if (participantIds.has(participant.id)) errors.push(`참가자 ID 중복: ${participant.id}`);
    participantIds.add(participant.id);
    if (!PARTS.includes(participant.part)) errors.push(`알 수 없는 파트: ${participant.id}`);
  }
  const seatIds = new Set();
  for (const seat of seats) {
    if (!seat || typeof seat.id !== 'string' || !seat.id.trim()) {
      errors.push('모든 좌석에 유효한 문자열 ID가 필요합니다.');
      continue;
    }
    if (seatIds.has(seat.id)) errors.push(`좌석 ID 중복: ${seat.id}`);
    seatIds.add(seat.id);
    if (!['A', 'B', 'C'].includes(seat.zone)) errors.push(`알 수 없는 좌석 구역: ${seat.id}`);
    if (!Number.isFinite(seat.x) || !Number.isFinite(seat.y)) errors.push(`좌석 좌표 오류: ${seat.id}`);
  }
  for (const participantId of participantIds) {
    const list = Object.hasOwn(preferences, participantId) ? preferences[participantId] : undefined;
    if (!Array.isArray(list)) {
      errors.push(`${participantId}: 지망 목록은 배열이어야 합니다.`);
      continue;
    }
    if (list.length !== seats.length) errors.push(`${participantId}: 모든 ${seats.length}개 좌석의 지망 순위가 필요합니다.`);
    if (new Set(list).size !== list.length) errors.push(`${participantId}: 중복 지망 좌석이 있습니다.`);
    if (Array.from(list).some((id) => !seatIds.has(id))) errors.push(`${participantId}: 알 수 없는 지망 좌석이 있습니다.`);
  }
  for (const id of Object.keys(preferences)) {
    if (!participantIds.has(id)) errors.push(`알 수 없는 참가자의 지망: ${id}`);
  }
  return { valid: errors.length === 0, errors };
}

function prepare(participants, seats, preferences) {
  const validation = validatePreferences(participants, seats, preferences);
  if (!validation.valid) throw new Error(validation.errors.join('\n'));
  const people = [...participants].sort((a, b) => compareIds(a.id, b.id));
  const places = [...seats].sort((a, b) => compareIds(a.id, b.id));
  const seatIndex = new Map(places.map((seat, index) => [seat.id, index]));
  return {
    people,
    places,
    lists: people.map((person) => preferences[person.id].map((id) => seatIndex.get(id))),
    parts: people.map((person) => PARTS.indexOf(person.part)),
  };
}

function compareIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function priorityRanks(people, places, seatPriorities) {
  if (!seatPriorities || typeof seatPriorities !== 'object' || Array.isArray(seatPriorities)) {
    throw new Error('좌석 우선순위는 객체여야 합니다.');
  }
  const personIndex = new Map(people.map((person, index) => [person.id, index]));
  return places.map((seat) => {
    const list = Object.hasOwn(seatPriorities, seat.id) ? seatPriorities[seat.id] : undefined;
    if (!Array.isArray(list) || list.length !== people.length || new Set(list).size !== people.length || Array.from(list).some((id) => !personIndex.has(id))) {
      throw new Error(`${seat.id}: 모든 참가자의 중복 없는 좌석 우선순위가 필요합니다.`);
    }
    const ranks = new Int32Array(people.length);
    list.forEach((id, rank) => { ranks[personIndex.get(id)] = rank; });
    return ranks;
  });
}

// A displaced applicant goes back into the queue and resumes their next choice.
function solve(lists, seatCount, prefers) {
  const holders = new Int32Array(seatCount).fill(-1);
  const assigned = new Int32Array(lists.length).fill(-1);
  const next = new Int32Array(lists.length);
  const queue = Array.from({ length: lists.length }, (_, index) => index);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const person = queue[cursor];
    while (next[person] < seatCount) {
      const seat = lists[person][next[person]++];
      const current = holders[seat];
      if (current === -1 || prefers(seat, person, current)) {
        holders[seat] = person;
        assigned[person] = seat;
        if (current !== -1) {
          assigned[current] = -1;
          queue.push(current);
        }
        break;
      }
    }
  }
  return { assigned, next };
}

function assignmentsFor(context, result) {
  return context.people.flatMap((person, index) => result.assigned[index] < 0 ? [] : [{
    participantId: person.id,
    seatId: context.places[result.assigned[index]].id,
    rank: result.next[index],
  }]);
}

export function galeShapley(participants, seats, preferences, seatPriorities) {
  const context = prepare(participants, seats, preferences);
  const ranks = priorityRanks(context.people, context.places, seatPriorities);
  return assignmentsFor(context, solve(context.lists, seats.length, (seat, person, current) => ranks[seat][person] < ranks[seat][current]));
}

export function findBlockingPairs(participants, seats, preferences, seatPriorities, assignments) {
  const context = prepare(participants, seats, preferences);
  const ranks = priorityRanks(context.people, context.places, seatPriorities);
  if (!Array.isArray(assignments)) throw new Error('배정 목록은 배열이어야 합니다.');
  const people = new Map(context.people.map((person, index) => [person.id, index]));
  const places = new Map(context.places.map((seat, index) => [seat.id, index]));
  const assigned = new Int32Array(context.people.length).fill(-1);
  const holders = new Int32Array(context.places.length).fill(-1);
  for (const entry of assignments) {
    const person = people.get(entry?.participantId);
    const seat = places.get(entry?.seatId);
    if (person === undefined || seat === undefined || assigned[person] !== -1 || holders[seat] !== -1) {
      throw new Error('배정에 알 수 없는 ID 또는 중복 참가자/좌석이 있습니다.');
    }
    assigned[person] = seat;
    holders[seat] = person;
  }
  const pairs = [];
  context.lists.forEach((list, person) => {
    for (const seat of list) {
      if (seat === assigned[person]) break;
      if (holders[seat] === -1 || ranks[seat][person] < ranks[seat][holders[seat]]) {
        pairs.push({ participantId: context.people[person].id, seatId: context.places[seat].id });
      }
    }
  });
  return pairs;
}

// Stable hashing avoids Math.random and preserves results when input order changes.
function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  }
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}

function seededRanks(context, seed) {
  return context.places.map((seat) => {
    const scores = context.people.map((person, index) => ({ index, score: hash(JSON.stringify([seed, seat.id, person.id])) }));
    scores.sort((a, b) => a.score - b.score || a.index - b.index);
    const ranks = new Int32Array(context.people.length);
    scores.forEach(({ index }, rank) => { ranks[index] = rank; });
    return ranks;
  });
}

function prioritiesFor(context, prefers) {
  return Object.fromEntries(context.places.map((seat, seatIndex) => {
    const order = context.people.map((_, index) => index);
    order.sort((a, b) => a === b ? 0 : prefers(seatIndex, a, b) ? -1 : 1);
    return [seat.id, order.map((index) => context.people[index].id)];
  }));
}

export function allocateSeats({ participants, seats, preferences, seed = DEFAULT_SEED, mode = 'distance', onProgress } = {}) {
  const context = prepare(participants, seats, preferences);
  if (!['distance', 'preference'].includes(mode)) throw new Error('배정 모드는 distance 또는 preference여야 합니다.');
  if (typeof seed !== 'string' && (typeof seed !== 'number' || !Number.isFinite(seed))) throw new Error('추첨 시드는 문자열 또는 유한한 숫자여야 합니다.');
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new Error('진행 콜백은 함수여야 합니다.');
  const size = context.places.length;
  const tieRanks = seededRanks(context, seed);
  const distances = context.places.map((a) => context.places.map((b) => Math.hypot(a.x - b.x, a.y - b.y)));
  if (distances.some((row) => row.some((distance) => !Number.isFinite(distance)))) throw new Error('좌석 사이 거리를 계산할 수 없습니다.');
  const samePartPairs = [];
  for (let a = 0; a < context.people.length; a++) {
    for (let b = a + 1; b < context.people.length; b++) {
      if (context.parts[a] === context.parts[b]) samePartPairs.push([a, b]);
    }
  }
  function evaluate(result) {
    let totalDistance = 0;
    for (const [a, b] of samePartPairs) totalDistance += distances[result.assigned[a]][result.assigned[b]];
    return { totalDistance, rankSum: result.next.reduce((sum, rank) => sum + rank, 0) };
  }
  const baselinePrefers = (seat, person, current) => tieRanks[seat][person] < tieRanks[seat][current];
  let best = solve(context.lists, size, baselinePrefers);
  let bestScore = evaluate(best);
  let bestAnchors = null;
  let candidateCount = 1;
  const totalCandidates = mode === 'distance' ? 1 + size * (size - 1) * (size - 2) : 1;
  if (mode === 'distance') {
    // Comparison is lazy: no sorting of all 21 receiver lists per candidate.
    for (let data = 0; data < size; data++) {
      for (let dispatch = 0; dispatch < size; dispatch++) {
        if (dispatch === data) continue;
        for (let map = 0; map < size; map++) {
          if (map === data || map === dispatch) continue;
          const anchors = [data, dispatch, map];
          const prefers = (seat, person, current) => {
            const difference = distances[seat][anchors[context.parts[person]]] - distances[seat][anchors[context.parts[current]]];
            return difference < 0 || (difference === 0 && tieRanks[seat][person] < tieRanks[seat][current]);
          };
          const candidate = solve(context.lists, size, prefers);
          const score = evaluate(candidate);
          if (score.totalDistance < bestScore.totalDistance || (score.totalDistance === bestScore.totalDistance && score.rankSum < bestScore.rankSum)) {
            best = candidate;
            bestScore = score;
            bestAnchors = anchors;
          }
          candidateCount++;
          if (candidateCount % 256 === 0) onProgress?.({ completed: candidateCount, total: totalCandidates });
        }
      }
    }
  }
  onProgress?.({ completed: candidateCount, total: totalCandidates });
  const winningPrefers = bestAnchors ? (seat, person, current) => {
    const difference = distances[seat][bestAnchors[context.parts[person]]] - distances[seat][bestAnchors[context.parts[current]]];
    return difference < 0 || (difference === 0 && tieRanks[seat][person] < tieRanks[seat][current]);
  } : baselinePrefers;
  const assignments = assignmentsFor(context, best);
  return {
    assignments,
    seed,
    mode,
    metrics: {
      totalDistance: bestScore.totalDistance,
      averageDistance: samePartPairs.length ? bestScore.totalDistance / samePartPairs.length : 0,
      averageRank: bestScore.rankSum / assignments.length,
      top3Count: assignments.filter((entry) => entry.rank <= 3).length,
      matchedCount: assignments.length,
      vacancies: size - assignments.length,
      candidateCount,
    },
    seatPriorities: prioritiesFor(context, winningPrefers),
    anchors: bestAnchors ? Object.fromEntries(PARTS.map((part, index) => [part, context.places[bestAnchors[index]].id])) : null,
  };
}
