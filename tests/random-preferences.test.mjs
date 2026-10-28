import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { INITIAL_PARTICIPANTS, SEATS } from '../data.mjs';
import { createRandomPreferences } from '../random-preferences.mjs';
import { allocateSeats, findBlockingPairs } from '../matching.mjs';
import { parsePreferenceSheet } from '../sheet-input.mjs';

test('random preferences are 20 complete unique permutations, reproducible and input-order independent', () => {
  const preferences = createRandomPreferences();
  assert.equal(Object.keys(preferences).length, 20);
  for (const ranking of Object.values(preferences)) assert.deepEqual([...ranking].sort(), SEATS.map(s => s.id).sort());
  assert.equal(new Set(Object.values(preferences).map(r => r.join(','))).size, 20);
  assert.deepEqual(createRandomPreferences(), preferences);
  assert.deepEqual(createRandomPreferences([...INITIAL_PARTICIPANTS].reverse(), [...SEATS].reverse()), preferences);
  assert.notDeepEqual(createRandomPreferences(INITIAL_PARTICIPANTS, SEATS, 'another-seed'), preferences);
});
test('random preference generation rejects invalid inputs', () => {
  for (const seed of ['', ' '.repeat(2), null, 123, 'x'.repeat(129)]) assert.throws(() => createRandomPreferences(INITIAL_PARTICIPANTS, SEATS, seed));
  assert.throws(() => createRandomPreferences([]));
  assert.throws(() => createRandomPreferences([{ id: 'a', name: 'a', part: 'green' }]));
  assert.throws(() => createRandomPreferences(null));
});
test('random input yields stable allocation with one vacancy and improves on the included baseline', () => {
  const preferences = createRandomPreferences();
  const args = { participants: INITIAL_PARTICIPANTS, seats: SEATS, preferences, seed: 'jari-random-2026-10-28' };
  const result = allocateSeats({ ...args, mode: 'distance' });
  const baseline = allocateSeats({ ...args, mode: 'preference' });
  assert.equal(result.assignments.length, 20);
  assert.equal(new Set(result.assignments.map(a => a.seatId)).size, 20);
  assert.equal(result.metrics.vacancies, 1);
  assert.equal(result.metrics.averageRank, 3);
  assert.equal(result.metrics.top3Count, 14);
  assert.ok(result.metrics.totalDistance <= baseline.metrics.totalDistance);
  assert.deepEqual(findBlockingPairs(args.participants, SEATS, preferences, result.seatPriorities, result.assignments), []);
});
test('sample CLI generates importable Google Sheets data and reproducible result artifacts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jari-sample-'));
  try {
    const run = promisify(execFile);
    await run(process.execPath, ['scripts/sample.mjs', '--output', directory]);
    const csv = await readFile(path.join(directory, 'random-preferences.csv'), 'utf8');
    const tsv = await readFile(path.join(directory, 'random-preferences.tsv'), 'utf8');
    const json = JSON.parse(await readFile(path.join(directory, 'random-preferences.json'), 'utf8'));
    assert.equal(json.format, 'jari-workspace-v1');
    for (const text of [csv, tsv]) {
      const parsed = parsePreferenceSheet(text);
      assert.equal(parsed.valid, true);
      assert.deepEqual(parsed.preferences, json.preferences);
    }
    const result = JSON.parse(await readFile(path.join(directory, 'random-result.json'), 'utf8'));
    assert.equal(result.result.metrics.matchedCount, 20);
    assert.equal(result.result.metrics.vacancies, 1);
    assert.equal((await readFile(path.join(directory, 'random-result.csv'), 'utf8')).trim().split('\r\n').length, 22);
    assert.match(await readFile(path.join(directory, 'random-result.md'), 'utf8'), /노현구/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
