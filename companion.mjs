import { C_SEAT_PAIRS } from './data.mjs';

export function normalizeCompanions(participants, companions = {}) {
  if (companions === null || typeof companions !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(companions))) throw new Error('희망 동료 목록은 참가자 ID를 키로 하는 객체여야 합니다.');
  const known = new Set(participants.map(person => person.id));
  const entries = [];
  for (const [id, target] of Object.entries(companions)) {
    if (!known.has(id)) throw new Error('희망 동료 목록에 등록되지 않은 참가자가 있습니다.');
    if (target === null || target === '') continue;
    if (typeof target !== 'string' || !known.has(target)) throw new Error('함께 앉고 싶은 동료는 등록된 참가자 중에서 선택해 주세요.');
    if (id === target) throw new Error('자기 자신을 함께 앉고 싶은 동료로 선택할 수 없습니다.');
    entries.push([id, target]);
  }
  return Object.fromEntries(entries);
}

export function getAssignedCompanion(participantId, seats, assignments) {
  const seatIds = new Set(seats.filter(seat => seat.zone === 'C').map(seat => seat.id));
  const assigned = assignments.find(entry => entry.participantId === participantId);
  if (!assigned) return null;
  const pair = C_SEAT_PAIRS.find(ids => ids.includes(assigned.seatId) && ids.every(id => seatIds.has(id)));
  if (!pair) return null;
  const partnerSeat = pair.find(id => id !== assigned.seatId);
  return assignments.find(entry => entry.seatId === partnerSeat)?.participantId ?? null;
}

export function getCompanionMetrics(participants, seats, companions, assignments) {
  const requests = normalizeCompanions(participants, companions);
  return {
    companionRequested: Object.keys(requests).length,
    companionSatisfied: Object.entries(requests).filter(([id, target]) => getAssignedCompanion(id, seats, assignments) === target).length,
  };
}
