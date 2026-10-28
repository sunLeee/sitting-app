import test from 'node:test';
import assert from 'node:assert/strict';
import { SEATS } from '../data.mjs';
import { getAssignedCompanion } from '../companion.mjs';
import { allocateSeats, buildMatchingPreferences, findBlockingPairs, galeShapley, getMaxCompanionSatisfied } from '../matching.mjs';

function fixture(count = 6, seats = SEATS) {
  const participants = Array.from({ length: count }, (_, index) => ({ id: `p${String(index).padStart(2, '0')}`, part: ['data', 'dispatch', 'map'][index % 3] }));
  const ordered = [...seats.filter(seat => seat.zone !== 'C'), ...seats.filter(seat => seat.zone === 'C')].map(seat => seat.id);
  const preferences = Object.fromEntries(participants.map(person => [person.id, [...ordered]]));
  return { participants, seats, preferences };
}

function assertStable(input, result) {
  const composite = buildMatchingPreferences(input.participants, input.seats, input.preferences, input.companions, result.companionPlan);
  assert.deepEqual(findBlockingPairs(input.participants, input.seats, composite, result.seatPriorities, result.assignments), []);
  const actual = result.assignments.map(({ participantId, seatId }) => ({ participantId, seatId }));
  const expected = galeShapley(input.participants, input.seats, composite, result.seatPriorities).map(({ participantId, seatId }) => ({ participantId, seatId }));
  assert.deepEqual(actual, expected);
  for (const entry of result.assignments) assert.equal(entry.rank, input.preferences[entry.participantId].indexOf(entry.seatId) + 1);
}

test('one-way companion request outranks low C preference across parts', () => {
  const input = { ...fixture(2), companions: { p00: 'p01' } };
  const result = allocateSeats({ ...input, mode: 'preference' });
  assert.equal(result.metrics.companionRequested, 1);
  assert.equal(result.metrics.companionSatisfied, 1);
  assert.equal(getAssignedCompanion('p00', input.seats, result.assignments), 'p01');
  assert.ok(result.assignments.every(entry => entry.rank > 15));
  assertStable(input, result);
  // Raw submitted preferences intentionally do not represent companion-first choices.
  assert.ok(findBlockingPairs(input.participants, input.seats, input.preferences, result.seatPriorities, result.assignments).length > 0);
});

test('mutual requests count twice and beat competing one-way requests', () => {
  const seats = SEATS.filter(seat => seat.zone !== 'C' || ['85', '90'].includes(seat.id));
  const input = { ...fixture(4, seats), companions: { p00: 'p01', p01: 'p00', p02: 'p00', p03: 'p02' } };
  const result = allocateSeats(input);
  assert.equal(getMaxCompanionSatisfied(input.participants, input.seats, input.companions), 2);
  assert.equal(result.metrics.companionRequested, 4);
  assert.equal(result.metrics.companionSatisfied, 2);
  assert.equal(getAssignedCompanion('p00', input.seats, result.assignments), 'p01');
  assertStable(input, result);
});

test('conflicting request graph uses disjoint maximum edges, independent of order', () => {
  const input = { ...fixture(8), companions: { p00: 'p01', p01: 'p02', p02: 'p03', p03: 'p00', p04: 'p05', p05: 'p04', p06: 'p05', p07: 'p06' } };
  const result = allocateSeats(input);
  assert.equal(getMaxCompanionSatisfied(input.participants, input.seats, input.companions), 4);
  assert.equal(result.metrics.companionSatisfied, 4);
  assert.equal(new Set(result.companionPlan.flatMap(entry => entry.participantIds)).size, 6);
  assertStable(input, result);
  const reversed = allocateSeats({ ...input, participants: [...input.participants].reverse(), seats: [...input.seats].reverse(), companions: Object.fromEntries(Object.entries(input.companions).reverse()) });
  assert.deepEqual(reversed, result);
});

test('three physical pods cap mutually fulfilled requests at six', () => {
  const input = { ...fixture(8), companions: { p00: 'p01', p01: 'p00', p02: 'p03', p03: 'p02', p04: 'p05', p05: 'p04', p06: 'p07', p07: 'p06' } };
  const progress = [];
  const result = allocateSeats({ ...input, onProgress: value => progress.push(value) });
  assert.equal(result.metrics.companionSatisfied, 6);
  assert.equal(result.companionPlan.length, 3);
  assert.equal(getMaxCompanionSatisfied(input.participants, input.seats, input.companions), 6);
  assert.deepEqual(progress.at(-1), { completed: result.metrics.candidateCount, total: result.metrics.candidateCount });
  assertStable(input, result);
});

test('companion fulfillment has higher priority than within-part distance', () => {
  const seats = [{ id: 'a', zone: 'A', x: 0, y: 0 }, { id: 'b', zone: 'A', x: 0, y: 0 }, { id: '85', zone: 'C', x: 100, y: 0 }, { id: '90', zone: 'C', x: 100, y: 0 }];
  const input = fixture(4, seats);
  input.participants.forEach((person, index) => { person.part = index < 2 ? 'data' : 'map'; });
  const ordinary = allocateSeats(input);
  const requested = { ...input, companions: { p00: 'p02' } };
  const result = allocateSeats(requested);
  assert.equal(result.metrics.companionSatisfied, 1);
  assert.ok(result.metrics.totalDistance > ordinary.metrics.totalDistance);
  assertStable(requested, result);
});

test('reported rank remains original rank 20 after designated seat moves to front', () => {
  const seats = [
    ...Array.from({ length: 19 }, (_, index) => ({ id: `a${index}`, zone: 'A', x: index, y: 0 })),
    { id: '85', zone: 'C', x: 0, y: 7 }, { id: '90', zone: 'C', x: 1, y: 7 },
  ];
  const input = { ...fixture(2, seats), companions: { p00: 'p01' } };
  input.preferences.p01 = [...input.preferences.p01.slice(0, 19), '90', '85'];
  const result = allocateSeats({ ...input, mode: 'preference' });
  assert.deepEqual(result.assignments.map(entry => entry.rank), [20, 20]);
  assert.equal(result.metrics.averageRank, 20);
  const composite = buildMatchingPreferences(input.participants, seats, input.preferences, input.companions, result.companionPlan);
  assert.equal(composite.p00[0], '85');
  assert.equal(composite.p01[0], '90');
  assertStable(input, result);
});

test('incomplete or non-C physical pods cannot fulfill a request', () => {
  for (const seats of [SEATS.filter(seat => !['90', '89', '88'].includes(seat.id)), SEATS.map(seat => seat.zone === 'C' ? { ...seat, zone: 'A' } : seat)]) {
    const input = { ...fixture(2, seats), companions: { p00: 'p01' } };
    assert.equal(getMaxCompanionSatisfied(input.participants, seats, input.companions), 0);
    const result = allocateSeats(input);
    assert.equal(result.metrics.companionSatisfied, 0);
    assert.deepEqual(result.companionPlan, []);
  }
});

test('missing requests are optional; unknown, self and invalid requests are rejected', () => {
  const input = fixture(2);
  assert.deepEqual(allocateSeats({ ...input, companions: { p00: '' } }), allocateSeats(input));
  for (const companions of [{ p00: 'p00' }, { p00: 'missing' }, { missing: 'p00' }, { p00: ['p01'] }, null, []]) {
    assert.throws(() => allocateSeats({ ...input, companions }));
    assert.throws(() => buildMatchingPreferences(input.participants, input.seats, input.preferences, companions));
  }
});

test('composite plan validation rejects wrong pods, duplicates, unknown IDs and unrequested pairs', () => {
  const input = fixture(4);
  const companions = { p00: 'p01', p02: 'p03' };
  const good = { participantIds: ['p00', 'p01'], seatIds: ['85', '90'] };
  for (const plan of [null, {}, [null], [{ participantIds: ['p00', 'p01'], seatIds: ['85', '89'] }], [{ participantIds: ['p00', 'p02'], seatIds: ['85', '90'] }], [{ participantIds: ['p00', 'missing'], seatIds: ['85', '90'] }], [good, good], [good, { participantIds: ['p02', 'p03'], seatIds: ['90', '85'] }], [good, { participantIds: ['p00', 'p01'], seatIds: ['86', '89'] }]]) {
    assert.throws(() => buildMatchingPreferences(input.participants, input.seats, input.preferences, companions, plan));
  }
  const before = structuredClone(input.preferences);
  const composite = buildMatchingPreferences(input.participants, input.seats, input.preferences, companions, [good]);
  assert.equal(composite.p00[0], '85');
  assert.deepEqual(composite.p00.slice(1), before.p00.filter(id => id !== '85'));
  assert.deepEqual(composite.p02, before.p02);
  assert.deepEqual(input.preferences, before);
});

test('20-request cycle reaches the exact maximum with bounded expansion and stable output', () => {
  const input = fixture(20);
  const companions = Object.fromEntries(input.participants.map((person, index) => [person.id, input.participants[(index + 1) % 20].id]));
  const started = performance.now();
  const result = allocateSeats({ ...input, companions });
  assert.equal(result.metrics.companionSatisfied, 3);
  assert.equal(result.metrics.companionRequested, 20);
  assert.equal(getMaxCompanionSatisfied(input.participants, input.seats, companions), 3);
  // 800 disjoint triples × 48 pod/orientation plans, plus twelve anchor expansions.
  assert.equal(result.metrics.candidateCount, 134160);
  assertStable({ ...input, companions }, result);
  console.log(`20-request cycle: ${result.metrics.candidateCount} candidates in ${(performance.now() - started).toFixed(0)} ms`);
});
