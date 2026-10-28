import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createServer } from '../server.mjs';
import { SEATS, stateFingerprint } from '../data.mjs';
import { allocateSeats, buildMatchingPreferences, findBlockingPairs } from '../matching.mjs';

const ranking = SEATS.map(seat => seat.id);
async function fixture(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'seating-server-'));
  const rootDir = path.join(temporary, 'public'), dataDir = path.join(temporary, 'storage');
  await mkdir(path.join(rootDir, 'assets'), { recursive: true });
  await writeFile(path.join(rootDir, 'index.html'), '<h1>seating</h1>');
  await writeFile(path.join(rootDir, 'app.mjs'), 'export const test = true;');
  await writeFile(path.join(rootDir, 'assets', 'photo.jpg'), 'photo');
  await writeFile(path.join(rootDir, 'secret.txt'), 'secret');
  await symlink(path.join(rootDir, 'secret.txt'), path.join(rootDir, 'assets', 'secret.jpg'));
  let server, base;
  async function start() {
    server = await createServer({ rootDir, dataDir });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function close() { if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  await start();
  t.after(async () => { await close(); await rm(temporary, { recursive: true, force: true }); });
  return {
    dataDir,
    request: async (route, method = 'GET', body, malformed = false) => {
      const response = await fetch(base + route, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : malformed ? body : JSON.stringify(body) });
      return { status: response.status, headers: response.headers, body: await response.json() };
    },
    raw: route => new Promise((resolve, reject) => {
      const request = http.get(base + '/', { path: route }, response => {
        let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
      }); request.on('error', reject);
    }),
    restart: async () => { await close(); await start(); },
  };
}

test('default metadata contains 20 people, 21 seats and restricted static files', async t => {
  const app = await fixture(t);
  const state = await app.request('/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.body.participants.length, 20);
  assert.equal(SEATS.length, 21);
  assert.deepEqual(state.body.participants.reduce((counts, person) => ({ ...counts, [person.part]: (counts[person.part] ?? 0) + 1 }), {}), { data: 8, dispatch: 8, map: 4 });
  assert.equal(state.headers.get('cache-control'), 'no-store');
  assert.equal((await app.raw('/')).status, 200);
  assert.match((await app.raw('/app.mjs')).headers['content-type'], /javascript/);
  assert.equal((await app.raw('/assets/photo.jpg')).headers['content-type'], 'image/jpeg');
  for (const route of ['/secret.txt', '/server.mjs', '/scripts/check.mjs', '/.local-data/workspace.json', '/.omx/state/a', '/assets/secret.jpg', '/assets/../secret.txt', '/assets/%2e%2e/secret.txt', '/assets/%252e%252e/secret.txt', '/assets/%5c..%5csecret.txt']) {
    const result = await app.raw(route);
    assert.ok([403, 404].includes(result.status), `${route}: ${result.status}`);
    assert.ok(!result.body.includes('secret'));
  }
});

test('independent concurrent preference saves survive restart and reject duplicates', async t => {
  const app = await fixture(t);
  const initial = (await app.request('/api/state')).body;
  const [first, second] = initial.participants;
  const invalid = await app.request(`/api/preferences/${first.id}`, 'PUT', { ranking: Array(21).fill(ranking[0]) });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /중복/);
  assert.deepEqual((await app.request('/api/state')).body, initial);
  const responses = await Promise.all([
    app.request(`/api/preferences/${first.id}`, 'PUT', { ranking }),
    app.request(`/api/preferences/${second.id}`, 'PUT', { ranking: [...ranking].reverse() }),
  ]);
  assert.ok(responses.every(response => response.status === 200));
  await app.restart();
  const reloaded = (await app.request('/api/state')).body;
  assert.deepEqual(reloaded.preferences, { [first.id]: ranking, [second.id]: [...ranking].reverse() });
  assert.deepEqual(JSON.parse(await readFile(path.join(app.dataDir, 'workspace.json'), 'utf8')), reloaded);
});

test('result requires complete fresh input, valid metrics, stable assignments and invalidates on changes', async t => {
  const app = await fixture(t);
  const participants = [{ id: 'first', name: '첫째', part: 'data' }, { id: 'second', name: '둘째', part: 'data' }];
  let state = (await app.request('/api/participants', 'PUT', { participants })).body;
  assert.equal((await app.request('/api/result', 'PUT', { fingerprint: stateFingerprint(state), result: {} })).status, 409);
  state = (await app.request('/api/import', 'POST', { preferences: { first: ranking, second: [...ranking].reverse() } })).body;
  const result = allocateSeats({ participants, seats: SEATS, preferences: state.preferences, mode: 'preference', seed: 'server-test' });
  assert.equal((await app.request('/api/result', 'PUT', { fingerprint: 'old', result })).status, 409);
  assert.equal((await app.request('/api/result', 'PUT', { fingerprint: stateFingerprint(state), result: { ...result, metrics: { ...result.metrics, matchedCount: 21 } } })).status, 400);
  const duplicate = structuredClone(result);
  duplicate.assignments[1].seatId = duplicate.assignments[0].seatId;
  assert.equal((await app.request('/api/result', 'PUT', { fingerprint: stateFingerprint(state), result: duplicate })).status, 400);
  const missingPriorities = { ...result, seatPriorities: {} };
  assert.equal((await app.request('/api/result', 'PUT', { fingerprint: stateFingerprint(state), result: missingPriorities })).status, 400);
  const saved = await app.request('/api/result', 'PUT', { fingerprint: stateFingerprint(state), result });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.result, result);
  await app.restart();
  assert.deepEqual((await app.request('/api/state')).body.result, result);
  const changed = await app.request('/api/preferences/first', 'PUT', { ranking: [...ranking].reverse() });
  assert.equal(changed.body.result, null);
  assert.equal((await app.request('/api/result', 'PUT', { fingerprint: stateFingerprint(state), result })).status, 409);
});

test('imports merge independently and reject invalid whole request atomically', async t => {
  const app = await fixture(t);
  const participants = [{ id: 'a', name: 'A', part: 'map' }, { id: 'b', name: 'B', part: 'dispatch' }];
  const first = await app.request('/api/import', 'POST', { participants, preferences: { a: ranking } });
  assert.equal(first.status, 200);
  const second = await app.request('/api/import', 'POST', { preferences: { b: [...ranking].reverse() } });
  assert.deepEqual(Object.keys(second.body.preferences).sort(), ['a', 'b']);
  const invalid = await app.request('/api/import', 'POST', { participants: [{ id: 'c', name: 'C', part: 'data' }], preferences: { c: ranking, unknown: ranking } });
  assert.equal(invalid.status, 400);
  assert.deepEqual((await app.request('/api/state')).body, second.body);
  const duplicateNames = await app.request('/api/participants', 'PUT', { participants: [participants[0], { ...participants[1], name: 'A' }] });
  assert.equal(duplicateNames.status, 400);
  await app.restart();
  assert.deepEqual((await app.request('/api/state')).body, second.body);
});

test('rejects an unstable result even when assignment counts and metrics are coherent', async t => {
  const app = await fixture(t);
  const participants = [{ id: 'a', name: 'A', part: 'map' }];
  const state = (await app.request('/api/import', 'POST', { participants, preferences: { a: ranking } })).body;
  const result = allocateSeats({ participants, seats: SEATS, preferences: state.preferences, mode: 'preference' });
  result.assignments[0] = { participantId: 'a', seatId: ranking[1], rank: 2 };
  result.metrics.averageRank = 2;
  const rejected = await app.request('/api/result', 'PUT', { fingerprint: stateFingerprint(state), result });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /안정/);
  assert.equal((await app.request('/api/state')).body.result, null);
});

test('request bodies enforce JSON syntax, type and 1MiB limit', async t => {
  const app = await fixture(t);
  assert.equal((await app.request('/api/import', 'POST', { preferences: {}, padding: 'x'.repeat(1024 * 1024) })).status, 413);
  assert.equal((await app.request('/api/import', 'POST', [])).status, 400);
  assert.equal((await app.request('/api/import', 'POST', '{broken', true)).status, 400);
  assert.equal((await app.request('/api/import', 'POST')).status, 415);
  assert.equal((await app.request('/api/reset', 'POST', {})).status, 404);
});

test('companion saves preserve absent fields, clear null, reject invalid requests atomically and survive restart', async t => {
  const app = await fixture(t);
  const initial = (await app.request('/api/state')).body;
  const [first, second] = initial.participants;
  let response = await app.request(`/api/preferences/${first.id}`, 'PUT', { ranking, companionId: second.id });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.companions, { [first.id]: second.id });
  response = await app.request(`/api/preferences/${first.id}`, 'PUT', { ranking: [...ranking].reverse() });
  assert.deepEqual(response.body.companions, { [first.id]: second.id });
  const current = response.body;
  for (const companionId of [first.id, 'unknown', 1, {}]) {
    assert.equal((await app.request(`/api/preferences/${first.id}`, 'PUT', { ranking, companionId })).status, 400);
    assert.deepEqual((await app.request('/api/state')).body, current);
  }
  await app.restart();
  assert.deepEqual((await app.request('/api/state')).body.companions, current.companions);
  response = await app.request(`/api/preferences/${first.id}`, 'PUT', { ranking, companionId: null });
  assert.deepEqual(response.body.companions, {});
});
test('partial companion imports preserve others, clear explicit null, prune roster removals and reject atomically', async t => {
  const app = await fixture(t);
  const participants = [{ id: 'a', name: 'A', part: 'data' }, { id: 'b', name: 'B', part: 'map' }, { id: 'c', name: 'C', part: 'dispatch' }];
  let state = (await app.request('/api/import', 'POST', { participants, preferences: { a: ranking }, companions: { a: 'b', b: 'a', c: 'b' } })).body;
  assert.deepEqual(state.companions, { a: 'b', b: 'a', c: 'b' });
  const oldFingerprint = stateFingerprint(state);
  state = (await app.request('/api/import', 'POST', { preferences: { b: ranking }, companions: { a: null } })).body;
  assert.deepEqual(state.companions, { b: 'a', c: 'b' });
  assert.equal((await app.request('/api/import', 'POST', { fingerprint: oldFingerprint, preferences: {}, companions: { c: 'a' } })).status, 409);
  for (const companions of [null, [], { unknown: null }, { a: 'unknown' }, { a: 'a' }]) {
    assert.equal((await app.request('/api/import', 'POST', { preferences: { c: ranking }, companions })).status, 400);
    assert.deepEqual((await app.request('/api/state')).body, state);
  }
  state = (await app.request('/api/import', 'POST', { preferences: {} })).body;
  assert.deepEqual(state.companions, { b: 'a', c: 'b' });
  state = (await app.request('/api/participants', 'PUT', { participants: [participants[0], participants[2]] })).body;
  assert.deepEqual(state.companions, {});
  await app.restart();
  assert.deepEqual((await app.request('/api/state')).body, state);
});
test('old version 1 saved state without companions loads with an empty optional map', async t => {
  const app = await fixture(t);
  const state = (await app.request('/api/state')).body;
  delete state.companions;
  await mkdir(app.dataDir, { recursive: true });
  await writeFile(path.join(app.dataDir, 'workspace.json'), JSON.stringify(state));
  await app.restart();
  assert.deepEqual((await app.request('/api/state')).body.companions, {});
});
test('companion-aware results verify actual metrics, composite stability and stale companion fingerprints', async t => {
  const app = await fixture(t);
  const participants = [{ id: 'a', name: 'A', part: 'data' }, { id: 'b', name: 'B', part: 'map' }];
  let state = (await app.request('/api/import', 'POST', { participants, preferences: { a: ranking, b: [...ranking].reverse() }, companions: { a: 'b' } })).body;
  const result = allocateSeats({ participants, seats: SEATS, preferences: state.preferences, companions: state.companions, mode: 'preference', seed: 'buddy-server' });
  assert.equal(result.metrics.companionRequested, 1);
  assert.equal(result.metrics.companionSatisfied, 1);
  for (const metrics of [{ ...result.metrics, companionSatisfied: 0 }, { ...result.metrics, companionRequested: '1' }, { ...result.metrics, mystery: 1 }, { ...result.metrics, candidateCount: 1000001 }]) {
    assert.equal((await app.request('/api/result', 'PUT', { fingerprint: stateFingerprint(state), result: { ...result, metrics } })).status, 400);
  }
  const invalidPlan = { ...result, companionPlan: [{ participantIds: ['a', 'b'], seatIds: ['207', '206'] }] };
  assert.equal((await app.request('/api/result', 'PUT', { fingerprint: stateFingerprint(state), result: invalidPlan })).status, 400);
  const saved = await app.request('/api/result', 'PUT', { fingerprint: stateFingerprint(state), result });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  await app.restart();
  assert.deepEqual((await app.request('/api/state')).body.result, result);
  const fingerprint = stateFingerprint(state);
  state = (await app.request('/api/preferences/a', 'PUT', { ranking, companionId: null })).body;
  assert.equal(state.result, null);
  assert.equal((await app.request('/api/result', 'PUT', { fingerprint, result })).status, 409);
});
test('legacy matching result without companion metrics or plan remains valid after restart', async t => {
  const app = await fixture(t);
  const participants = [{ id: 'a', name: 'A', part: 'data' }];
  const state = (await app.request('/api/import', 'POST', { participants, preferences: { a: ranking } })).body;
  const result = allocateSeats({ participants, seats: SEATS, preferences: state.preferences, mode: 'preference', seed: 'legacy' });
  delete result.companionPlan;
  delete result.metrics.companionRequested;
  delete result.metrics.companionSatisfied;
  assert.equal((await app.request('/api/result', 'PUT', { fingerprint: stateFingerprint(state), result })).status, 200);
  const legacy = JSON.parse(await readFile(path.join(app.dataDir, 'workspace.json'), 'utf8'));
  delete legacy.companions;
  await writeFile(path.join(app.dataDir, 'workspace.json'), JSON.stringify(legacy));
  await app.restart();
  const reloaded = (await app.request('/api/state')).body;
  assert.deepEqual(reloaded.companions, {});
  assert.deepEqual(reloaded.result, result);
});
test('replacing roster inside an import prunes existing requests and preserves atomicity on invalid new targets', async t => {
  const app = await fixture(t);
  const participants = [{ id: 'a', name: 'A', part: 'data' }, { id: 'b', name: 'B', part: 'map' }, { id: 'c', name: 'C', part: 'dispatch' }];
  const state = (await app.request('/api/import', 'POST', { participants, preferences: { a: ranking }, companions: { a: 'b', c: 'a' } })).body;
  const replacement = [participants[0], participants[2]];
  assert.equal((await app.request('/api/import', 'POST', { participants: replacement, preferences: {}, companions: { a: 'b' } })).status, 400);
  assert.deepEqual((await app.request('/api/state')).body, state);
  const imported = (await app.request('/api/import', 'POST', { participants: replacement, preferences: {} })).body;
  assert.deepEqual(imported.companions, { c: 'a' });
});
test('distance results accept companion candidate searches and restrict anchor keys to the three parts', async t => {
  const app = await fixture(t);
  const participants = [{ id: 'a', name: 'A', part: 'data' }, { id: 'b', name: 'B', part: 'data' }];
  const state = (await app.request('/api/import', 'POST', { participants, preferences: { a: ranking, b: [...ranking].reverse() }, companions: { a: 'b', b: 'a' } })).body;
  const result = allocateSeats({ participants, seats: SEATS, preferences: state.preferences, companions: state.companions, mode: 'distance', seed: 'distance-companion' });
  assert.ok(result.metrics.candidateCount > 7981);
  assert.equal(result.metrics.companionSatisfied, 2);
  const malformed = { ...result, anchors: { data: '207', dispatch: '206', map: '205', extra: '68' } };
  assert.equal((await app.request('/api/result', 'PUT', { fingerprint: stateFingerprint(state), result: malformed })).status, 400);
  const saved = await app.request('/api/result', 'PUT', { fingerprint: stateFingerprint(state), result });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
});


test('rejects a stable maximum-companion result with worse original preference ranks', async t => {
  const app = await fixture(t);
  const participants = [{ id: 'a', name: 'A', part: 'data' }, { id: 'b', name: 'B', part: 'map' }];
  const state = (await app.request('/api/import', 'POST', { participants, preferences: { a: ranking, b: ranking }, companions: { a: 'b' } })).body;
  const selected = allocateSeats({ participants, seats: SEATS, preferences: state.preferences, companions: state.companions, mode: 'preference', seed: 'selected-candidate' });
  assert.equal((await app.request('/api/result', 'PUT', { fingerprint: stateFingerprint(state), result: selected })).status, 200);
  const forged = structuredClone(selected);
  forged.companionPlan = [{ participantIds: ['a', 'b'], seatIds: ['87', '88'] }];
  forged.assignments = ['a', 'b'].map((participantId, index) => ({ participantId, seatId: ['87', '88'][index], rank: ranking.indexOf(['87', '88'][index]) + 1 }));
  forged.metrics.averageRank = forged.assignments.reduce((sum, entry) => sum + entry.rank, 0) / 2;
  forged.seatPriorities['87'] = ['a', 'b'];
  forged.seatPriorities['88'] = ['b', 'a'];
  const composite = buildMatchingPreferences(participants, SEATS, state.preferences, state.companions, forged.companionPlan);
  assert.deepEqual(findBlockingPairs(participants, SEATS, composite, forged.seatPriorities, forged.assignments), []);
  assert.equal(forged.metrics.companionSatisfied, selected.metrics.companionSatisfied);
  assert.ok(forged.metrics.averageRank > selected.metrics.averageRank);
  const rejected = await app.request('/api/result', 'PUT', { fingerprint: stateFingerprint(state), result: forged });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /선정한 배정 결과/);
  assert.deepEqual((await app.request('/api/state')).body.result, selected);
});

test('selected candidate validation rejects altered search counts, priorities, plans and anchors', async t => {
  const app = await fixture(t);
  const participants = [{ id: 'a', name: 'A', part: 'data' }, { id: 'b', name: 'B', part: 'map' }];
  const state = (await app.request('/api/import', 'POST', { participants, preferences: { a: ranking, b: ranking }, companions: { a: 'b' } })).body;
  const selected = allocateSeats({ participants, seats: SEATS, preferences: state.preferences, companions: state.companions, mode: 'distance', seed: 'metadata' });
  for (const mutate of [
    result => { result.metrics.candidateCount++; },
    result => { result.seatPriorities['207'].reverse(); },
    result => { result.companionPlan[0].participantIds.reverse(); result.companionPlan[0].seatIds.reverse(); },
    result => { result.anchors = { data: '207', dispatch: '206', map: '205' }; },
  ]) {
    const forged = structuredClone(selected);
    mutate(forged);
    const rejected = await app.request('/api/result', 'PUT', { fingerprint: stateFingerprint(state), result: forged });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error, /선정한 배정 결과/);
  }
  assert.equal((await app.request('/api/state')).body.result, null);
});
