import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateSeats, findBlockingPairs, galeShapley, validatePreferences } from '../matching.mjs';

function fixture() {
  const seats = Array.from({ length: 21 }, (_, index) => ({ id: `s${String(index).padStart(2, '0')}`, zone: index < 9 ? 'A' : index < 15 ? 'B' : 'C', x: index % 3, y: Math.floor(index / 3) }));
  const participants = Array.from({ length: 20 }, (_, index) => ({ id: `p${String(index).padStart(2, '0')}`, name: `Person ${index}`, part: index < 8 ? 'data' : index < 16 ? 'dispatch' : 'map' }));
  const preferences = Object.fromEntries(participants.map((person, index) => [person.id, [...seats.slice(index % 7), ...seats.slice(0, index % 7)].map((seat) => seat.id)]));
  return { participants, seats, preferences };
}

test('20 people occupy unique seats, with one vacancy and no blocking pairs', () => {
  const input = fixture();
  const progress = [];
  const result = allocateSeats({ ...input, seed: 'stable', onProgress: (value) => progress.push(value) });
  assert.equal(result.assignments.length, 20);
  assert.equal(new Set(result.assignments.map((entry) => entry.seatId)).size, 20);
  assert.equal(result.metrics.vacancies, 1);
  assert.equal(result.metrics.candidateCount, 7981);
  assert.deepEqual(findBlockingPairs(input.participants, input.seats, input.preferences, result.seatPriorities, result.assignments), []);
  assert.deepEqual(progress.at(-1), { completed: 7981, total: 7981 });
  assert.ok(progress.length > 1);
  for (const assignment of result.assignments) assert.equal(input.preferences[assignment.participantId][assignment.rank - 1], assignment.seatId);
});

test('seeded results reproduce and are independent of input order', () => {
  const input = fixture();
  const first = allocateSeats({ ...input, seed: 42 });
  assert.deepEqual(allocateSeats({ ...input, seed: 42 }), first);
  assert.deepEqual(allocateSeats({ ...input, participants: [...input.participants].reverse(), seats: [...input.seats].reverse(), seed: 42 }), first);
});

test('distance candidate is at least as compact as the included baseline', () => {
  const input = fixture();
  const baseline = allocateSeats({ ...input, mode: 'preference', seed: 'distance' });
  const optimized = allocateSeats({ ...input, mode: 'distance', seed: 'distance' });
  assert.ok(optimized.metrics.totalDistance <= baseline.metrics.totalDistance + 1e-9);
  assert.equal(baseline.metrics.candidateCount, 1);
  assert.equal(baseline.anchors, null);
  assert.deepEqual(galeShapley(input.participants, input.seats, input.preferences, optimized.seatPriorities), optimized.assignments);
});

test('all people can collide on the same choices and still be stably matched', () => {
  const input = fixture();
  input.preferences = Object.fromEntries(input.participants.map((person) => [person.id, input.seats.map((seat) => seat.id)]));
  const result = allocateSeats({ ...input, seed: 'collision' });
  assert.equal(result.metrics.matchedCount, 20);
  assert.deepEqual(findBlockingPairs(input.participants, input.seats, input.preferences, result.seatPriorities, result.assignments), []);
  assert.equal(new Set(result.assignments.map((entry) => entry.seatId)).size, 20);
});

test('blocking-pair detection identifies a deliberately unstable assignment', () => {
  const participants = [{ id: 'a', part: 'data' }, { id: 'b', part: 'map' }];
  const seats = [{ id: 'x', zone: 'A', x: 0, y: 0 }, { id: 'y', zone: 'B', x: 1, y: 0 }];
  const preferences = { a: ['x', 'y'], b: ['y', 'x'] };
  const priorities = { x: ['a', 'b'], y: ['b', 'a'] };
  assert.deepEqual(galeShapley(participants, seats, preferences, priorities), [{ participantId: 'a', seatId: 'x', rank: 1 }, { participantId: 'b', seatId: 'y', rank: 1 }]);
  assert.deepEqual(findBlockingPairs(participants, seats, preferences, priorities, [{ participantId: 'a', seatId: 'y' }, { participantId: 'b', seatId: 'x' }]), [{ participantId: 'a', seatId: 'x' }, { participantId: 'b', seatId: 'y' }]);
});

test('missing, incomplete, duplicate and unknown preferences are rejected', () => {
  for (const mutate of [
    (input) => { delete input.preferences.p00; },
    (input) => { input.preferences.p00.pop(); },
    (input) => { input.preferences.p00[1] = input.preferences.p00[0]; },
    (input) => { input.preferences.p00[0] = 'unknown'; },
    (input) => { input.preferences.p00 = 'wrong'; },
    (input) => { delete input.preferences.p00[0]; },
    (input) => { input.preferences.unknown = input.preferences.p00; },
  ]) {
    const input = fixture();
    mutate(input);
    const result = validatePreferences(input.participants, input.seats, input.preferences);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length);
    assert.throws(() => allocateSeats(input));
  }
});

test('invalid collection shapes, IDs, parts, coordinates and capacities fail validation', () => {
  assert.equal(validatePreferences(null, [], {}).valid, false);
  assert.equal(validatePreferences([], null, {}).valid, false);
  assert.equal(validatePreferences([], [], []).valid, false);
  assert.equal(validatePreferences([], [], {}).valid, false);
  for (const mutate of [
    (input) => { input.participants[1].id = input.participants[0].id; },
    (input) => { input.seats[1].id = input.seats[0].id; },
    (input) => { input.participants[0].part = 'green'; },
    (input) => { input.participants[0] = null; },
    (input) => { input.seats[0].x = NaN; },
    (input) => { input.seats[0].y = Infinity; },
    (input) => { input.seats[0].zone = 'D'; },
    (input) => { input.seats.length = 19; },
  ]) {
    const input = fixture();
    mutate(input);
    assert.equal(validatePreferences(input.participants, input.seats, input.preferences).valid, false);
  }
});

test('malformed receiver priorities and options are rejected', () => {
  const input = fixture();
  assert.throws(() => galeShapley(input.participants, input.seats, input.preferences, []));
  assert.throws(() => galeShapley(input.participants, input.seats, input.preferences, {}));
  assert.throws(() => allocateSeats({ ...input, mode: 'unknown' }));
  assert.throws(() => allocateSeats({ ...input, seed: NaN }));
  assert.throws(() => allocateSeats({ ...input, onProgress: true }));
});

test('single-part and single-person inputs have finite metrics', () => {
  const input = fixture();
  input.participants = [input.participants[0]];
  input.preferences = { p00: input.preferences.p00 };
  const result = allocateSeats(input);
  assert.equal(result.metrics.totalDistance, 0);
  assert.equal(result.metrics.averageDistance, 0);
  assert.equal(result.metrics.averageRank, 1);
});
