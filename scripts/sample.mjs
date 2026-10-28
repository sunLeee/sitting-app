import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INITIAL_PARTICIPANTS, SEATS, PARTS } from '../data.mjs';
import { createRandomPreferences, DEFAULT_RANDOM_SEED } from '../random-preferences.mjs';
import { allocateSeats, findBlockingPairs } from '../matching.mjs';
import { createSheetTemplate, serializePreferenceSheet } from '../sheet-input.mjs';

const argument = name => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) throw new Error(`${name} 다음에 값을 입력해 주세요.`);
  return process.argv[index + 1];
};
const seed = argument('--seed') || DEFAULT_RANDOM_SEED;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = argument('--output') ? path.resolve(argument('--output')) : path.join(root, 'examples');
const preferences = createRandomPreferences(INITIAL_PARTICIPANTS, SEATS, seed);
const input = { participants: INITIAL_PARTICIPANTS, seats: SEATS, preferences, seed };
const result = allocateSeats({ ...input, mode: 'distance' });
const baseline = allocateSeats({ ...input, mode: 'preference' });
if (findBlockingPairs(input.participants, SEATS, preferences, result.seatPriorities, result.assignments).length) throw new Error('배정 결과의 안정성 검증에 실패했습니다.');
const rows = INITIAL_PARTICIPANTS.map(person => {
  const a = result.assignments.find(entry => entry.participantId === person.id);
  const seat = SEATS.find(seat => seat.id === a.seatId);
  return [person.name, PARTS[person.part].label, seat.zone, a.seatId, a.rank];
});
const vacancies = SEATS.filter(seat => !result.assignments.some(a => a.seatId === seat.id));
const percent = baseline.metrics.totalDistance ? (1 - result.metrics.totalDistance / baseline.metrics.totalDistance) * 100 : 0;
const csvCell = value => {
  let text = String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
const csvRows = [['이름', '파트', '구역', '좌석 번호', '배정 지망'], ...rows, ...vacancies.map(seat => ['빈자리', '', seat.zone, seat.id, ''])];
const markdown = `# 랜덤 선호 배정 결과\n\n시드: \`${seed.replaceAll('`', '')}\`\n\n- ${result.metrics.matchedCount}명 배정, 빈자리 ${result.metrics.vacancies}석\n- 평균 ${result.metrics.averageRank.toFixed(2)}지망, 3지망 이내 ${result.metrics.top3Count}명\n- 같은 파트 평균 거리 ${result.metrics.averageDistance.toFixed(4)} 상대 단위\n- 개인 선호 기준 대비 파트 거리 합 ${percent.toFixed(1)}% 감소\n- 비교 후보 ${result.metrics.candidateCount.toLocaleString()}개\n\n| 이름 | 파트 | 구역 | 좌석 | 배정 지망 |\n| --- | --- | --- | --- | ---: |\n${rows.map(row => '| ' + row.join(' | ') + ' |').join('\n')}\n\n빈자리: ${vacancies.map(seat => `${seat.zone}구역 ${seat.id}번`).join(', ') || '없음'}\n\n개인 선호 기준: 평균 ${baseline.metrics.averageRank.toFixed(2)}지망, 같은 파트 평균 거리 ${baseline.metrics.averageDistance.toFixed(4)}. 거리 수치는 도면의 상대 좌표이며, 탐색 후보 중 최소 거리입니다. 모든 배치의 전역 최솟값을 보장하지 않습니다.\n`;
await mkdir(output, { recursive: true });
const files = {
  'preference-template.csv': createSheetTemplate(input.participants, { includeBom: true }),
  'random-preferences.csv': serializePreferenceSheet(input.participants, preferences, { includeBom: true }),
  'random-preferences.tsv': serializePreferenceSheet(input.participants, preferences, { delimiter: '\t' }),
  'random-preferences.json': JSON.stringify({ format: 'jari-workspace-v1', version: 1, participants: input.participants, preferences, result: null, seed }, null, 2) + '\n',
  'random-result.csv': '\uFEFF' + csvRows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n',
  'random-result.json': JSON.stringify({ ...input, result, baselineMetrics: baseline.metrics }, null, 2) + '\n',
  'random-result.md': markdown,
};
for (const [name, content] of Object.entries(files)) await writeFile(path.join(output, name), content);
console.log(JSON.stringify({ seed, output, matched: result.metrics.matchedCount, vacancies: vacancies.map(seat => seat.id), averageRank: result.metrics.averageRank, top3Count: result.metrics.top3Count, averageDistance: result.metrics.averageDistance, distanceReductionPercent: percent, candidateCount: result.metrics.candidateCount }, null, 2));
