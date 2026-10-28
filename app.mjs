import { PARTS, ZONES, SEATS, C_SEAT_PAIRS, INITIAL_PARTICIPANTS, createInitialState, createDemoPreferences, stateFingerprint } from './data.mjs';
import { validatePreferences, findBlockingPairs, buildMatchingPreferences } from './matching.mjs';
import { normalizeCompanions, getAssignedCompanion } from './companion.mjs';
import { PREFERENCE_SHEET_URL, TEMPLATE_COPY_URL } from './sheet-template-config.mjs';
import { parsePreferenceSheet, createSheetTemplate, serializePreferenceSheet, SHEET_HEADERS } from './sheet-input.mjs';
import { createRandomPreferences, DEFAULT_RANDOM_SEED } from './random-preferences.mjs';
import { allocateRandomSeats } from './random-allocation.mjs';

const icons = {
  chair: '<rect x="7" y="3" width="10" height="10" rx="3"/><path d="M4 11v6h16v-6M8 17v4m8-4v4m-4-8v4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',
  chart: '<path d="M4 4v16h16M8 15v-4m5 4V7m5 8v-6"/>',
  building: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h1m4 0h1M9 11h1m4 0h1m-5 6v4m4-4v4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  checkcircle: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  electric: '<path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/>',
  partition: '<path d="M3 20V5h18v15M9 5v15m6-15v15"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2.12 2.12 0 0 0-3-3L6 16l-2 4Z"/>',
  leaf: '<path d="M20 3C9 1 3 8 5 14c1 4 6 6 10 3 4-3 5-8 5-14ZM4 21 15 9"/>',
  door: '<path d="M3 21h18M5 21V3h14v18m-5-10h.01"/>',
  printer: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6zm12-2h.01"/>',
  grip: '<path d="M8 5h.01m7 0h.01M8 12h.01m7 0h.01M8 19h.01m7 0h.01"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
};
const icon = (name, className = '') => `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.chair}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rankLabel = rank => rank === null ? '완전 랜덤 배정' : `${rank}지망`;
const seatById = new Map(SEATS.map(s => [s.id, s]));
const storageKeys = { state: 'jari-workspace-v1', drafts: 'jari-drafts-v1', companions: 'jari-companion-drafts-v1', person: 'jari-current-person-v1' };
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
let workspace = createInitialState();
let backend = false;
const urlParams = new URLSearchParams(location.search);
let demo = urlParams.has('demo');
let view = ['seats', 'preferences', 'results'].includes(urlParams.get('view')) ? urlParams.get('view') : 'seats';
let currentId = readStorage(storageKeys.person, 'data-1');
let drafts = readStorage(storageKeys.drafts, {});
if (!drafts || typeof drafts !== 'object' || Array.isArray(drafts)) drafts = {};
let companionDrafts = readStorage(storageKeys.companions, {});
if (!companionDrafts || typeof companionDrafts !== 'object' || Array.isArray(companionDrafts)) companionDrafts = {};
let selectedSeat = '68';
let zoom = 100;
let filter = 'all';
let search = '';
let busy = false;
let toastTimer;
let dialogReturnFocus;
let draggedRank = null;
let rosterDraft = [];
let syncing = false;
let actionPending = false;
let workspaceRevision = 0;
let sheetText = '';
let sheetPreview = null;
let importReadRevision = 0;

function readStorage(key, fallback) {
  try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); } catch { return fallback; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
function toast(message, error = false) {
  const el = document.querySelector('#toast');
  clearTimeout(toastTimer);
  el.textContent = message;
  el.className = `visible${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => el.classList.remove('visible'), error ? 6500 : 3700);
}
function currentPerson() { return workspace.participants.find(p => p.id === currentId) || workspace.participants[0]; }
function getDraft(personId = currentPerson()?.id) {
  const candidate = Object.hasOwn(drafts, personId) ? drafts[personId] : workspace.preferences[personId] || [];
  return Array.isArray(candidate) ? [...new Set(candidate.filter(id => seatById.has(id)))] : [];
}
function setDraft(ranking) {
  drafts[currentPerson().id] = [...ranking];
  if (!demo && !writeStorage(storageKeys.drafts, drafts)) toast('이 브라우저에 임시 저장할 수 없습니다. 선호를 저장하거나 파일로 내려받아 주세요.', true);
}
function getCompanionDraft(personId = currentPerson()?.id) {
  const target = Object.hasOwn(companionDrafts, personId) ? companionDrafts[personId] : workspace.companions[personId];
  return target !== personId && workspace.participants.some(person => person.id === target) ? target : null;
}
function setCompanionDraft(target) {
  companionDrafts[currentPerson().id] = target || null;
  if (!demo && !writeStorage(storageKeys.companions, companionDrafts)) toast('희망 동료를 임시 저장할 수 없습니다. 선호를 저장해 주세요.', true);
}
function pruneCompanions(companions, participants) {
  const ids = new Set(participants.map(person => person.id));
  return Object.fromEntries(Object.entries(companions).filter(([id, target]) => ids.has(id) && ids.has(target) && id !== target));
}
function sanitizeCompanionDrafts() {
  const ids = new Set(workspace.participants.map(person => person.id));
  for (const [id, target] of Object.entries(companionDrafts)) {
    if (!ids.has(id)) delete companionDrafts[id];
    else if (target !== null && (!ids.has(target) || target === id)) companionDrafts[id] = null;
  }
  if (!demo) writeStorage(storageKeys.companions, companionDrafts);
}
const pairedSeat = id => C_SEAT_PAIRS.find(pair => pair.includes(id))?.find(other => other !== id);
function companionStatus(personId, result = workspace.result) {
  if (result.mode === 'random') return '랜덤 추첨 · 희망 동료 미반영';
  const target = workspace.companions[personId];
  return target ? getAssignedCompanion(personId, SEATS, result.assignments) === target ? '희망 동료와 함께 배정' : '희망 동료 요청 미충족' : '선호 없음';
}
function submittedCount() { return workspace.participants.filter(p => Array.isArray(workspace.preferences[p.id]) && workspace.preferences[p.id].length === SEATS.length).length; }
function allSubmitted() { return submittedCount() === workspace.participants.length && workspace.participants.length > 0; }
function partChip(part) { return `<span class="part-chip ${esc(part)}"><span class="part-dot ${esc(part)}"></span>${esc(PARTS[part].label)}</span>`; }
function timestamp(value) { return value ? new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : ''; }
function setWorkspace(value) {
  workspace = { ...value, companions: normalizeCompanions(value.participants, value.companions === undefined ? {} : value.companions) };
  sanitizeCompanionDrafts();
  workspaceRevision++;
  if (!workspace.participants.some(p => p.id === currentId)) currentId = workspace.participants[0]?.id;
  if (!demo && !backend && !writeStorage(storageKeys.state, workspace)) toast('브라우저 저장 공간이 부족합니다. 백업 파일을 내려받아 주세요.', true);
}
async function api(path, options = {}) {
  const { timeoutMs = 12000, ...requestOptions } = options;
  const response = await fetch(path, { ...requestOptions, headers: { 'Content-Type': 'application/json', ...requestOptions.headers }, signal: AbortSignal.timeout(timeoutMs) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '저장하지 못했습니다. 다시 시도해 주세요.');
  return payload;
}

function render() {
  const person = currentPerson();
  const isResult = view === 'results';
  const result = workspace.result;
  const count = submittedCount();
  app.innerHTML = `
    <aside class="sidebar" aria-label="워크스페이스 메뉴">
      <div class="brand"><span class="brand-mark">${icon('chair')}</span><span class="brand-name">자리</span><span class="brand-label">jari</span></div>
      <div class="workspace-tile"><span class="avatar">P</span><div><strong>플랫폼개발팀</strong><small>13층 워크스페이스</small></div></div>
      <p class="nav-caption">WORKSPACE</p>
      <nav class="nav" aria-label="주 메뉴">
        <button class="nav-button ${view === 'seats' ? 'active' : ''}" data-action="navigate" data-view="seats" aria-label="좌석 둘러보기" ${view === 'seats' ? 'aria-current="page"' : ''}>${icon('grid')}<span class="nav-text">좌석 둘러보기</span></button>
        <button class="nav-button ${view === 'preferences' ? 'active' : ''}" data-action="navigate" data-view="preferences" aria-label="선호 입력" ${view === 'preferences' ? 'aria-current="page"' : ''}>${icon('list')}<span class="nav-text">선호 입력</span><span class="nav-count">${count}/${workspace.participants.length}</span></button>
        <button class="nav-button ${isResult ? 'active' : ''}" data-action="navigate" data-view="results" aria-label="배정 결과" ${isResult ? 'aria-current="page"' : ''}>${icon('chart')}<span class="nav-text">배정 결과</span></button>
      </nav>
      <div class="nav-divider"></div>
      <nav class="nav" aria-label="도움말 및 파일">
        <button class="nav-button" data-action="guide">${icon('help')}<span class="nav-text">배정 가이드</span></button>
        <button class="nav-button" data-action="export-workspace">${icon('download')}<span class="nav-text">워크스페이스 백업</span></button>
      </nav>
      <div class="sidebar-spacer"></div>
      <div class="sidebar-note"><span class="note-icon">${icon('leaf')}</span><strong>좋은 동료 곁에,<br>나에게 맞는 자리.</strong><p>선호를 담아 공정하게.<br>우리의 다음 자리를 함께 정해요.</p><button data-action="enter-demo">미리 체험하기 ${icon('arrow')}</button><button class="random-demo-link" data-action="enter-random-demo">랜덤 배정 결과 보기 ${icon('arrow')}</button></div>
      <div class="sidebar-footer"><span class="avatar">J</span><span>함께 만드는 워크스페이스</span></div>
    </aside>
    <div class="main-shell">
      <header class="topbar"><div class="breadcrumb">${icon('building')}<span>플랫폼개발팀</span><span>/</span><strong>13층 자리 추첨</strong></div><div class="topbar-actions"><span class="connection"><span class="status-dot"></span>${demo ? '예시 워크스페이스' : backend ? '로컬 서버 연결됨' : '브라우저 저장 모드'}</span><span class="avatar">P</span></div></header>
      <main id="main" class="content">
        <div class="intro"><div><p class="eyebrow">A BETTER PLACE TO WORK, TOGETHER</p><h1>${isResult && result ? '우리의 새로운 자리' : view === 'preferences' ? '내가 원하는 자리부터' : '좋은 자리, 함께 정해요'}</h1><p class="intro-description">${isResult && result ? result.mode === 'random' ? '전원의 좌석을 랜덤으로 추첨했습니다. 새로운 자리를 확인해 보세요.' : '선호를 존중하고, 같은 파트는 더 가까이. 새로운 자리를 확인해 보세요.' : '개인의 선호는 존중하고, 같은 파트는 더 가까이.'}</p></div><div class="intro-actions"><button class="btn" data-action="manage">${icon('users')} 참여자 관리</button><button class="btn" data-action="public-sheet">${icon('upload')}공개 시트로 배정</button><a class="btn" href="${esc(TEMPLATE_COPY_URL)}" target="_blank" rel="noopener noreferrer">Google Sheets 새로 만들기</a><button class="btn btn-soft" data-action="random-settings">${icon('sparkle')}올 랜덤</button><button class="btn btn-primary" data-action="${isResult && result ? 'download-csv' : 'draw-settings'}" ${!allSubmitted() && !(isResult && result) ? `disabled title="모든 참여자가 21개 선호를 저장하면 배정할 수 있습니다"` : ''}>${icon(isResult && result ? 'download' : 'sparkle')}${isResult && result ? '결과 내려받기' : '배정 시작하기'}</button></div></div>
        ${demo ? '<div class="demo-banner"><div><strong>미리보기 모드</strong> · 예시 선호로 체험 중이며 실제 제출 내역은 바뀌지 않습니다.</div><button data-action="exit-demo">실제 입력으로 돌아가기</button></div>' : ''}
        <div class="steps" aria-label="자리 배정 진행 단계">
          <button class="step ${view === 'seats' ? 'active' : ''} ${count > 0 ? 'complete' : ''}" data-action="navigate" data-view="seats"><span class="step-number">${count > 0 ? icon('check') : '01'}</span><span><strong>좌석 둘러보기</strong><small>나에게 맞는 자리를 찾아요</small></span></button>${icon('chevron', 'step-arrow')}
          <button class="step ${view === 'preferences' ? 'active' : ''} ${allSubmitted() ? 'complete' : ''}" data-action="navigate" data-view="preferences"><span class="step-number">${allSubmitted() ? icon('check') : '02'}</span><span><strong>선호 입력하기</strong><small>${count} / ${workspace.participants.length}명 입력 완료</small></span></button>${icon('chevron', 'step-arrow')}
          <button class="step ${isResult ? 'active' : ''} ${result ? 'complete' : ''}" data-action="navigate" data-view="results"><span class="step-number">${result ? icon('check') : '03'}</span><span><strong>배정 결과 확인</strong><small>함께 앉을 자리를 정해요</small></span></button>
        </div>
        ${isResult && !result ? emptyResults() : `${isResult ? resultStats() : ''}<div class="workspace-grid">${mapCard(isResult)}${isResult ? resultPanel(person) : preferencePanel(person)}</div>${furnitureCards()}`}
        ${participantsCard(isResult && !!result)}
        <footer class="page-footer"><span><span class="footer-brand">자리</span> &nbsp; 좋은 자리에서, 더 좋은 팀으로.</span><button data-action="guide">선호와 가까움을 함께 고려해요 ${icon('arrow')}</button></footer>
      </main>
    </div><input class="sr-only" type="file" id="import-file" accept=".json,.csv,.tsv,.txt,application/json,text/csv,text/tab-separated-values,text/plain" aria-label="선호 JSON CSV TSV 파일 불러오기"/>`;
  const scene = app.querySelector('.floor-scene');
  if (scene) scene.style.transform = `scale(${zoom / 100})`;
}

function mapCard(showResults) {
  const ranking = getDraft();
  const assignments = new Map((showResults ? workspace.result.assignments : []).map(a => [a.seatId, a]));
  const people = new Map(workspace.participants.map(p => [p.id, p]));
  return `<section class="card floor-card" aria-labelledby="floor-title"><div class="card-header"><div class="card-heading"><h2 id="floor-title">${showResults ? '새로운 좌석 배치' : '13층 좌석 안내'}</h2><span class="count-pill">21석</span></div><span class="tiny-label">${icon('chair')} ${showResults ? `${workspace.result.metrics.vacancies}석 비어 있어요` : '플랫폼개발팀 전용'}</span></div>
    <div class="floor-legend">${showResults ? Object.entries(PARTS).map(([id, p]) => `<span class="legend-item"><span class="part-dot ${id}"></span>${p.label} 파트</span>`).join('') + '<span class="legend-item"><span class="part-dot"></span>빈자리</span>' : Object.entries(ZONES).map(([id, z]) => `<span class="legend-item"><span class="zone-tag zone-${id.toLowerCase()}">${id}</span>${z.electric ? '전동' : '고정'} · ${z.partition ? '파티션' : '오픈형'}</span>`).join('')}</div>
    <div class="floor-scroll"><div class="floor-stage" style="height:${469 * zoom / 100}px;min-width:${460 * zoom / 100}px"><div class="floor-scene"><div class="floor-wall"></div><div class="window-line"></div><span class="window-caption">WINDOW SIDE</span><div class="team-sign"><strong>플랫폼개발팀</strong>21석</div>
      ${Object.entries(ZONES).map(([zone, info]) => `<section class="zone-group" data-zone="${zone}" aria-label="${zone}구역 ${info.name}"><div class="zone-heading"><span class="zone-tag zone-${zone.toLowerCase()}">${zone}</span><span>${info.electric ? '전동 데스크' : '고정 데스크'} · ${info.count}석</span></div><div class="seat-grid">${SEATS.filter(s => s.zone === zone).map(s => {
        const index = ranking.indexOf(s.id);
        const entry = assignments.get(s.id);
        const occupant = entry ? people.get(entry.participantId) : null;
        const label = `${zone}구역 ${s.id}번 좌석${zone === 'C' ? `, ${pairedSeat(s.id)}번과 짝 좌석` : ''}, ${info.electric ? '전동' : '고정'} 책상, ${info.partition ? '파티션 있음' : '파티션 없음'}${showResults ? occupant ? `, ${occupant.name}, ${PARTS[occupant.part].label}, ${rankLabel(entry.rank)}` : ', 빈자리' : index >= 0 ? `, ${index + 1}지망, 누르면 좌석 정보` : `, 누르면 ${ranking.length + 1}지망으로 추가`}`;
        return `<button class="seat ${!showResults && index >= 0 ? 'ranked' : ''} ${s.id === selectedSeat && !showResults ? 'selected' : ''} ${occupant ? `part-${occupant.part}` : ''}" data-action="seat" data-seat="${s.id}" ${zone === 'C' ? `data-paired-seat="${pairedSeat(s.id)}"` : ''} aria-label="${esc(label)}" title="${esc(label)}" ${!showResults ? `aria-pressed="${index >= 0}"` : ''}><span class="seat-body">${icon('monitor')}<span>${s.id}</span></span>${zone === 'C' ? `<span class="seat-pair-note">↔ ${pairedSeat(s.id)}</span>` : ''}${showResults ? `<span class="seat-occupant">${occupant ? esc(occupant.name) : '빈자리'}</span>` : index >= 0 ? `<span class="seat-rank">${index + 1}</span>` : ''}</button>`;
      }).join('')}</div></section>`).join('')}
      <div class="aisle aisle-one"></div><div class="aisle aisle-two"></div><div class="corridor"><span>통로</span></div><div class="room room-meeting">${icon('users')}<span>MEETING ROOM</span></div><div class="room room-oa">${icon('printer')}<span>OA ZONE</span></div><div class="room room-idea">${icon('monitor')}<span>IDEA ROOM</span></div><div class="entrance">${icon('door')} 출입구</div>
    </div></div></div><div class="map-footer"><span class="map-note">${icon('info')} ${showResults ? '파트 색상으로 함께 앉는 자리를 확인해요' : '좌석을 누르면 지망 순서대로 선택됩니다'}</span><div class="zoom-controls"><button class="icon-button" data-action="zoom-out" aria-label="좌석 지도 축소" ${zoom <= 80 ? 'disabled' : ''}>${icon('minus')}</button><span>${zoom}%</span><button class="icon-button" data-action="zoom-in" aria-label="좌석 지도 확대" ${zoom >= 140 ? 'disabled' : ''}>${icon('plus')}</button></div></div></section>`;
}

function personSelect(person, label = '참여자를 선택해 주세요') {
  return `<div class="person-field"><label class="field-label" for="person-select">${label}</label><div class="person-select"><select id="person-select" aria-label="선호를 입력할 참여자">${Object.entries(PARTS).map(([part, p]) => `<optgroup label="${p.fullLabel}">${workspace.participants.filter(member => member.part === part).map(member => `<option value="${esc(member.id)}" ${member.id === person.id ? 'selected' : ''}>${esc(member.name)} · ${p.label}</option>`).join('')}</optgroup>`).join('')}</select><span class="part-dot ${person.part}"></span>${icon('down')}</div></div>`;
}
function preferencePanel(person) {
  const ranking = getDraft(person.id);
  const count = ranking.length;
  const companionId = getCompanionDraft(person.id);
  const saved = !!workspace.preferences[person.id] && equal(workspace.preferences[person.id], ranking) && (workspace.companions[person.id] || null) === companionId;
  return `<section class="card preference-card" id="preferences" aria-labelledby="preference-title"><div class="preference-heading"><h2 id="preference-title">내 자리 선호</h2>${icon('list')}</div><p class="preference-subtitle">마음에 드는 자리부터 선택해 주세요.<br>희망 동료 → 파트 거리 → 좌석 지망 순서로 고려해요.</p>${personSelect(person)}<div class="companion-field"><label class="field-label" for="companion-select">C구역 함께 앉고 싶은 동료 <span>(선택)</span></label><select class="input" id="companion-select"><option value="">선호 없음</option>${workspace.participants.filter(member => member.id !== person.id).map(member => `<option value="${esc(member.id)}" ${member.id === companionId ? 'selected' : ''}>${esc(member.name)} · ${PARTS[member.part].label}</option>`).join('')}</select><p>가장 먼저 고려하는 선호입니다. 짝이 선택되면 두 사람 모두 C구역 짝 좌석을 좌석 지망보다 우선해요. 요청이 겹치면 모두 충족되지 않을 수 있습니다.</p></div>
    <div class="progress-heading"><span>${saved ? '선호 입력 완료' : '나의 선택'}</span><strong>${count}<span> / 21개</span></strong></div><div class="progress-track" role="progressbar" aria-label="선호 입력 진행률" aria-valuenow="${count}" aria-valuemin="0" aria-valuemax="21"><div class="progress-fill" style="width:${count / 21 * 100}%"></div></div>
    <div class="rank-help">${icon('info')}${count ? '드래그 또는 화살표로 순서를 바꿀 수 있어요' : '지도에서 1지망 좌석을 골라 주세요'}</div>
    <ol class="rank-list" aria-label="21개 좌석 지망 순서">${ranking.map((id, i) => {
      const seat = seatById.get(id), z = ZONES[seat.zone];
      return `<li class="rank-row" draggable="true" data-rank-index="${i}">${icon('grip', 'drag-handle')}<span class="rank-num">${i + 1}</span><button class="rank-info" data-action="preview-seat" data-seat="${id}" aria-label="${i + 1}지망 ${seat.zone}구역 ${id}번 좌석 정보"><strong>${seat.zone}구역 · ${id}번</strong><small>${z.electric ? '전동' : '고정'} 데스크 · ${z.partition ? '파티션' : '오픈형'}</small></button><span class="rank-actions"><button class="icon-button" data-action="rank-up" data-index="${i}" aria-label="${id}번 좌석 순위 올리기" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button><button class="icon-button" data-action="rank-down" data-index="${i}" aria-label="${id}번 좌석 순위 내리기" ${i === count - 1 ? 'disabled' : ''}>${icon('down')}</button><button class="icon-button" data-action="rank-remove" data-index="${i}" aria-label="${id}번 좌석 선호에서 제거">${icon('close')}</button></span></li>`;
    }).join('')}${count < 21 ? Array.from({ length: Math.max(1, 4 - count) }, (_, i) => `<li class="rank-row empty-rank ${i === 0 ? 'next-rank' : ''}"><span class="rank-num">${count + i + 1}지망</span><span class="rank-info">${i === 0 ? '좌석을 선택해 주세요' : '다음 자리를 골라 주세요'}</span>${icon('plus')}</li>`).join('') : ''}</ol>
    ${count < 21 ? `<button class="fill-button" data-action="autofill">${icon('sparkle')}남은 순위 자동 채우기</button>` : `<button class="fill-button" data-action="clear-draft">${icon('list')}선택 순서 다시 정하기</button>`}
    <div class="preference-save"><button class="btn btn-primary btn-full" data-action="save-preferences" ${count !== 21 || saved || actionPending ? 'disabled' : ''}>${icon(saved ? 'check' : 'save')}${actionPending ? '저장 중…' : saved ? '선호 저장 완료' : '선호 저장하기'}</button><p class="save-note ${saved ? 'saved-note' : ''}">${saved ? '21개 지망과 희망 동료 설정이 저장됐어요. 수정 후 다시 저장할 수 있습니다.' : `모든 좌석을 선택하면 저장할 수 있어요 · ${21 - count}개 남음`}</p>${count === 21 ? `<button class="export-person" data-action="export-person">${icon('download')}내 선호 파일 내려받기</button>` : ''}</div>
  </section>`;
}

function furnitureCards() {
  return `<div class="furniture-heading"><h2>자리마다 다른 매력</h2><button data-action="reference">원본 도면 보기 ${icon('arrow')}</button></div><div class="zone-cards">${Object.entries(ZONES).map(([id, z]) => `<button class="card zone-card" data-action="zone-info" data-zone="${id}" aria-label="${id}구역 ${z.name} 상세 보기"><img src="${z.photo}" alt="${id}구역 실제 책상과 의자" loading="lazy"/><div class="zone-card-content"><div class="zone-card-title"><span class="zone-tag zone-${id.toLowerCase()}">${id}</span>${id} 구역 <small>· ${z.count}석</small></div><h3>${z.name}</h3><p>${z.description}</p>${id === 'C' ? '<span class="zone-pairs">짝 좌석 85–90 · 86–89 · 87–88</span>' : ''}<div class="zone-features"><span class="feature">${icon(z.electric ? 'electric' : 'chair')}${z.electric ? '높이 조절' : '높이 고정'}</span><span class="feature">${icon('monitor')}싱글</span><span class="feature">${icon('partition')}${z.partition ? '파티션' : '오픈형'}</span></div></div></button>`).join('')}</div>`;
}
function filteredPeople() { return workspace.participants.filter(p => (filter === 'all' || p.part === filter) && p.name.includes(search.trim())); }
function participantRows(showResults) {
  const result = new Map((workspace.result?.assignments || []).map(a => [a.participantId, a]));
  return filteredPeople().map(person => {
    const saved = workspace.preferences[person.id];
    const assignment = result.get(person.id);
    return `<tr><td><div class="person-name"><span class="mini-avatar ${person.part}">${esc(person.name.slice(0, 1))}</span>${esc(person.name)}</div></td><td>${partChip(person.part)}</td><td>${showResults ? `<span class="submitted-status">${icon('checkcircle')}${assignment.rank === null ? rankLabel(assignment.rank) : `${assignment.rank}지망 배정`}</span>` : saved ? `<span class="submitted-status">${icon('checkcircle')}입력 완료</span>` : '<span class="status-pending"><span class="pending-dot"></span>입력 대기</span>'}</td><td>${showResults && assignment ? `${seatById.get(assignment.seatId).zone}구역 · ${assignment.seatId}번` : saved ? `${seatById.get(saved[0]).zone}구역 · ${saved[0]}번` : '—'}</td><td><button class="row-edit" data-action="choose-person" data-person="${esc(person.id)}">${showResults ? '결과 보기' : '선호 입력'} ${icon('chevron')}</button></td></tr>`;
  }).join('') || '<tr><td colspan="5" class="table-empty">검색 결과가 없습니다.</td></tr>';
}
function participantsCard(showResults) {
  return `<section class="card participants-card" aria-labelledby="participants-title"><div class="card-header participants-header"><div><div class="card-heading"><h2 id="participants-title">${showResults ? '모두의 배정 결과' : '함께하는 사람들'}</h2><span class="count-pill">${workspace.participants.length}명</span></div><p class="card-kicker">${showResults ? workspace.result.mode === 'random' ? '완전 랜덤으로 추첨한 전원의 좌석을 확인해요.' : '파트별 배정과 개인별 지망 순위를 확인해요.' : `모든 참여자가 선호를 입력하면 배정을 시작할 수 있어요. 빈자리 ${SEATS.length - workspace.participants.length}석`}</p></div><div class="participants-tools"><button class="btn" data-action="import">${icon('upload')}표·파일 가져오기</button><button class="btn" data-action="sheet-template">${icon('list')}입력 양식</button><button class="btn" data-action="${showResults ? 'download-csv' : 'export-workspace'}">${icon('download')}${showResults ? 'CSV 내보내기' : '내보내기'}</button></div></div><div class="participants-toolbar"><div class="filters">${[['all', '전체'], ...Object.entries(PARTS).map(([id, p]) => [id, p.label])].map(([id, label]) => `<button class="filter ${filter === id ? 'active' : ''}" data-action="filter" data-part="${id}">${id !== 'all' ? `<span class="part-dot ${id}"></span>` : ''}${label}<span>${id === 'all' ? workspace.participants.length : workspace.participants.filter(p => p.part === id).length}</span></button>`).join('')}</div><label class="search-field">${icon('search')}<input id="person-search" type="search" value="${esc(search)}" placeholder="이름 검색" aria-label="참여자 이름 검색"/></label></div><div class="table-scroll"><table><thead><tr><th scope="col">참여자</th><th scope="col">소속 파트</th><th scope="col">${showResults ? '배정 지망' : '입력 상태'}</th><th scope="col">${showResults ? '배정 좌석' : '1지망 좌석'}</th><th scope="col">${showResults ? '결과' : '선호 관리'}</th></tr></thead><tbody id="participant-rows">${participantRows(showResults)}</tbody></table></div><div class="table-footer"><span>이미지 기준 명단 · 초록색 인원 제외</span><span>${showResults ? `<strong>${workspace.result.metrics.matchedCount}명 배정 완료</strong>` : `<strong>${submittedCount()}명</strong> / ${workspace.participants.length}명 입력 완료`}</span></div></section>`;
}
function resultStats() {
  const m = workspace.result.metrics;
  if (workspace.result.mode === 'random') return `<div class="result-stats"><div class="card stat-card"><div><span class="stat-label">랜덤 배정 완료</span><strong class="stat-value">${m.matchedCount}<small>명</small></strong><p>전원의 좌석을 중복 없이 추첨</p></div>${icon('sparkle')}</div><div class="card stat-card"><div><span class="stat-label">빈자리</span><strong class="stat-value">${m.vacancies}<small>석</small></strong><p>배정 지망은 해당 없음</p></div>${icon('chair')}</div><div class="card stat-card"><div><span class="stat-label">같은 파트 평균 거리</span><strong class="stat-value">${m.averageDistance.toFixed(2)}<small>상대 단위</small></strong><p>추첨 결과의 거리 · 도면 좌표 기준</p></div>${icon('users')}</div></div>`;
  return `<div class="result-stats companion-stats"><div class="card stat-card"><div><span class="stat-label">희망 동료 요청 충족</span><strong class="stat-value">${m.companionSatisfied ?? 0}<small>/ ${m.companionRequested ?? 0}건</small></strong><p>C구역 짝 좌석에 함께 배정된 요청</p></div>${icon('users')}</div><div class="card stat-card"><div><span class="stat-label">평균 배정 지망</span><strong class="stat-value">${m.averageRank.toFixed(1)}<small>지망</small></strong><p>개인별 실제 선호 순위 기준</p></div>${icon('target')}</div><div class="card stat-card"><div><span class="stat-label">3지망 이내 배정</span><strong class="stat-value">${m.top3Count}<small>/ ${m.matchedCount}명</small></strong><p>좋아하는 자리에 조금 더 가까이</p></div>${icon('checkcircle')}</div><div class="card stat-card"><div><span class="stat-label">같은 파트 평균 거리</span><strong class="stat-value">${m.averageDistance.toFixed(2)}<small>상대 단위</small></strong><p>도면 좌표 기준 · 실제 미터 아님</p></div>${icon('users')}</div></div>`;
}
function resultPanel(person) {
  const result = workspace.result;
  const assignment = result.assignments.find(a => a.participantId === person.id);
  const seat = seatById.get(assignment.seatId);
  const zone = ZONES[seat.zone];
  const requested = workspace.participants.find(member => member.id === workspace.companions[person.id]);
  const actual = workspace.participants.find(member => member.id === getAssignedCompanion(person.id, SEATS, result.assignments));
  return `<section class="card result-panel" aria-labelledby="my-result-title"><h2 id="my-result-title">나의 새로운 자리</h2><p class="result-panel-sub">새로운 자리에서 만나요.</p>${personSelect(person, '배정 결과를 확인할 참여자')}<div class="result-person"><span class="mini-avatar ${person.part}">${esc(person.name.slice(0, 1))}</span><div><strong>${esc(person.name)} 님</strong>${partChip(person.part)}</div></div><div class="result-seat-large"><strong>${assignment.seatId}</strong><p>${seat.zone}구역 · 13층</p><span class="part-chip">${icon('check')} ${assignment.rank === null ? rankLabel(assignment.rank) : `나의 ${assignment.rank}지망`}</span></div><div class="result-detail"><div><span>책상 유형</span><strong>${zone.electric ? '전동 데스크' : '고정 데스크'}</strong></div><div><span>모니터</span><strong>싱글</strong></div><div><span>좌/우 파티션</span><strong>${zone.partition ? '있음' : '없음'}</strong></div><div><span>희망 동료</span><strong>${requested ? esc(requested.name) : '선호 없음'}</strong></div><div><span>C구역 실제 짝 동료</span><strong>${actual ? esc(actual.name) : '없음'}</strong></div><div><span>동료 요청 결과</span><strong class="companion-status">${companionStatus(person.id)}</strong></div></div><button class="btn btn-soft btn-full" data-action="zone-info" data-zone="${seat.zone}">${icon('chair')}내 자리 자세히 보기</button><div class="result-method">추첨 시드 <strong>${esc(result.seed)}</strong><br>${result.mode === 'distance' ? `안정 매칭 후보 ${result.metrics.candidateCount.toLocaleString()}개를 비교했어요.` : result.mode === 'random' ? '선호·파트와 무관하게 좌석을 섞은 완전 랜덤 추첨이에요.' : '희망 동료 짝 좌석을 먼저, 나머지는 제출 지망 순서로 제안하는 안정 매칭이에요.'}<br><button data-action="guide">배정 기준 살펴보기 ${icon('arrow')}</button></div></section>`;
}
function emptyResults() {
  return `<section class="card empty-results">${icon('chair')}<h2>아직 새로운 자리를 정하지 않았어요</h2><p>${submittedCount()} / ${workspace.participants.length}명이 21개 선호를 입력했습니다.<br>모든 참여자가 입력하면 배정을 시작할 수 있어요.</p><button class="btn btn-primary" data-action="${allSubmitted() ? 'draw-settings' : 'navigate'}" ${allSubmitted() ? '' : 'data-view="preferences"'}>${allSubmitted() ? '배정 시작하기' : '내 선호 입력하기'}${icon('arrow')}</button><button class="btn btn-quiet" data-action="enter-demo">예시로 미리 체험하기</button></section>`;
}

function openDialog({ title, subtitle = '', body, footer = '', wide = false }) {
  if (!dialog.open) dialogReturnFocus = document.activeElement;
  dialog.className = wide ? 'wide-dialog' : '';
  dialog.innerHTML = `<div class="dialog-header"><div><h2 id="dialog-title">${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div><button class="icon-button" data-action="close-dialog" aria-label="대화상자 닫기">${icon('close')}</button></div><div class="dialog-body">${body}</div>${footer ? `<div class="dialog-footer">${footer}</div>` : ''}`;
  if (!dialog.open) dialog.showModal();
}
function closeDialog() { if (!busy) dialog.close(); }
function guideDialog() {
  openDialog({ title: '좋은 자리를 정하는 방법', subtitle: '선호 기반 배정과 완전 랜덤 추첨을 선택할 수 있어요.', body: `
    <div class="guide-item"><span>01</span><div><h3>21개 좌석을 원하는 순서대로</h3><p>이름을 선택한 뒤 지도에서 좌석을 눌러 1지망부터 21지망까지 정해요. A는 전동·파티션, B는 전동·오픈형, C는 고정·파티션 좌석입니다. 화살표로 순서를 바꾸고, 모두 선택하면 선호를 저장할 수 있어요.</p></div></div>
    <div class="guide-item"><span>02</span><div><h3>같은 파트는 더 가까이</h3><p>노랑은 배차, 파랑은 데이터, 빨강은 맵입니다. 파트마다 기준 좌석을 바꾸면서 좌석 측 우선순위를 만들고, 희망 동료 짝으로 선택된 두 사람은 지정 C좌석을 먼저 제안하고, 나머지는 제출한 지망 순서를 따릅니다. 같은 조건에서는 추첨 시드가 우선순위를 정해요.</p></div></div>
    <div class="guide-item"><span>03</span><div><h3>안정 매칭 후보를 비교해요</h3><p>게일–섀플리 알고리즘으로 각 후보를 배정한 뒤, C구역 희망 동료 요청을 최대한 충족하는 짝을 먼저 선택해요. 그다음 같은 파트의 두 사람 사이 거리 합이 가장 작은 후보, 그다음 제출한 좌석 지망이 더 좋은 후보를 선택합니다. C구역 짝은 85–90, 86–89, 87–88입니다. 서로 다른 파트의 동료도 선택할 수 있고, 서로 선택하면 두 요청을 충족합니다. 요청 충돌이나 세 짝의 한계로 모든 요청을 충족하지 못할 수 있어요.</p></div></div>
    <div class="guide-item"><span>04</span><div><h3>같은 입력, 같은 시드, 같은 결과</h3><p>선호와 참여자, 추첨 시드가 같으면 결과도 같습니다. 결과에서 개인별 배정 지망과 파트별 거리를 확인하고 CSV 또는 재현용 JSON으로 내려받을 수 있어요. 선호 기반 배정은 제출된 21지망을 사용하고, 완전 랜덤 추첨은 좌석을 섞어 배정합니다.</p></div></div>
    <div class="guide-item"><span>05</span><div><h3>전원을 올 랜덤으로 배정하기</h3><p>올 랜덤에서 전원의 21지망을 생성해 파트 거리 기준으로 배정하거나, 선호·파트와 무관하게 좌석만 섞는 완전 랜덤 추첨을 선택합니다. 완전 랜덤의 배정 지망은 해당 없음으로 표시하고, 파트 거리는 추첨 결과를 측정한 값입니다.</p></div></div>
    <div class="dialog-note">거리 단위는 이미지의 상대 좌표입니다. 실제 미터 단위가 필요하면 실측 좌표를 반영해야 합니다. 게일–섀플리만으로 전체 거리의 전역 최솟값을 보장할 수는 없으며, 비교한 후보 중 최소 거리를 선택합니다. 동료 짝이 선택되면 두 사람의 지정 C좌석을 21지망보다 우선합니다. 안정성은 이 순서와 선택된 좌석 측 우선순위를 고정한 기준으로 검증합니다. 표시되는 배정 지망은 원래 제출한 21지망 순위입니다.</div>
    <div class="dialog-note">${backend ? '이 로컬 서버에 연결한 브라우저의 제출 내용은 함께 저장됩니다. 서버를 다시 실행해도 제출 내용이 남아요.' : '현재는 브라우저 저장 모드입니다. 다른 기기의 선호는 개인별 JSON 파일로 내보낸 뒤, 파일 불러오기로 취합해 주세요.'} 예시 체험은 실제 제출 내용을 바꾸지 않습니다.</div>`, footer: '<button class="btn btn-primary" data-action="close-dialog">확인했어요</button>' });
}
function zoneDialog(zoneId, seatId) {
  const z = ZONES[zoneId];
  const ranking = getDraft();
  const entry = view === 'results' && workspace.result ? workspace.result.assignments.find(a => a.seatId === seatId) : null;
  const occupant = entry ? workspace.participants.find(p => p.id === entry.participantId) : null;
  openDialog({ title: `${zoneId}구역${seatId ? ` · ${seatId}번 좌석` : ''}`, subtitle: z.name, body: `<img class="zone-dialog-photo" src="${zoneId === 'C' ? 'assets/zone-c-overview.jpg' : z.photo}" alt="${zoneId}구역의 실제 좌석 사진"/><p>${z.description}${zoneId === 'C' ? ' 두 명씩 짝 좌석을 공유합니다: 85–90 · 86–89 · 87–88.' : ''}${occupant ? ` ${esc(occupant.name)} 님이 ${entry.rank === null ? '완전 랜덤 추첨으로' : `${entry.rank}지망으로`} 배정됐습니다.` : ''}</p><div class="zone-dialog-features"><span class="feature">${icon('electric')}${z.electric ? '전동 높이 조절' : '고정 높이'}</span><span class="feature">${icon('monitor')}싱글 모니터</span><span class="feature">${icon('partition')}좌/우 파티션 ${z.partition ? '있음' : '없음'}</span></div><div class="zone-seat-list">${SEATS.filter(s => s.zone === zoneId).map(s => `<button class="btn ${ranking.includes(s.id) && view !== 'results' ? 'btn-soft' : ''}" data-action="dialog-seat" data-seat="${s.id}">${s.id}번${view !== 'results' && ranking.includes(s.id) ? ` · ${ranking.indexOf(s.id) + 1}지망` : ''}</button>`).join('')}</div>`, footer: `${view !== 'results' ? `<button class="btn btn-soft" data-action="add-zone" data-zone="${zoneId}">남은 ${zoneId}구역 좌석을 선호에 추가</button>` : ''}<button class="btn btn-primary" data-action="close-dialog">확인</button>` });
}
function drawSettings() {
  if (!allSubmitted()) { toast(`아직 ${workspace.participants.length - submittedCount()}명의 선호가 필요합니다.`); return; }
  openDialog({ title: '우리의 자리를 정해볼까요?', subtitle: '저장된 선호로 배정합니다. 같은 시드로 결과를 재현할 수 있어요.', body: `<div class="draw-summary"><span>참여자 <strong>${workspace.participants.length}명</strong></span><span>선호 입력 <strong>${submittedCount()}명 완료</strong></span><span>빈자리 <strong>${21 - workspace.participants.length}석</strong></span></div><div class="setting-field"><label class="field-label" for="draw-seed">추첨 시드</label><input class="input" id="draw-seed" value="${esc(workspace.result?.seed || 'jari-2026-13F')}" maxlength="64"/><small>동률일 때의 우선순위를 정합니다. 시드를 기록해 두면 동일한 배정을 재현할 수 있어요.</small></div><div class="setting-field"><span class="field-label">배정 기준</span><div class="setting-options"><label class="setting-option"><input type="radio" name="draw-mode" value="distance" checked/><div><strong>파트가 가까워지는 배정</strong><p>희망 동료 요청 충족을 최우선으로, 다음은 파트 거리, 다음은 개인의 21지망을 고려해요. 선택된 동료 짝의 두 사람은 C구역 좌석을 우선합니다.</p></div></label><label class="setting-option"><input type="radio" name="draw-mode" value="preference"/><div><strong>개인 선호 기준 배정</strong><p>희망 동료 요청을 먼저 충족하고, 다음은 개인의 21지망을 고려해요. 파트 거리 우선순위 없이 안정 매칭합니다.</p></div></label></div></div><p class="form-error" id="draw-error" role="alert"></p>`, footer: '<button class="btn" data-action="close-dialog">돌아가기</button><button class="btn btn-primary" data-action="run-draw">배정 시작하기</button>' });
}
function randomSettings() {
  openDialog({ title: '올 랜덤으로 자리 정하기', subtitle: `${workspace.participants.length}명 전원을 한 번에 배정합니다.`, body: `<div class="setting-field"><label class="field-label" for="random-seed">추첨 시드 (선택)</label><input class="input" id="random-seed" maxlength="64" placeholder="비워 두면 매번 새로 추첨합니다"/><small>같은 명단과 같은 시드를 사용하면 결과를 재현할 수 있어요.</small></div><div class="setting-options"><label class="setting-option"><input type="radio" name="random-kind" value="distance" checked/><div><strong>랜덤 선호 + 파트 거리 배정</strong><p>전원의 21지망을 랜덤으로 생성하고, 게일–섀플리 후보 중 같은 파트의 거리 합이 가장 작은 결과를 선택합니다. 기존 제출 지망은 랜덤 지망으로 갱신되고, 희망 동료 설정은 유지해 먼저 고려합니다.</p></div></label><label class="setting-option"><input type="radio" name="random-kind" value="random"/><div><strong>완전 랜덤 좌석 추첨</strong><p>좌석 지망·희망 동료·파트를 고려하지 않고 좌석을 섞어 한 명씩 추첨합니다. 선호 입력 없이도 배정할 수 있어요.</p></div></label></div><p class="form-error" id="random-error" role="alert"></p>`, footer: '<button class="btn" data-action="close-dialog">돌아가기</button><button class="btn btn-primary" data-action="run-random">전원 랜덤 배정</button>' });
}
async function runAllRandom() {
  const seed = document.querySelector('#random-seed').value.trim() || crypto.randomUUID();
  const mode = document.querySelector('input[name="random-kind"]:checked').value;
  if (mode === 'random') return runDraw({ seed, mode });
  pendingImport = { preferences: createRandomPreferences(workspace.participants, SEATS, seed) };
  await applyImport({ drawOptions: { seed, mode: 'distance' }, errorId: 'random-error' });
}
async function runDraw(options = null) {
  const seed = options?.seed || document.querySelector('#draw-seed')?.value.trim();
  if (!seed) { document.querySelector('#draw-error').textContent = '추첨 시드를 입력해 주세요.'; return; }
  const mode = options?.mode || document.querySelector('input[name="draw-mode"]:checked').value;
  const snapshot = structuredClone(workspace);
  const fingerprint = stateFingerprint(snapshot);
  if (mode !== 'random') {
    const validation = validatePreferences(snapshot.participants, SEATS, snapshot.preferences);
    if (!validation.valid) { toast(validation.errors[0], true); return; }
  }
  busy = true;
  openDialog({ title: '새로운 자리를 정하고 있어요', body: `<div class="draw-progress"><span class="spinner" aria-hidden="true"></span><h3>${mode === 'random' ? '전원의 좌석을 랜덤으로 추첨합니다' : '선호를 담고, 팀을 더 가까이'}</h3><p id="draw-progress-text" role="status" aria-live="polite">${mode === 'random' ? '좌석을 섞어 한 명씩 배정하고 있어요.' : '안정적인 배정 후보를 비교하고 있어요.'}</p><div class="progress-track"><div class="progress-fill" id="draw-progress-fill" style="width:0%"></div></div></div>` });
  let worker;
  try {
    const result = await new Promise((resolve, reject) => {
      worker = new Worker(new URL('./allocation-worker.mjs', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        if (data.type === 'progress') {
          const { completed, total } = data.progress;
          document.querySelector('#draw-progress-text').textContent = `${completed.toLocaleString()} / ${total.toLocaleString()}개 후보 비교`;
          document.querySelector('#draw-progress-fill').style.width = `${completed / total * 100}%`;
        } else if (data.type === 'result') resolve(data.result);
        else if (data.type === 'error') reject(new Error(data.error));
      };
      worker.onerror = () => reject(new Error('배정 엔진을 실행하지 못했습니다. 서버에서 페이지를 열었는지 확인해 주세요.'));
      worker.postMessage({ participants: snapshot.participants, seats: SEATS, preferences: snapshot.preferences, companions: snapshot.companions, seed, mode });
    });
    if (mode !== 'random' && findBlockingPairs(snapshot.participants, SEATS, buildMatchingPreferences(snapshot.participants, SEATS, snapshot.preferences, snapshot.companions, result.companionPlan || []), result.seatPriorities, result.assignments).length) throw new Error('안정 매칭 검증에 실패했습니다. 다시 배정해 주세요.');
    if (backend && !demo) setWorkspace(await api('/api/result', { method: 'PUT', body: JSON.stringify({ result, fingerprint }) }));
    else {
      if (stateFingerprint(workspace) !== fingerprint) throw new Error('입력 내역이 바뀌었습니다. 최신 선호로 다시 배정해 주세요.');
      setWorkspace({ ...workspace, result, updatedAt: new Date().toISOString() });
    }
    view = 'results';
    busy = false;
    dialog.close();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast(`${result.metrics.matchedCount}명의 새로운 자리가 정해졌어요.`);
  } catch (error) {
    busy = false;
    dialog.close();
    toast(error.message, true);
    await syncWorkspace(true);
  } finally { worker?.terminate(); busy = false; }
}

function manageDialog() {
  rosterDraft = structuredClone(workspace.participants);
  openDialog({ title: '함께하는 사람들', subtitle: '이름과 파트를 수정하고, 최대 21명까지 참여할 수 있어요.', body: `<div class="roster-edit-list" id="roster-list">${rosterRows()}</div><button class="roster-add" data-action="add-person">${icon('plus')}참여자 추가 <span id="roster-count">(${rosterDraft.length}/21)</span></button><p class="form-error" id="roster-error" role="alert"></p><div class="dialog-note">초록색 인원을 제외한 이미지 기준 명단입니다. 명단을 바꾸면 기존 배정 결과가 해제되며, 남아 있는 참여자의 제출된 선호는 유지됩니다.</div>`, footer: '<button class="btn" data-action="close-dialog">취소</button><button class="btn btn-primary" data-action="save-roster">변경사항 저장</button>' });
}
function rosterRows() {
  return rosterDraft.map((p, i) => `<div class="roster-edit-row" data-roster-index="${i}"><input class="input" data-field="name" value="${esc(p.name)}" aria-label="참여자 ${i + 1} 이름" maxlength="50"/><select class="input" data-field="part" aria-label="참여자 ${i + 1} 소속 파트">${Object.entries(PARTS).map(([id, part]) => `<option value="${id}" ${p.part === id ? 'selected' : ''}>${part.label}</option>`).join('')}</select><button class="icon-button" data-action="remove-person" data-index="${i}" aria-label="${esc(p.name || '새 참여자')} 명단에서 제거">${icon('close')}</button></div>`).join('');
}
function validateRoster(participants) {
  if (!Array.isArray(participants) || participants.length < 1 || participants.length > 21) throw new Error('참여자는 1명부터 21명까지 등록할 수 있습니다.');
  const ids = new Set(), names = new Set();
  for (const person of participants) {
    if (!person || typeof person.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(person.id) || ['__proto__', 'constructor', 'prototype'].includes(person.id) || ids.has(person.id)) throw new Error('참여자 ID가 올바르지 않거나 중복됩니다.');
    if (typeof person.name !== 'string' || !person.name.trim() || person.name.length > 50 || names.has(person.name.trim())) throw new Error('이름을 50자 이내로 입력하고, 중복된 이름을 확인해 주세요.');
    if (!Object.hasOwn(PARTS, person.part)) throw new Error('소속 파트를 선택해 주세요.');
    ids.add(person.id); names.add(person.name.trim());
  }
}
function validateSubset(participants, preferences) {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) throw new Error('선호 파일의 형식이 올바르지 않습니다.');
  const ids = Object.keys(preferences);
  if (!ids.length) return;
  const selected = participants.filter(p => ids.includes(p.id));
  const validation = validatePreferences(selected, SEATS, preferences);
  if (!validation.valid) throw new Error(validation.errors[0]);
}
async function saveRoster() {
  if (actionPending) return;
  try {
    const participants = rosterDraft.map(p => ({ id: p.id, name: p.name.trim(), part: p.part }));
    validateRoster(participants);
    actionPending = true;
    if (backend && !demo) setWorkspace(await api('/api/participants', { method: 'PUT', body: JSON.stringify({ participants }) }));
    else setWorkspace({ ...workspace, participants, companions: pruneCompanions(workspace.companions, participants), preferences: Object.fromEntries(Object.entries(workspace.preferences).filter(([id]) => participants.some(p => p.id === id))), result: null, updatedAt: new Date().toISOString() });
    for (const id of Object.keys(drafts)) if (!participants.some(p => p.id === id)) delete drafts[id];
    if (!demo) writeStorage(storageKeys.drafts, drafts);
    closeDialog();
    render();
    toast(`${participants.length}명의 명단을 저장했어요.`);
  } catch (error) { document.querySelector('#roster-error').textContent = error.message; }
  finally { actionPending = false; }
}
async function savePreferences() {
  if (actionPending) return;
  const person = currentPerson();
  const ranking = getDraft(person.id);
  const companionId = getCompanionDraft(person.id);
  const validation = validatePreferences([person], SEATS, { [person.id]: ranking });
  if (!validation.valid) { toast(validation.errors[0], true); return; }
  actionPending = true;
  render();
  try {
    if (backend && !demo) setWorkspace(await api(`/api/preferences/${encodeURIComponent(person.id)}`, { method: 'PUT', body: JSON.stringify({ ranking, companionId }) }));
    else setWorkspace({ ...workspace, preferences: { ...workspace.preferences, [person.id]: ranking }, companions: normalizeCompanions(workspace.participants, { ...workspace.companions, [person.id]: companionId }), result: null, updatedAt: new Date().toISOString() });
    if (equal(getDraft(person.id), ranking)) delete drafts[person.id];
    if (getCompanionDraft(person.id) === companionId) delete companionDrafts[person.id];
    if (!demo) writeStorage(storageKeys.companions, companionDrafts);
    if (!demo) writeStorage(storageKeys.drafts, drafts);
    toast(`${person.name} 님의 21개 선호를 저장했어요.`);
  } catch (error) { toast(error.message, true); }
  finally { actionPending = false; render(); }
}
function downloadFile(filename, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportWorkspace() {
  downloadFile(`자리-워크스페이스${demo ? '-예시' : ''}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: 'jari-workspace-v1', ...workspace, seats: SEATS, exportedAt: new Date().toISOString() }, null, 2));
  toast('참여자와 제출된 선호, 배정 결과를 파일로 내려받았어요.');
}
function exportPerson() {
  const person = currentPerson();
  const ranking = getDraft(person.id);
  if (ranking.length !== 21) { toast('21개 좌석을 모두 선택해 주세요.', true); return; }
  downloadFile(`자리-선호-${person.name}${demo ? '-예시' : ''}.json`, JSON.stringify({ format: 'jari-preferences-v1', participant: person, preferences: { [person.id]: ranking }, companions: { [person.id]: getCompanionDraft(person.id) }, exportedAt: new Date().toISOString() }, null, 2));
  toast('개인 선호 파일을 내려받았어요. 파일 불러오기로 취합할 수 있습니다.');
}
function downloadCsv() {
  if (!workspace.result) return;
  const csvCell = value => {
    let str = String(value);
    if (/^[=+@\-\t\r]/.test(str)) str = `'${str}`;
    return `"${str.replaceAll('"', '""')}"`;
  };
  const rows = [['이름', '파트', '구역', '좌석 번호', '배정 지망', '추첨 시드', '배정 기준', '희망 동료', 'C구역 실제 짝 동료', '동료 요청 결과']];
  for (const person of workspace.participants) {
    const assignment = workspace.result.assignments.find(a => a.participantId === person.id);
    rows.push([person.name, PARTS[person.part].label, seatById.get(assignment.seatId).zone, assignment.seatId, assignment.rank === null ? '해당 없음' : assignment.rank, workspace.result.seed, workspace.result.mode === 'distance' ? '파트 거리 고려' : workspace.result.mode === 'random' ? '완전 랜덤 추첨' : '개인 선호 기준', workspace.participants.find(member => member.id === workspace.companions[person.id])?.name || '', workspace.participants.find(member => member.id === getAssignedCompanion(person.id, SEATS, workspace.result.assignments))?.name || '', companionStatus(person.id)]);
  }
  for (const seat of SEATS.filter(s => !workspace.result.assignments.some(a => a.seatId === s.id))) rows.push(['빈자리', '', seat.zone, seat.id, '', workspace.result.seed, '', '', '', '']);
  downloadFile(`자리-배정결과${demo ? '-예시' : ''}.csv`, '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  toast('Excel에서 열 수 있는 배정 결과를 내려받았어요.');
}
function downloadSheetTemplate() {
  downloadFile('자리-선호-입력양식.csv', createSheetTemplate(workspace.participants, { includeBom: true }), 'text/csv;charset=utf-8');
  toast('Google Sheets에서 파일 가져오기로 열고 1~21지망을 작성해 주세요.');
}
function sheetInputDialog(text = '', filename = '') {
  sheetText = text;
  sheetPreview = null;
  pendingImport = null;
  openDialog({ title: 'Google Sheets 표 가져오기', subtitle: filename ? esc(filename) : '머리글을 포함한 표를 복사해 붙여넣거나 CSV·TSV 파일을 선택하세요.', wide: true, body: `<section class="public-sheet-input" aria-label="공개 Google Sheets 링크 입력"><h3>공개 시트 링크로 바로 배정</h3><label class="field-label" for="public-sheet-url">Google Sheets 공개 링크</label><input class="input" id="public-sheet-url" value="${esc(PREFERENCE_SHEET_URL)}" type="url" maxlength="4096" placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0"/><p class="sheet-help">공유 → 일반 액세스를 “링크가 있는 모든 사용자: 뷰어”로 설정하거나 “웹에 게시”한 링크를 넣으세요. 선택한 탭의 이름·파트·1~21지망·희망 동료를 읽습니다. 링크 읽기에는 Node 서버 실행이 필요합니다.</p><div class="sheet-draw-options"><div><label class="field-label" for="sheet-seed">추첨 시드 (선택)</label><input class="input" id="sheet-seed" maxlength="64" placeholder="비워 두면 새 시드 생성"/></div><div><label class="field-label" for="sheet-mode">배정 기준</label><select class="input" id="sheet-mode"><option value="distance">파트가 가까워지는 배정</option><option value="preference">개인 선호 기준 배정</option></select></div></div><p class="sheet-help">파트 거리 배정은 희망 동료 요청 충족 → 파트 거리 → 개인 21지망 순서입니다. 동료 짝이 선택되면 두 사람의 C구역 좌석을 개인 좌석 지망보다 우선해요. 개인 선호 배정은 파트 거리 비교를 제외합니다.</p><div class="sheet-tools"><button class="btn" data-action="fetch-public-sheet">시트 미리보기</button><button class="btn btn-primary" data-action="draw-public-sheet">${icon('sparkle')}시트 불러와 배정</button></div><p class="sheet-help" id="sheet-status" role="status" aria-live="polite"></p></section><div class="sheet-tools"><button class="btn" data-action="sheet-template">${icon('download')}빈 양식 다운로드</button><button class="btn" data-action="pick-import-file">${icon('upload')}CSV · TSV · JSON 파일 선택</button><button class="btn btn-quiet" data-action="fill-random-sheet">${icon('sparkle')}랜덤 예시 채우기</button><button class="btn btn-quiet" data-action="copy-sheet-example">예시 표 복사</button><a class="btn" href="${esc(TEMPLATE_COPY_URL)}" target="_blank" rel="noopener noreferrer">Google Sheets 새로 만들기</a>${submittedCount() ? '<button class="btn btn-quiet" data-action="export-sheet">제출 선호 CSV</button>' : ''}</div><label class="field-label" for="sheet-input">이름 / 파트 / 1지망 … 21지망 / 함께 앉고 싶은 동료 (선택)</label><textarea class="sheet-textarea" id="sheet-input" rows="7" spellcheck="false" placeholder="Google Sheets에서 머리글과 작성한 행을 함께 복사해 붙여넣어 주세요.">${esc(sheetText)}</textarea><p class="sheet-help">이름은 참여자 명단과 동일하게, 파트는 데이터·배차·맵, 좌석은 번호만 입력해 주세요. 예: 68, 207, 85. 새 Google Sheets는 명단과 24개 머리글이 있는 원본 시트의 현재 내용을 복사합니다. 새 설문에서는 지망·희망 동료 칸을 비워 사용하세요. 현재 명단으로 양식이 필요하면 빈 양식을 내려받으세요. 희망 동료 열은 선택이며, 기존 23열도 가져올 수 있어요.</p><button class="btn btn-soft" data-action="preview-sheet">${icon('checkcircle')}표 확인하기</button><div id="sheet-preview" aria-live="polite"></div><p class="form-error" id="import-error" role="alert"></p>`, footer: '<button class="btn" data-action="close-dialog">취소</button><button class="btn btn-primary" data-action="apply-sheet" disabled>검증한 선호 가져오기</button>' });
}
function previewSheet() {
  sheetText = document.querySelector('#sheet-input').value;
  sheetPreview = parsePreferenceSheet(sheetText, { participants: workspace.participants, seats: SEATS });
  const invalidRows = new Set(sheetPreview.errors.map(error => error.row));
  const summary = sheetPreview.valid ? `<p class="sheet-success">${icon('checkcircle')} ${sheetPreview.rows.length}명 · 모든 21개 지망을 확인했습니다.</p>` : `<div class="sheet-errors"><strong>표에서 ${sheetPreview.errors.length}개 오류를 확인했습니다.</strong><ul>${sheetPreview.errors.slice(0, 8).map(error => `<li>${error.row}행 ${error.column}열: ${esc(error.message)}</li>`).join('')}</ul>${sheetPreview.errors.length > 8 ? `<p>나머지 ${sheetPreview.errors.length - 8}개 오류도 표를 수정한 후 다시 확인해 주세요.</p>` : ''}</div>`;
  const table = sheetPreview.rows.length ? `<div class="sheet-table-scroll"><table class="sheet-preview-table"><thead><tr><th scope="col">행</th>${SHEET_HEADERS.map(header => `<th scope="col">${header}</th>`).join('')}</tr></thead><tbody>${sheetPreview.rows.map(row => `<tr class="${invalidRows.has(row.row) ? 'sheet-invalid-row' : ''}"><td>${row.row}</td><td>${esc(row.name)}</td><td>${esc(row.part ? PARTS[row.part].label : row.inputPart)}</td>${row.ranking.map(id => `<td>${esc(id)}</td>`).join('')}<td>${esc(row.companionName || '선호 없음')}</td></tr>`).join('')}</tbody></table></div>` : '';
  document.querySelector('#sheet-preview').innerHTML = summary + table + (sheetPreview.valid ? '<p class="sheet-help">가져오면 해당 참여자의 제출 선호가 갱신되고 기존 배정 결과는 해제됩니다.</p>' : '');
  document.querySelector('[data-action="apply-sheet"]').disabled = !sheetPreview.valid;
}

async function loadPublicSheet({ draw = false } = {}) {
  sheetPreview = null;
  pendingImport = null;
  document.querySelector('[data-action="apply-sheet"]').disabled = true;
  document.querySelector('#sheet-preview').innerHTML = '';
  sheetText = '';
  document.querySelector('#sheet-input').value = '';
  if (!backend) { document.querySelector('#import-error').textContent = '공개 링크를 읽으려면 npm start로 Node 서버를 실행하고 접속해 주세요. 표 붙여넣기와 파일 가져오기도 사용할 수 있습니다.'; return; }
  const url = document.querySelector('#public-sheet-url').value.trim();
  const seed = document.querySelector('#sheet-seed').value.trim() || crypto.randomUUID();
  const mode = document.querySelector('#sheet-mode').value;
  const fingerprint = stateFingerprint(workspace);
  const controls = [...dialog.querySelectorAll('#public-sheet-url, #sheet-seed, #sheet-mode, #sheet-input, [data-action="fetch-public-sheet"], [data-action="draw-public-sheet"]')];
  document.querySelector('#import-error').textContent = '';
  document.querySelector('#sheet-status').textContent = '공개 시트를 읽고 있어요…';
  actionPending = true;
  controls.forEach(control => { control.disabled = true; });
  let readyToDraw = false;
  try {
    const sheet = await api('/api/sheets', { method: 'POST', body: JSON.stringify({ url }), timeoutMs: 20000 });
    sheetText = sheet.text;
    document.querySelector('#sheet-input').value = sheetText;
    previewSheet();
    if (!sheetPreview.valid) throw new Error('시트에 잘못된 입력이 있습니다. 아래 오류와 표를 확인해 주세요.');
    document.querySelector('#sheet-status').textContent = `${sheetPreview.rows.length}명의 선호를 읽었습니다. 아래 표에서 내용을 확인할 수 있어요.`;
    if (draw) {
      const validation = validatePreferences(workspace.participants, SEATS, { ...workspace.preferences, ...sheetPreview.preferences });
      if (!validation.valid) throw new Error(`배정에 필요한 선호가 부족합니다. ${validation.errors[0]} 시트에 나머지 사람의 21지망을 작성해 주세요.`);
      pendingImport = { preferences: sheetPreview.preferences, companions: sheetPreview.companions };
      readyToDraw = true;
    }
  } catch (error) {
    document.querySelector('#import-error').textContent = error.message;
    document.querySelector('#sheet-status').textContent = '공개 시트 불러오기를 완료하지 못했습니다.';
  } finally {
    actionPending = false;
    controls.forEach(control => { control.disabled = false; });
  }
  if (readyToDraw) await applyImport({ drawOptions: { seed, mode }, fingerprint });
}

async function copySheetExample() {
  const example = serializePreferenceSheet(workspace.participants, createRandomPreferences(workspace.participants, SEATS, DEFAULT_RANDOM_SEED), { delimiter: '\t', companions: workspace.companions });
  sheetText = example;
  document.querySelector('#sheet-input').value = example;
  previewSheet();
  try {
    await navigator.clipboard.writeText(example);
    toast('예시 표를 복사했어요. 새 Google Sheets의 A1 셀에 붙여넣으세요.');
  } catch {
    const input = document.querySelector('#sheet-input');
    input.focus(); input.select();
    toast('예시 표를 선택했어요. 복사한 뒤 Google Sheets의 A1 셀에 붙여넣으세요.');
  }
}

let pendingImport = null;
async function prepareImport(file) {
  if (!file || actionPending) return;
  const revision = ++importReadRevision;
  try {
    if (file.size > 1024 * 1024) throw new Error('1MB 이하의 JSON, CSV 또는 TSV 파일을 선택해 주세요.');
    const text = await file.text();
    if (revision !== importReadRevision || actionPending) return;
    if (!/\.json$/i.test(file.name) && !text.trimStart().startsWith('{')) {
      sheetInputDialog(text, file.name);
      previewSheet();
      return;
    }
    const parsed = JSON.parse(text);
    const participants = parsed.participants || workspace.participants;
    validateRoster(participants);
    validateSubset(participants, parsed.preferences);
    if (Object.hasOwn(parsed, 'companions')) normalizeCompanions(participants, parsed.companions);
    pendingImport = { ...(parsed.participants ? { participants: participants.map(p => ({ id: p.id, name: p.name.trim(), part: p.part })) } : {}), preferences: parsed.preferences, ...(Object.hasOwn(parsed, 'companions') ? { companions: parsed.companions } : {}) };
    const count = Object.keys(parsed.preferences).length;
    openDialog({ title: '선호 파일 불러오기', subtitle: esc(file.name), body: `<p><strong>${count}명</strong>의 21개 선호를 확인했습니다.</p>${parsed.participants ? `<p>파일의 참여자 명단 <strong>${participants.length}명</strong>을 적용합니다.</p>` : '<p>현재 명단에 해당하는 참여자의 선호를 합칩니다.</p>'}<div class="dialog-note">같은 참여자의 기존 선호는 파일에 담긴 선호로 갱신됩니다. 기존 배정 결과는 해제되며 새로 배정할 수 있습니다. 전체 백업 파일을 불러오는 경우에도 결과는 최신 선호로 다시 계산합니다.</div><p class="form-error" id="import-error" role="alert"></p>`, footer: '<button class="btn" data-action="close-dialog">취소</button><button class="btn btn-primary" data-action="apply-import">파일 적용하기</button>' });
  } catch (error) { toast(error instanceof SyntaxError ? 'JSON 파일을 읽을 수 없습니다. 자리에서 내보낸 선호 파일을 선택해 주세요.' : error.message, true); }
}

async function applyImport({ drawOptions = null, fingerprint = stateFingerprint(workspace), errorId = 'import-error' } = {}) {
  if (actionPending || !pendingImport) return;
  if (drawOptions) {
    const validation = validatePreferences(workspace.participants, SEATS, { ...workspace.preferences, ...pendingImport.preferences });
    if (!validation.valid) { document.querySelector(`#${errorId}`).textContent = validation.errors[0]; return; }
  }
  actionPending = true;
  let succeeded = false;
  try {
    if (backend && !demo) setWorkspace(await api('/api/import', { method: 'POST', body: JSON.stringify({ ...pendingImport, fingerprint }) }));
    else {
      if (stateFingerprint(workspace) !== fingerprint) throw new Error('명단 또는 제출 선호가 변경되었습니다. 다시 가져와 주세요.');
      const participants = pendingImport.participants || workspace.participants;
      const existing = Object.fromEntries(Object.entries(workspace.preferences).filter(([id]) => participants.some(p => p.id === id)));
      const companions = normalizeCompanions(participants, { ...pruneCompanions(workspace.companions, participants), ...(pendingImport.companions || {}) });
      setWorkspace({ ...workspace, participants, companions, preferences: { ...existing, ...pendingImport.preferences }, result: null, updatedAt: new Date().toISOString() });
    }
    for (const id of Object.keys(pendingImport.preferences)) delete drafts[id];
    for (const id of Object.keys(pendingImport.companions || {})) delete companionDrafts[id];
    if (!demo) writeStorage(storageKeys.companions, companionDrafts);
    if (!demo) writeStorage(storageKeys.drafts, drafts);
    closeDialog(); render();
    if (!drawOptions) toast('선호 파일을 적용했어요. 참여 현황에서 확인해 주세요.');
    pendingImport = null;
    succeeded = true;
  } catch (error) { document.querySelector(`#${errorId}`).textContent = error.message; }
  finally { actionPending = false; }
  if (succeeded && drawOptions) await runDraw(drawOptions);
}

function choosePerson(id) {
  if (!workspace.participants.some(p => p.id === id)) return;
  currentId = id;
  if (!demo) writeStorage(storageKeys.person, id);
  render();
}
function addSeat(id) {
  if (!seatById.has(id)) return;
  selectedSeat = id;
  if (view === 'results') {
    const entry = workspace.result?.assignments.find(a => a.seatId === id);
    if (entry) choosePerson(entry.participantId);
    else zoneDialog(seatById.get(id).zone, id);
    return;
  }
  const ranking = getDraft();
  if (ranking.includes(id)) { zoneDialog(seatById.get(id).zone, id); return; }
  ranking.push(id); setDraft(ranking); render();
  const seat = app.querySelector(`[data-action="seat"][data-seat="${id}"]`);
  seat?.focus({ preventScroll: true });
  app.querySelector('.rank-list').scrollTop = app.querySelector('.rank-list').scrollHeight;
  toast(`${id}번 좌석을 ${ranking.length}지망으로 선택했어요.`);
}
function reorderRank(from, to) {
  const ranking = getDraft();
  if (from < 0 || to < 0 || from >= ranking.length || to >= ranking.length || from === to) return;
  const scroll = app.querySelector('.rank-list')?.scrollTop || 0;
  const [id] = ranking.splice(from, 1); ranking.splice(to, 0, id);
  setDraft(ranking); render();
  app.querySelector('.rank-list').scrollTop = scroll;
  app.querySelector(`[data-rank-index="${to}"] .rank-info`)?.focus({ preventScroll: true });
  toast(`${id}번 좌석을 ${to + 1}지망으로 옮겼어요.`);
}
function navigate(nextView) {
  view = nextView;
  render();
  if (view === 'preferences') {
    if (window.innerWidth <= 900) app.querySelector('.preference-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    app.querySelector('#person-select')?.focus({ preventScroll: true });
  } else window.scrollTo({ top: 0, behavior: 'smooth' });
}
function enterDemo() { location.assign(`${location.pathname}?demo=1`); }
function exitDemo() { location.assign(location.pathname); }

async function handleAction(button) {
  if (busy && button.dataset.action !== 'close-dialog') return;
  const action = button.dataset.action;
  if (actionPending && !['rank-up', 'rank-down', 'rank-remove', 'autofill', 'clear-draft'].includes(action)) return;
  switch (action) {
    case 'navigate': navigate(button.dataset.view); break;
    case 'guide': guideDialog(); break;
    case 'manage': manageDialog(); break;
    case 'seat': addSeat(button.dataset.seat); break;
    case 'preview-seat': zoneDialog(seatById.get(button.dataset.seat).zone, button.dataset.seat); break;
    case 'zone-info': zoneDialog(button.dataset.zone); break;
    case 'dialog-seat': {
      const id = button.dataset.seat;
      closeDialog();
      if (view === 'results' || !getDraft().includes(id)) addSeat(id);
      else { selectedSeat = id; render(); toast(`${id}번은 이미 ${getDraft().indexOf(id) + 1}지망이에요.`); }
      break;
    }
    case 'add-zone': {
      const ranking = getDraft();
      const seats = SEATS.filter(s => s.zone === button.dataset.zone && !ranking.includes(s.id));
      setDraft([...ranking, ...seats.map(s => s.id)]); closeDialog(); render(); toast(`${seats.length}개 좌석을 남은 지망에 추가했어요.`); break;
    }
    case 'autofill': {
      const ranking = getDraft();
      const origin = seatById.get(ranking.at(-1));
      const remaining = SEATS.filter(s => !ranking.includes(s.id));
      if (origin) remaining.sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y));
      setDraft([...ranking, ...remaining.map(s => s.id)]); render(); toast('남은 좌석을 채웠어요. 원하는 순서로 수정한 뒤 저장해 주세요.'); break;
    }
    case 'clear-draft': setDraft([]); render(); toast('선택 순서를 비웠어요. 제출한 선호는 다시 저장할 때 갱신됩니다.'); break;
    case 'rank-up': reorderRank(Number(button.dataset.index), Number(button.dataset.index) - 1); break;
    case 'rank-down': reorderRank(Number(button.dataset.index), Number(button.dataset.index) + 1); break;
    case 'rank-remove': {
      const ranking = getDraft(); const [id] = ranking.splice(Number(button.dataset.index), 1);
      setDraft(ranking); render(); toast(`${id}번 좌석을 선택에서 뺐어요.`); break;
    }
    case 'save-preferences': await savePreferences(); break;
    case 'export-person': exportPerson(); break;
    case 'export-workspace': exportWorkspace(); break;
    case 'download-csv': downloadCsv(); break;
    case 'draw-settings': drawSettings(); break;
    case 'random-settings': randomSettings(); break;
    case 'run-random': await runAllRandom(); break;
    case 'run-draw': await runDraw(); break;
    case 'enter-demo': enterDemo(); break;
    case 'exit-demo': exitDemo(); break;
    case 'zoom-in': zoom = Math.min(140, zoom + 10); render(); break;
    case 'zoom-out': zoom = Math.max(80, zoom - 10); render(); break;
    case 'filter': filter = button.dataset.part; render(); break;
    case 'choose-person': if (view !== 'results') view = 'preferences'; choosePerson(button.dataset.person); if (window.innerWidth <= 900) app.querySelector('.preference-card, .result-panel')?.scrollIntoView({ behavior: 'smooth' }); break;
    case 'reference': openDialog({ title: '13층 원본 좌석 안내', subtitle: '제공해 주신 도면과 실제 좌석 사진입니다.', wide: true, body: '<img src="assets/floor-reference.jpg" alt="13층 플랫폼개발팀 A 9석, B 6석, C 6석의 원본 도면 및 사진"/>', footer: '<button class="btn btn-primary" data-action="close-dialog">확인</button>' }); break;
    case 'close-dialog': closeDialog(); break;
    case 'add-person': {
      if (rosterDraft.length >= 21) { document.querySelector('#roster-error').textContent = '좌석 수에 맞춰 최대 21명까지 참여할 수 있습니다.'; return; }
      rosterDraft.push({ id: `person-${crypto.randomUUID()}`, name: '', part: 'data' });
      document.querySelector('#roster-list').innerHTML = rosterRows();
      document.querySelector('#roster-count').textContent = `(${rosterDraft.length}/21)`;
      document.querySelector('#roster-list').lastElementChild.querySelector('input').focus(); break;
    }
    case 'remove-person': rosterDraft.splice(Number(button.dataset.index), 1); document.querySelector('#roster-list').innerHTML = rosterRows(); document.querySelector('#roster-count').textContent = `(${rosterDraft.length}/21)`; break;
    case 'save-roster': await saveRoster(); break;
    case 'import': sheetInputDialog(); break;
    case 'public-sheet': sheetInputDialog(); document.querySelector('#public-sheet-url').focus(); break;
    case 'fetch-public-sheet': await loadPublicSheet(); break;
    case 'draw-public-sheet': await loadPublicSheet({ draw: true }); break;
    case 'copy-sheet-example': await copySheetExample(); break;
    case 'pick-import-file': app.querySelector('#import-file').value = ''; app.querySelector('#import-file').click(); break;
    case 'sheet-template': downloadSheetTemplate(); break;
    case 'export-sheet': downloadFile('자리-제출선호.csv', serializePreferenceSheet(workspace.participants, workspace.preferences, { includeBom: true, companions: workspace.companions }), 'text/csv;charset=utf-8'); break;
    case 'preview-sheet': previewSheet(); break;
    case 'fill-random-sheet': {
      sheetText = serializePreferenceSheet(workspace.participants, createRandomPreferences(workspace.participants, SEATS, `sheet-random-${Date.now()}`), { delimiter: '\t', companions: workspace.companions });
      document.querySelector('#sheet-input').value = sheetText; previewSheet(); break;
    }
    case 'apply-sheet': if (sheetPreview?.valid) { pendingImport = { preferences: sheetPreview.preferences, companions: sheetPreview.companions }; await applyImport(); } break;
    case 'enter-random-demo': location.assign(`${location.pathname}?demo=1&random=1&seed=${encodeURIComponent(DEFAULT_RANDOM_SEED)}&view=results`); break;
    case 'apply-import': await applyImport(); break;
  }
}

app.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (button && !button.disabled) handleAction(button).catch(error => toast(error.message, true));
});
dialog.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (button && !button.disabled) handleAction(button).catch(error => toast(error.message, true));
});
dialog.addEventListener('cancel', event => { if (busy || actionPending) event.preventDefault(); });
dialog.addEventListener('close', () => { if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus({ preventScroll: true }); });
app.addEventListener('change', event => {
  if (event.target.id === 'person-select') choosePerson(event.target.value);
  if (event.target.id === 'companion-select') { setCompanionDraft(event.target.value); render(); document.querySelector('#companion-select')?.focus({ preventScroll: true }); }
  if (event.target.id === 'import-file') prepareImport(event.target.files[0]);
});
app.addEventListener('input', event => {
  if (event.target.id === 'person-search') { search = event.target.value; document.querySelector('#participant-rows').innerHTML = participantRows(view === 'results' && !!workspace.result); }
});
dialog.addEventListener('input', event => {
  if (event.target.id === 'sheet-input') { sheetText = event.target.value; sheetPreview = null; document.querySelector('[data-action="apply-sheet"]').disabled = true; document.querySelector('#sheet-preview').innerHTML = ''; }
  if (event.target.id === 'public-sheet-url') {
    sheetPreview = null; pendingImport = null;
    document.querySelector('[data-action="apply-sheet"]').disabled = true;
    document.querySelector('#sheet-preview').innerHTML = '';
    document.querySelector('#sheet-status').textContent = '';
  }
  const row = event.target.closest('[data-roster-index]');
  if (row && event.target.dataset.field) rosterDraft[Number(row.dataset.rosterIndex)][event.target.dataset.field] = event.target.value;
});
app.addEventListener('dragstart', event => {
  const row = event.target.closest('[data-rank-index]');
  if (!row) return;
  draggedRank = Number(row.dataset.rankIndex); row.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(draggedRank));
});
app.addEventListener('dragover', event => {
  const row = event.target.closest('[data-rank-index]');
  if (row && draggedRank !== null) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; row.classList.add('drag-over'); }
});
app.addEventListener('dragleave', event => event.target.closest('[data-rank-index]')?.classList.remove('drag-over'));
app.addEventListener('drop', event => {
  const row = event.target.closest('[data-rank-index]');
  if (row && draggedRank !== null) { event.preventDefault(); reorderRank(draggedRank, Number(row.dataset.rankIndex)); }
  draggedRank = null;
});
app.addEventListener('dragend', () => { draggedRank = null; app.querySelectorAll('.dragging, .drag-over').forEach(el => el.classList.remove('dragging', 'drag-over')); });

async function syncWorkspace(force = false) {
  if (!backend || demo || syncing || busy || actionPending || (!force && (dialog.open || ['INPUT', 'SELECT'].includes(document.activeElement?.tagName)))) return;
  syncing = true;
  const revision = workspaceRevision;
  try {
    const next = await api('/api/state');
    if (revision !== workspaceRevision || busy || actionPending) return;
    if (!equal(next, workspace)) {
      for (const id of Object.keys(drafts)) if (equal(drafts[id], workspace.preferences[id])) delete drafts[id];
      for (const id of Object.keys(companionDrafts)) if ((companionDrafts[id] || null) === (workspace.companions[id] || null)) delete companionDrafts[id];
      setWorkspace(next); render();
    }
  } catch (error) { if (force) toast(error.message, true); }
  finally { syncing = false; }
}
async function init() {
  app.innerHTML = '<div class="boot-screen"><span class="spinner" aria-hidden="true"></span><p>우리의 자리를 준비하고 있어요.</p></div>';
  if (demo) {
    workspace.preferences = urlParams.has('random') ? createRandomPreferences(workspace.participants, SEATS, urlParams.get('seed') || DEFAULT_RANDOM_SEED) : createDemoPreferences(workspace.participants);
    drafts = {}; companionDrafts = {};
    try {
      const response = await fetch('/api/state', { signal: AbortSignal.timeout(4500) });
      backend = response.ok && !!response.headers.get('content-type')?.includes('application/json');
    } catch { backend = false; }
  }
  else {
    try {
      const response = await fetch('/api/state', { signal: AbortSignal.timeout(4500) });
      if (response.ok && response.headers.get('content-type')?.includes('application/json')) { workspace = await response.json(); backend = true; }
      else throw new Error('static');
    } catch {
      const stored = readStorage(storageKeys.state, null);
      if (stored) {
        try {
          validateRoster(stored.participants); validateSubset(stored.participants, stored.preferences);
          stored.companions = normalizeCompanions(stored.participants, stored.companions === undefined ? {} : stored.companions);
          if (stored.result) {
            if (stored.result.mode === 'random') {
              const expected = allocateRandomSeats({ participants: stored.participants, seats: SEATS, seed: stored.result.seed });
              if (!equal(stored.result, expected)) stored.result = null;
            } else {
              const validation = validatePreferences(stored.participants, SEATS, stored.preferences);
              if (!validation.valid || !stored.result.metrics || findBlockingPairs(stored.participants, SEATS, buildMatchingPreferences(stored.participants, SEATS, stored.preferences, stored.companions, stored.result.companionPlan || []), stored.result.seatPriorities, stored.result.assignments).length) stored.result = null;
            }
          }
          workspace = stored;
        } catch { toast('저장된 데이터를 읽지 못했습니다. 백업 파일을 불러올 수 있어요.', true); }
      }
    }
  }
  workspace.companions = normalizeCompanions(workspace.participants, workspace.companions === undefined ? {} : workspace.companions);
  sanitizeCompanionDrafts();
  if (!workspace.participants.some(p => p.id === currentId)) currentId = workspace.participants[0].id;
  render();
  if (demo && urlParams.has('random') && view === 'results') await runDraw({ seed: urlParams.get('seed') || DEFAULT_RANDOM_SEED, mode: 'distance' });
  setInterval(() => syncWorkspace(), 12000);
}
init().catch(error => { app.innerHTML = `<div class="boot-screen"><p>${esc(error.message)}</p><button class="btn" onclick="location.reload()">다시 열기</button></div>`; });
