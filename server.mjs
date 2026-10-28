import http from 'node:http';
import { readFile, writeFile, mkdir, rename, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createInitialState, PARTS, SEATS, stateFingerprint } from './data.mjs';
import { findBlockingPairs } from './matching.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 1024 * 1024;
const seatIds = new Set(SEATS.map(seat => seat.id));
const publicFiles = new Set(['index.html', 'app.mjs', 'styles.css', 'data.mjs', 'matching.mjs', 'allocation-worker.mjs', 'sheet-input.mjs', 'random-preferences.mjs']);
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function requireThat(condition, message, status = 400) {
  if (!condition) throw new ApiError(status, message);
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validateParticipants(participants) {
  requireThat(Array.isArray(participants) && participants.length >= 1 && participants.length <= SEATS.length, '참가자는 1명 이상 21명 이하로 지정해 주세요.');
  const ids = new Set(), names = new Set();
  return participants.map(person => {
    requireThat(object(person) && typeof person.id === 'string' && person.id.trim() && person.id.length <= 100 && typeof person.name === 'string' && person.name.trim() && person.name.length <= 100, '참가자 ID와 이름을 입력해 주세요.');
    requireThat(Object.hasOwn(PARTS, person.part), '배차, 데이터, 맵 중 유효한 파트를 지정해 주세요.');
    requireThat(!ids.has(person.id) && !names.has(person.name.trim()), '참가자 ID 또는 이름이 중복되었습니다.');
    ids.add(person.id); names.add(person.name.trim());
    return { id: person.id, name: person.name.trim(), part: person.part };
  });
}
function validateRanking(ranking) {
  requireThat(Array.isArray(ranking) && ranking.length === SEATS.length && new Set(ranking).size === SEATS.length && ranking.every(id => seatIds.has(id)), '21개 좌석을 중복 없이 모두 지망 순서로 지정해 주세요.');
  return [...ranking];
}
function validatePreferences(preferences, participants) {
  requireThat(object(preferences), '지망 목록은 참가자 ID를 키로 하는 객체여야 합니다.');
  const known = new Set(participants.map(person => person.id));
  return Object.fromEntries(Object.entries(preferences).map(([id, ranking]) => {
    requireThat(known.has(id), '등록되지 않은 참가자의 지망 목록입니다.');
    return [id, validateRanking(ranking)];
  }));
}
function validateResult(result, state) {
  requireThat(object(result) && Array.isArray(result.assignments), '유효한 배정 결과가 필요합니다.');
  requireThat(['distance', 'preference'].includes(result.mode) && (typeof result.seed === 'string' || (typeof result.seed === 'number' && Number.isFinite(result.seed))), '배정 모드 또는 추첨 시드가 올바르지 않습니다.');
  requireThat(result.assignments.length === state.participants.length, '모든 참가자에게 한 자리씩 배정해야 합니다.');
  const people = new Map(state.participants.map(person => [person.id, person]));
  const assignedPeople = new Set(), assignedSeats = new Set();
  let rankSum = 0, top3Count = 0, totalDistance = 0, pairs = 0;
  for (const entry of result.assignments) {
    requireThat(object(entry) && people.has(entry.participantId) && seatIds.has(entry.seatId) && !assignedPeople.has(entry.participantId) && !assignedSeats.has(entry.seatId), '배정 결과에 중복 또는 알 수 없는 참가자/좌석이 있습니다.');
    requireThat(entry.rank === state.preferences[entry.participantId].indexOf(entry.seatId) + 1, '배정 지망 순위가 저장된 지망과 일치하지 않습니다.');
    assignedPeople.add(entry.participantId); assignedSeats.add(entry.seatId);
    rankSum += entry.rank; if (entry.rank <= 3) top3Count++;
  }
  const seats = new Map(SEATS.map(seat => [seat.id, seat]));
  result.assignments.forEach((a, i) => {
    for (const b of result.assignments.slice(i + 1)) {
      if (people.get(a.participantId).part === people.get(b.participantId).part) {
        const first = seats.get(a.seatId), second = seats.get(b.seatId);
        totalDistance += Math.hypot(first.x - second.x, first.y - second.y); pairs++;
      }
    }
  });
  const expected = { totalDistance, averageDistance: pairs ? totalDistance / pairs : 0, averageRank: rankSum / people.size, top3Count, matchedCount: people.size, vacancies: SEATS.length - people.size, candidateCount: result.mode === 'distance' ? 1 + SEATS.length * (SEATS.length - 1) * (SEATS.length - 2) : 1 };
  requireThat(object(result.metrics) && Object.entries(expected).every(([key, value]) => Number.isFinite(result.metrics[key]) && Math.abs(result.metrics[key] - value) <= 1e-8), '배정 통계가 실제 배정 결과와 일치하지 않습니다.');
  requireThat(result.anchors === null || (result.mode === 'distance' && object(result.anchors) && Object.keys(PARTS).every(part => seatIds.has(result.anchors[part])) && new Set(Object.values(result.anchors)).size === 3), '파트 기준 좌석이 올바르지 않습니다.');
  try {
    requireThat(findBlockingPairs(state.participants, SEATS, state.preferences, result.seatPriorities, result.assignments).length === 0, '안정적인 게일-섀플리 배정 결과가 아닙니다.');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, '좌석 우선순위 또는 배정 결과가 올바르지 않습니다.');
  }
  return structuredClone(result);
}
function validateState(value) {
  requireThat(object(value) && value.version === 1, '저장 데이터 버전이 올바르지 않습니다.');
  const participants = validateParticipants(value.participants);
  const preferences = validatePreferences(value.preferences, participants);
  const state = { version: 1, participants, preferences, result: null, updatedAt: value.updatedAt ?? null };
  requireThat(state.updatedAt === null || (typeof state.updatedAt === 'string' && Number.isFinite(Date.parse(state.updatedAt))), '저장 시간이 올바르지 않습니다.');
  if (value.result !== null && value.result !== undefined) {
    requireThat(participants.every(person => Object.hasOwn(preferences, person.id)), '저장 결과에 지망 목록이 누락되었습니다.');
    state.result = validateResult(value.result, state);
  }
  return state;
}
async function readJson(request) {
  requireThat(request.headers['content-type']?.split(';')[0].trim() === 'application/json', 'JSON 형식으로 요청해 주세요.', 415);
  requireThat(!(Number(request.headers['content-length']) > MAX_BODY), '요청은 1MiB 이하로 보내 주세요.', 413);
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    requireThat(size <= MAX_BODY, '요청은 1MiB 이하로 보내 주세요.', 413);
    chunks.push(chunk);
  }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); requireThat(object(value), '요청 본문은 JSON 객체여야 합니다.'); return value; }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'JSON 요청을 읽을 수 없습니다.'); }
}
function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
export async function createServer({ dataDir = path.join(ROOT, '.local-data'), rootDir = ROOT } = {}) {
  const stateFile = path.join(dataDir, 'workspace.json');
  let state;
  try { state = validateState(JSON.parse(await readFile(stateFile, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') state = createInitialState(); else throw new Error(`저장 데이터를 읽을 수 없습니다: ${error.message}`, { cause: error }); }
  let queue = Promise.resolve();
  async function save(next) {
    await mkdir(dataDir, { recursive: true });
    const temporary = path.join(dataDir, `.workspace-${randomUUID()}.tmp`);
    try { await writeFile(temporary, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 }); await rename(temporary, stateFile); }
    finally { await rm(temporary, { force: true }); }
    state = next;
  }
  const server = http.createServer(async (request, response) => {
    try {
      // Validate raw path before URL normalization can erase traversal segments.
      let pathname;
      try { pathname = decodeURIComponent(request.url.split('?')[0]); } catch { throw new ApiError(400, '올바르지 않은 주소입니다.'); }
      requireThat(!pathname.includes('\\') && !pathname.includes('\0') && !pathname.split('/').some(segment => segment === '..' || segment === '.') && !/%[0-9a-f]{2}/i.test(pathname), '접근할 수 없는 경로입니다.', 403);
      if (pathname.startsWith('/api/')) {
        if (request.method === 'GET' && pathname === '/api/state') { await queue; return json(response, 200, state); }
        const preferenceMatch = /^\/api\/preferences\/([^/]+)$/.exec(pathname);
        const allowed = (request.method === 'PUT' && (preferenceMatch || ['/api/participants', '/api/result'].includes(pathname))) || (request.method === 'POST' && pathname === '/api/import');
        requireThat(allowed, '요청한 API를 찾을 수 없습니다.', 404);
        const body = await readJson(request);
        const mutation = queue.then(async () => {
          const next = structuredClone(state);
          if (preferenceMatch) {
            const id = preferenceMatch[1];
            requireThat(next.participants.some(person => person.id === id), '참가자를 찾을 수 없습니다.', 404);
            Object.defineProperty(next.preferences, id, { value: validateRanking(body.ranking), enumerable: true, configurable: true, writable: true });
            next.result = null;
          } else if (pathname === '/api/participants') {
            next.participants = validateParticipants(body.participants);
            next.preferences = Object.fromEntries(next.participants.filter(person => Object.hasOwn(state.preferences, person.id)).map(person => [person.id, state.preferences[person.id]]));
            next.result = null;
          } else if (pathname === '/api/result') {
            requireThat(body.fingerprint === stateFingerprint(state), '지망 또는 참가자가 변경되었습니다. 최신 데이터로 다시 추첨해 주세요.', 409);
            requireThat(next.participants.every(person => Object.hasOwn(next.preferences, person.id)), '모든 참가자의 21지망을 먼저 저장해 주세요.', 409);
            next.result = validateResult(body.result, next);
          } else {
            if (Object.hasOwn(body, 'participants')) {
              next.participants = validateParticipants(body.participants);
              next.preferences = Object.fromEntries(next.participants.filter(person => Object.hasOwn(state.preferences, person.id)).map(person => [person.id, state.preferences[person.id]]));
            }
            const imported = validatePreferences(body.preferences, next.participants);
            next.preferences = { ...next.preferences, ...imported };
            next.result = null;
          }
          next.updatedAt = new Date().toISOString();
          await save(next);
          return next;
        });
        queue = mutation.then(() => undefined, () => undefined);
        return json(response, 200, await mutation);
      }
      requireThat(['GET', 'HEAD'].includes(request.method), '허용되지 않은 요청 방식입니다.', 405);
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      requireThat(publicFiles.has(relative) || /^assets\/[\w./-]+$/.test(relative), '파일을 찾을 수 없습니다.', 404);
      const file = await realpath(path.join(rootDir, relative));
      const root = await realpath(rootDir);
      requireThat(file.startsWith(`${root}${path.sep}`), '접근할 수 없는 경로입니다.', 403);
      if (relative.startsWith('assets/')) {
        const assets = await realpath(path.join(rootDir, 'assets'));
        requireThat(assets.startsWith(`${root}${path.sep}`) && file.startsWith(`${assets}${path.sep}`), '접근할 수 없는 경로입니다.', 403);
      }
      const bytes = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (!response.headersSent) json(response, error.status ?? (error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500), { error: error.status ? error.message : error.code === 'ENOENT' || error.code === 'EISDIR' ? '파일을 찾을 수 없습니다.' : '저장 또는 요청 처리 중 오류가 발생했습니다.' });
      else response.end();
    }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argument = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
  const host = argument('--host') ?? process.env.HOST ?? '127.0.0.1';
  const port = Number(argument('--port') ?? process.env.PORT ?? 5180);
  requireThat(Number.isInteger(port) && port >= 0 && port <= 65535, '포트 번호는 0부터 65535 사이여야 합니다.');
  const server = await createServer();
  server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = port < 65535 ? port + 1 : 5180;
      console.error(`${host}:${port} 포트가 사용 중입니다. 다른 포트로 실행하세요: npm start -- --port ${nextPort}`);
    } else {
      console.error(`서버를 실행할 수 없습니다 (${error.code ?? '오류'}): ${error.message}`);
    }
    process.exitCode = 1;
  });
  server.listen(port, host, () => console.log(`자리추첨 페이지: http://${host}:${server.address().port}`));
}
