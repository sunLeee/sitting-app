import assert from 'node:assert/strict';
import test from 'node:test';
import { INITIAL_PARTICIPANTS, SEATS } from '../data.mjs';
import { createRandomPreferences } from '../random-preferences.mjs';
import { SHEET_HEADERS, parsePreferenceSheet, createSheetTemplate, createSheetTemplateRows, serializePreferenceSheet } from '../sheet-input.mjs';
const people = INITIAL_PARTICIPANTS;
const preferences = createRandomPreferences();
const one = people.slice(0, 1);
const single = { [one[0].id]: preferences[one[0].id] };

test('CSV and Google Sheets TSV roundtrip all 20 complete rankings with BOM and CRLF', () => {
  for (const delimiter of [',', '\t']) {
    const table = serializePreferenceSheet(people, preferences, { delimiter, includeBom: true });
    const parsed = parsePreferenceSheet(table);
    assert.equal(parsed.valid, true, JSON.stringify(parsed.errors));
    assert.deepEqual(parsed.preferences, preferences);
    assert.equal(parsed.rows.length, 20);
    assert.equal(parsed.delimiter, delimiter);
    assert.equal(parsed.rows[0].name, '노현구');
  }
});
test('blank template includes 24 headers and all known people and requires real choices', () => {
  const table = createSheetTemplate();
  assert.equal(table.split('\r\n')[0].split(',').length, 24);
  assert.equal(SHEET_HEADERS.at(-1), '함께 앉고 싶은 동료');
  assert.equal(createSheetTemplateRows().length, 21);
  assert.ok(createSheetTemplateRows().every(row => row.length === 24));
  const parsed = parsePreferenceSheet(table);
  assert.equal(parsed.rows.length, 20);
  assert.equal(parsed.valid, false);
  assert.deepEqual(parsed.preferences, {});
  assert.ok(parsed.errors.some(e => e.row === 2 && e.column === 3));
});
test('quoted names preserve delimiters, double quotes and embedded newlines', () => {
  for (const name of ['성,이름', '성\t이름', '성"이름', '성\n이름']) {
    const participants = [{ ...one[0], name }];
    for (const delimiter of [',', '\t']) {
      const parsed = parsePreferenceSheet(serializePreferenceSheet(participants, single, { delimiter }), { participants });
      assert.equal(parsed.valid, true, JSON.stringify(parsed.errors));
      assert.equal(parsed.rows[0].name, name);
      assert.deepEqual(parsed.preferences, single);
    }
  }
});
test('reordered headers and additional columns retain the correct preference order', () => {
  const headers = ['비고', ...SHEET_HEADERS.toReversed()];
  const data = Object.fromEntries([['이름', one[0].name], ['파트', '데이터플랫폼 파트'], ['함께 앉고 싶은 동료', people[1].name], ...single[one[0].id].map((id, i) => [`${i + 1}지망`, id])]);
  const text = headers.join('\t') + '\n' + headers.map(h => data[h] || '메모').join('\t');
  const parsed = parsePreferenceSheet(text);
  assert.equal(parsed.valid, true, JSON.stringify(parsed.errors));
  assert.deepEqual(parsed.preferences, single);
});
test('one bad row rejects the entire batch, without silently committing good rows', () => {
  const broken = structuredClone(preferences);
  broken['data-2'][20] = broken['data-2'][0];
  const good = serializePreferenceSheet(people, preferences);
  const lines = good.trim().split('\r\n');
  lines[2] = [people[1].name, '데이터', ...broken['data-2']].join(',');
  const parsed = parsePreferenceSheet(lines.join('\n'));
  assert.equal(parsed.valid, false);
  assert.deepEqual(parsed.preferences, {});
  assert.ok(parsed.errors.some(e => e.row === 3 && e.column === 23 && e.message.includes('중복')));
});
test('missing, duplicate, unknown and formula choices return actionable cell errors', () => {
  for (const value of ['', '999', '=68', "'68", single[one[0].id][0]]) {
    const ranking = [...single[one[0].id]]; ranking[20] = value;
    const parsed = parsePreferenceSheet([SHEET_HEADERS.join(','), [one[0].name, '데이터', ...ranking].join(',')].join('\n'));
    assert.equal(parsed.valid, false);
    assert.deepEqual(parsed.preferences, {});
    assert.ok(parsed.errors.some(e => e.row === 2 && e.column === 23));
  }
});
test('unknown or duplicate participants and mismatched parts fail', () => {
  const line = [one[0].name, '데이터', ...single[one[0].id]].join(',');
  for (const rows of [[line, line], [line.replace(one[0].name, '미등록인원')], [line.replace('데이터', '맵')], [line.replace('데이터', '초록')]]) {
    const parsed = parsePreferenceSheet([SHEET_HEADERS.join(','), ...rows].join('\n'));
    assert.equal(parsed.valid, false);
    assert.deepEqual(parsed.preferences, {});
  }
});
test('missing and duplicate required headers are rejected before data is applied', () => {
  for (const headers of [SHEET_HEADERS.slice(1), [...SHEET_HEADERS, '1지망']]) {
    const parsed = parsePreferenceSheet(headers.join(',') + '\n' + [one[0].name, '데이터', ...single[one[0].id]].join(','));
    assert.equal(parsed.valid, false);
    assert.ok(parsed.errors.some(e => e.row === 1));
  }
});
test('malformed quote syntax, oversized input and empty tables are rejected', () => {
  for (const text of ['', '  ', SHEET_HEADERS.join(','), '"이름,파트', '이"름,파트', '"이름"bad,파트', '가'.repeat(400000)]) {
    const parsed = parsePreferenceSheet(text);
    assert.equal(parsed.valid, false);
    assert.ok(parsed.errors.length);
  }
});
test('blank trailing rows do not add phantom participants and single-person files can be merged', () => {
  const parsed = parsePreferenceSheet(serializePreferenceSheet(one, single) + '\r\n,,,\r\n');
  assert.equal(parsed.valid, true);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.preferences, single);
});

test('more data rows than registered people are rejected before constructing a large preview', () => {
  const text = [SHEET_HEADERS.join(','), ...Array.from({ length: 21 }, () => [one[0].name, '데이터', ...single[one[0].id]].join(','))].join('\n');
  const parsed = parsePreferenceSheet(text);
  assert.equal(parsed.valid, false);
  assert.equal(parsed.rows.length, 0);
  assert.match(parsed.errors[0].message, /입력 행이 많/);
});
test('spreadsheet formula-like names export as literal text and roundtrip against the roster', () => {
  const participants = [{ ...one[0], name: '=LiteralName' }];
  const parsed = parsePreferenceSheet(serializePreferenceSheet(participants, single), { participants });
  assert.equal(parsed.valid, true, JSON.stringify(parsed.errors));
  assert.equal(parsed.rows[0].name, '=LiteralName');
});

test('legacy 23-column imports preserve companions and optional blank column explicitly clears', () => {
  const legacy = [SHEET_HEADERS.slice(0, -1).join(','), [one[0].name, '데이터', ...single[one[0].id]].join(',')].join('\n');
  const parsedLegacy = parsePreferenceSheet(legacy);
  assert.equal(parsedLegacy.valid, true);
  assert.deepEqual(parsedLegacy.companions, {});
  const parsedNew = parsePreferenceSheet(serializePreferenceSheet(people, single));
  assert.equal(parsedNew.valid, true);
  assert.deepEqual(parsedNew.companions, { [one[0].id]: null });
});
test('24-column CSV and TSV roundtrip companion names against the complete current roster', () => {
  const companions = { [people[0].id]: people[1].id, [people[1].id]: people[0].id };
  for (const delimiter of [',', '\t']) {
    const parsed = parsePreferenceSheet(serializePreferenceSheet(people, preferences, { companions, delimiter }));
    assert.equal(parsed.valid, true, JSON.stringify(parsed.errors));
    assert.equal(parsed.companions[people[0].id], people[1].id);
    assert.equal(parsed.companions[people[1].id], people[0].id);
    assert.equal(parsed.rows[0].companionName, people[1].name);
    assert.equal(parsed.rows[0].companionId, people[1].id);
  }
  const partial = parsePreferenceSheet(serializePreferenceSheet(people, single, { companions }));
  assert.equal(partial.valid, true);
  assert.deepEqual(partial.companions, { [people[0].id]: people[1].id });
});
test('optional companion aliases normalize whitespace and reject duplicate, unknown and self names atomically', () => {
  for (const label of ['함께 앉고 싶은 동료', 'C 구역 희망 동료', '동료 선호']) {
    const parsed = parsePreferenceSheet([[...SHEET_HEADERS.slice(0, -1), label].join(','), [one[0].name, '데이터', ...single[one[0].id], people[1].name].join(',')].join('\n'));
    assert.equal(parsed.valid, true, JSON.stringify(parsed.errors));
  }
  for (const name of ['미등록동료', one[0].name]) {
    const parsed = parsePreferenceSheet([SHEET_HEADERS.join(','), [one[0].name, '데이터', ...single[one[0].id], name].join(',')].join('\n'));
    assert.equal(parsed.valid, false);
    assert.deepEqual(parsed.preferences, {});
    assert.deepEqual(parsed.companions, {});
    assert.ok(parsed.errors.some(error => error.column === 24));
  }
  const duplicate = parsePreferenceSheet([...SHEET_HEADERS, '동료선호'].join(',') + '\n');
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.errors.some(error => error.row === 1 && error.message.includes('중복')));
  assert.throws(() => serializePreferenceSheet(people, single, { companions: { [one[0].id]: 'unknown' } }));
});
