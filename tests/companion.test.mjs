import test from 'node:test';
import assert from 'node:assert/strict';
import { SEATS, createInitialState, stateFingerprint } from '../data.mjs';
import { normalizeCompanions, getAssignedCompanion, getCompanionMetrics } from '../companion.mjs';

const participants = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const assignments = [{ participantId: 'a', seatId: '85' }, { participantId: 'b', seatId: '90' }, { participantId: 'c', seatId: '86' }];
test('optional requests normalize sparsely and reject invalid participants and targets', () => {
  assert.deepEqual(normalizeCompanions(participants, { a: 'b', b: '', c: null }), { a: 'b' });
  for (const input of [null, [], new Date(), { unknown: null }, { a: 'unknown' }, { a: 'a' }, { a: 1 }]) assert.throws(() => normalizeCompanions(participants, input));
});
test('directed requests count only actual paired C seats present in the input', () => {
  assert.deepEqual(getCompanionMetrics(participants, SEATS, { a: 'b', b: 'a', c: 'a' }, assignments), { companionRequested: 3, companionSatisfied: 2 });
  assert.equal(getAssignedCompanion('a', SEATS, assignments), 'b');
  assert.equal(getAssignedCompanion('c', SEATS, assignments), null);
  assert.equal(getAssignedCompanion('unknown', SEATS, assignments), null);
  assert.equal(getAssignedCompanion('a', SEATS.filter(seat => seat.id !== '90'), assignments), null);
  assert.equal(getAssignedCompanion('a', SEATS.map(seat => seat.id === '90' ? { ...seat, zone: 'A' } : seat), assignments), null);
  assert.deepEqual(getCompanionMetrics(participants, SEATS, { a: 'b' }, [{ participantId: 'a', seatId: '207' }, { participantId: 'b', seatId: '206' }]), { companionRequested: 1, companionSatisfied: 0 });
});
test('all three C pairs are recognized and vacancies do not satisfy requests', () => {
  for (const [first, second] of [['85', '90'], ['86', '89'], ['87', '88']]) {
    assert.equal(getAssignedCompanion('a', SEATS, [{ participantId: 'a', seatId: first }, { participantId: 'b', seatId: second }]), 'b');
    assert.equal(getAssignedCompanion('a', SEATS, [{ participantId: 'a', seatId: first }]), null);
  }
});
test('fingerprints normalize old empty state and ordering while detecting companion changes', () => {
  const state = createInitialState();
  const legacy = structuredClone(state); delete legacy.companions;
  assert.equal(stateFingerprint(state), stateFingerprint(legacy));
  const [a, b] = state.participants;
  assert.equal(stateFingerprint({ ...state, companions: { [a.id]: null, [b.id]: '' } }), stateFingerprint(state));
  const changed = { ...state, companions: { [a.id]: b.id, [b.id]: a.id } };
  assert.notEqual(stateFingerprint(changed), stateFingerprint(state));
  assert.equal(stateFingerprint(changed), stateFingerprint({ ...state, companions: { [b.id]: a.id, [a.id]: b.id } }));
});
