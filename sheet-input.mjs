import { INITIAL_PARTICIPANTS, PARTS, SEATS } from './data.mjs';
import { validatePreferences } from './matching.mjs';

const headersFor = seats => ['이름', '파트', ...seats.map((_, i) => `${i + 1}지망`)];
export const SHEET_HEADERS = headersFor(SEATS);
const normalizeHeader = value => value.trim().replace(/\s+/g, '');
const partAliases = new Map(Object.entries(PARTS).flatMap(([id, part]) => [id, part.label, part.fullLabel].map(label => [label.replace(/\s+/g, '').toLowerCase(), id])));

function detectDelimiter(text) {
  let quoted = false, commas = 0, tabs = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (c === '\r' || c === '\n') break;
      if (c === ',') commas++;
      if (c === '\t') tabs++;
    }
  }
  return tabs > commas ? '\t' : ',';
}

// Parse logical spreadsheet rows, preserving quoted commas, tabs and newlines.
function readTable(text, delimiter) {
  const rows = [];
  let row = [], field = '', quoted = false, afterQuote = false;
  const error = message => ({ row: rows.length + 1, column: row.length + 1, message });
  const endField = () => { row.push(field); field = ''; afterQuote = false; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else field += c;
      continue;
    }
    if (c === delimiter) { endField(); continue; }
    if (c === '\r' || c === '\n') { endRow(); if (c === '\r' && text[i + 1] === '\n') i++; continue; }
    if (afterQuote) {
      if (c === ' ' || c === '\t') continue;
      return { rows, error: error('닫힌 따옴표 뒤에는 구분자나 줄바꿈만 올 수 있습니다.') };
    }
    if (c === '"') {
      if (field.trim()) return { rows, error: error('셀 안의 따옴표는 CSV 형식으로 감싸고 두 번 입력해 주세요.') };
      field = ''; quoted = true;
    } else field += c;
  }
  if (quoted) return { rows, error: error('닫히지 않은 따옴표가 있습니다. CSV 파일의 셀을 확인해 주세요.') };
  if (row.length || field || afterQuote) endRow();
  return { rows, error: null };
}

export function parsePreferenceSheet(text, { participants = INITIAL_PARTICIPANTS, seats = SEATS, delimiter = 'auto' } = {}) {
  const output = { valid: false, errors: [], preferences: {}, rows: [], delimiter: ',' };
  const fail = (row, column, message) => output.errors.push({ row, column, message });
  if (typeof text !== 'string' || !text.trim()) { fail(1, 1, '머리글을 포함한 Google Sheets 표를 붙여넣어 주세요.'); return output; }
  if (new TextEncoder().encode(text).length > 1024 * 1024) { fail(1, 1, '표는 1MB 이하로 입력해 주세요.'); return output; }
  if (!Array.isArray(participants) || !Array.isArray(seats) || !participants.length || !seats.length) { fail(1, 1, '참여자와 좌석 목록을 먼저 등록해 주세요.'); return output; }
  text = text.replace(/^\uFEFF/, '');
  output.delimiter = delimiter === 'auto' ? detectDelimiter(text) : delimiter;
  if (![',', '\t'].includes(output.delimiter)) { fail(1, 1, '쉼표 CSV 또는 탭 TSV 형식으로 입력해 주세요.'); return output; }
  const parsed = readTable(text, output.delimiter);
  if (parsed.error) { output.errors.push(parsed.error); return output; }
  const table = parsed.rows;
  if (!table.length) { fail(1, 1, '표의 머리글과 참여자 행이 필요합니다.'); return output; }
  const required = headersFor(seats);
  const header = table[0].map(normalizeHeader);
  const indices = new Map();
  for (const label of required) {
    const positions = header.flatMap((cell, i) => cell === label ? [i] : []);
    if (!positions.length) fail(1, 1, `머리글에 '${label}' 열이 필요합니다.`);
    else if (positions.length > 1) fail(1, positions[1] + 1, `'${label}' 머리글이 중복됐습니다.`);
    else indices.set(label, positions[0]);
  }
  if (output.errors.length) return output;
  if (table.slice(1).filter(row => row.some(cell => cell.trim())).length > participants.length) {
    fail(participants.length + 2, 1, `현재 명단 ${participants.length}명보다 입력 행이 많습니다. 참여자 관리와 표의 중복 행을 확인해 주세요.`);
    return output;
  }
  const known = new Map();
  for (const person of participants) {
    if (!person || typeof person.name !== 'string' || known.has(person.name.trim())) { fail(1, 1, '참여자 명단의 이름 중복을 먼저 확인해 주세요.'); return output; }
    known.set(person.name.trim(), person);
  }
  const seatIds = new Set(seats.map(seat => seat.id));
  const seenPeople = new Set();
  const entries = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    if (cells.every(cell => !cell.trim())) continue;
    const rowNumber = i + 1;
    const cell = label => (cells[indices.get(label)] || '').trim();
    const rawName = cell('이름');
    const person = known.get(rawName) || (rawName.startsWith("'") ? known.get(rawName.slice(1)) : undefined);
    const name = person ? person.name.trim() : rawName;
    const inputPart = cell('파트');
    const part = partAliases.get(inputPart.replace(/\s+/g, '').toLowerCase()) || null;
    const ranking = seats.map((_, index) => cell(`${index + 1}지망`));
    output.rows.push({ row: rowNumber, participantId: person?.id || null, name, part, inputPart, ranking });
    if (!name) fail(rowNumber, indices.get('이름') + 1, '이름을 입력해 주세요.');
    else if (!person) fail(rowNumber, indices.get('이름') + 1, `${name}: 등록되지 않은 이름입니다. 참여자 관리에서 먼저 추가해 주세요.`);
    else if (seenPeople.has(person.id)) fail(rowNumber, indices.get('이름') + 1, `${name}: 같은 참여자가 표에 두 번 들어 있습니다.`);
    if (person) seenPeople.add(person.id);
    if (!part) fail(rowNumber, indices.get('파트') + 1, `${name || '참여자'}: 파트를 데이터, 배차, 맵 중 하나로 입력해 주세요.`);
    else if (person && part !== person.part) fail(rowNumber, indices.get('파트') + 1, `${name}: 등록된 파트는 ${PARTS[person.part].label}입니다. 명단 또는 표를 확인해 주세요.`);
    const seenSeats = new Set();
    ranking.forEach((id, rank) => {
      const column = indices.get(`${rank + 1}지망`) + 1;
      if (!id) fail(rowNumber, column, `${name || '참여자'}: ${rank + 1}지망이 비어 있습니다.`);
      else if (!seatIds.has(id)) fail(rowNumber, column, `${name || '참여자'}: ${rank + 1}지망 '${id}'는 존재하지 않는 좌석입니다.`);
      else if (seenSeats.has(id)) fail(rowNumber, column, `${name || '참여자'}: 좌석 ${id}번이 지망에 중복됐습니다.`);
      seenSeats.add(id);
    });
    if (person) entries.push([person.id, ranking]);
  }
  if (!output.rows.length) fail(2, 1, '참여자와 21개 지망을 담은 행을 한 개 이상 입력해 주세요.');
  if (!output.errors.length) {
    output.preferences = Object.fromEntries(entries);
    const chosen = participants.filter(person => Object.hasOwn(output.preferences, person.id));
    const validation = validatePreferences(chosen, seats, output.preferences);
    if (!validation.valid) {
      fail(1, 1, validation.errors[0]);
      output.preferences = {};
    } else output.valid = true;
  }
  return output;
}

function writeTable(rows, delimiter, includeBom) {
  if (![',', '\t'].includes(delimiter)) throw new Error('CSV 또는 TSV 구분자를 지정해 주세요.');
  const quote = value => {
    let text = String(value);
    // Preserve literal text when imported into spreadsheet software.
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return /["\r\n]/.test(text) || text.includes(delimiter) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return (includeBom ? '\uFEFF' : '') + rows.map(row => row.map(quote).join(delimiter)).join('\r\n') + '\r\n';
}

export function createSheetTemplate(participants = INITIAL_PARTICIPANTS, { delimiter = ',', includeBom = false, seats = SEATS } = {}) {
  const rows = [headersFor(seats), ...participants.map(p => [p.name, PARTS[p.part].label, ...seats.map(() => '')])];
  return writeTable(rows, delimiter, includeBom);
}

export function serializePreferenceSheet(participants, preferences, { delimiter = ',', includeBom = false, seats = SEATS } = {}) {
  const chosen = participants.filter(person => Object.hasOwn(preferences, person.id));
  if (Object.keys(preferences).length) {
    const validation = validatePreferences(chosen, seats, preferences);
    if (!validation.valid) throw new Error(validation.errors.join('\n'));
  }
  const rows = [headersFor(seats), ...chosen.map(p => [p.name, PARTS[p.part].label, ...preferences[p.id]])];
  return writeTable(rows, delimiter, includeBom);
}
