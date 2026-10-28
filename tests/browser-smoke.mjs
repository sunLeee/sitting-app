import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
import { INITIAL_PARTICIPANTS, SEATS, createDemoPreferences } from '../data.mjs';
import { findBlockingPairs, buildMatchingPreferences } from '../matching.mjs';
import { getAssignedCompanion } from '../companion.mjs';
import { PREFERENCE_SHEET_URL, TEMPLATE_COPY_URL } from '../sheet-template-config.mjs';
import { createRandomPreferences } from '../random-preferences.mjs';
import { createSheetTemplate, parsePreferenceSheet, serializePreferenceSheet } from '../sheet-input.mjs';

// Playwright is a test tool supplied by the operator, not an app dependency.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'jari-browser-'));
const artifacts = path.resolve('artifacts');
const server = await createServer({ dataDir: temporary });
let browser;
const errors = [];
const checks = [];
const action = (page, name) => page.locator(`[data-action="${name}"]`).first();
const rankings = page => page.locator('.rank-list .rank-info[data-seat]').evaluateAll(nodes => nodes.map(node => node.dataset.seat));
async function check(name, operation) {
  await operation();
  checks.push(name);
  console.log(`PASS ${name}`);
}
async function ready(page) {
  await page.locator('.floor-card').waitFor();
  assert.equal(await page.locator('.floor-card [data-action="seat"]').count(), 21);
}
function monitor(page) { page.on('pageerror', error => errors.push(error.message)); }
async function download(page, name) {
  const pending = page.waitForEvent('download');
  await action(page, name).click();
  const file = await pending;
  return { name: file.suggestedFilename(), content: await readFile(await file.path(), 'utf8') };
}
async function draw(page, seed) {
  await page.locator('[data-action="navigate"][data-view="seats"]').first().click();
  await action(page, 'draw-settings').click();
  await page.locator('#draw-seed').fill(seed);
  const response = page.waitForResponse(response => response.url().endsWith('/api/result') && response.request().method() === 'PUT');
  await action(page, 'run-draw').click();
  assert.equal((await response).status(), 200);
  await page.locator('.result-panel').waitFor();
}

try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const state = async () => (await fetch(`${base}/api/state`)).json();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  monitor(page);
  await page.goto(base);
  await ready(page);
  await check('21 seats, 20 participants, map choices are unique; Escape closes dialog', async () => {
    assert.equal(await page.locator('#participant-rows tr').count(), 20);
    await page.locator('[data-action="seat"][data-seat="68"]').click();
    await page.locator('[data-action="seat"][data-seat="68"]').click();
    await page.locator('#dialog[open]').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('#dialog[open]').waitFor({ state: 'hidden' });
    assert.deepEqual(await rankings(page), ['68']);
  });
  await check('rank arrows, removal and autofill produce 21 unique choices', async () => {
    await page.locator('[data-action="seat"][data-seat="69"]').click();
    await page.locator('[data-action="rank-up"][data-index="1"]').click();
    assert.deepEqual(await rankings(page), ['69', '68']);
    await page.locator('[data-action="rank-down"][data-index="0"]').click();
    assert.deepEqual(await rankings(page), ['68', '69']);
    await page.locator('[data-action="rank-remove"][data-index="0"]').click();
    assert.deepEqual(await rankings(page), ['69']);
    await action(page, 'autofill').click();
    assert.equal(new Set(await rankings(page)).size, 21);
  });
  await check('ranking and cross-part companion edits during delayed PUT survive response and reload', async () => {
    await page.locator('#companion-select').selectOption('dispatch-1');
    const submitted = await rankings(page);
    let release, intercepted;
    const gate = new Promise(resolve => { release = resolve; });
    const seen = new Promise(resolve => { intercepted = resolve; });
    await page.route('**/api/preferences/*', async route => {
      const response = await route.fetch();
      intercepted();
      await gate;
      await route.fulfill({ response });
    });
    await action(page, 'save-preferences').click();
    await seen;
    await page.locator('[data-action="rank-up"][data-index="1"]').click();
    const edited = await rankings(page);
    await page.locator('#companion-select').selectOption('dispatch-2');
    assert.notDeepEqual(edited, submitted);
    release();
    await action(page, 'save-preferences').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('[data-action="save-preferences"]').disabled);
    assert.deepEqual(await rankings(page), edited);
    assert.deepEqual((await state()).preferences['data-1'], submitted);
    assert.equal((await state()).companions['data-1'], 'dispatch-1');
    assert.equal(await page.locator('#companion-select').inputValue(), 'dispatch-2');
    await page.unroute('**/api/preferences/*');
    await page.reload();
    await ready(page);
    assert.deepEqual(await rankings(page), edited);
    assert.equal(await page.locator('#companion-select').inputValue(), 'dispatch-2');
    const saved = page.waitForResponse(response => response.url().includes('/api/preferences/') && response.request().method() === 'PUT');
    await action(page, 'save-preferences').click();
    assert.equal((await saved).status(), 200);
    await page.waitForFunction(() => document.querySelector('[data-action="save-preferences"]').textContent.includes('저장 완료'));
    await page.reload();
    await ready(page);
    assert.deepEqual(await rankings(page), edited);
  });
  const otherContext = await browser.newContext({ acceptDownloads: true });
  const other = await otherContext.newPage();
  monitor(other);
  await other.goto(base);
  await ready(other);
  await check('independent browser sees shared submission; individual JSON round-trip works', async () => {
    assert.equal(await other.locator('.submitted-status').count(), 1);
    const file = await download(page, 'export-person');
    const parsed = JSON.parse(file.content);
    assert.equal(parsed.format, 'jari-preferences-v1');
    assert.equal(parsed.preferences['data-1'].length, 21);
    assert.equal(parsed.companions['data-1'], 'dispatch-2');
    await other.locator('#import-file').setInputFiles({ name: file.name, mimeType: 'application/json', buffer: Buffer.from(file.content) });
    await action(other, 'apply-import').click();
    await other.locator('#dialog[open]').waitFor({ state: 'hidden' });
    assert.deepEqual((await state()).preferences['data-1'], parsed.preferences['data-1']);
  });
  await check('UI bulk import collects all 20 complete rankings', async () => {
    const bulk = { format: 'jari-workspace-v1', participants: INITIAL_PARTICIPANTS, preferences: createDemoPreferences() };
    await page.locator('#import-file').setInputFiles({ name: 'all-preferences.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bulk)) });
    await action(page, 'apply-import').click();
    await page.locator('#dialog[open]').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.submitted-status').count(), 20);
    assert.equal(Object.keys((await state()).preferences).length, 20);
  });
  await check('Google Sheets template downloads 24 columns and prefilled copy links are configured', async () => {
    const template = await download(page, 'sheet-template');
    assert.equal(template.content.replace(/^\uFEFF/, '').split('\r\n')[0].split(',').length, 24);
    assert.equal(parsePreferenceSheet(template.content).rows.length, 20);
    assert.equal(await page.locator('.intro-actions a').getAttribute('href'), TEMPLATE_COPY_URL);
    assert.equal(await page.locator('#companion-select option[value="data-1"]').count(), 0);
    assert.equal(await page.locator('#companion-select option').count(), 20);
    assert.equal(await page.locator('[data-paired-seat]').count(), 6);
    assert.equal(await page.locator('[data-seat="85"]').first().getAttribute('data-paired-seat'), '90');
  });
  await check('Sheets paste validates all rows and invalid input never modifies saved preferences', async () => {
    const input = createRandomPreferences(INITIAL_PARTICIPANTS, SEATS, 'browser-sheets-paste');
    const companions = { 'data-1': 'map-1', 'map-1': 'data-1' };
    const valid = serializePreferenceSheet(INITIAL_PARTICIPANTS, input, { delimiter: '\t', companions });
    const before = await state();
    await action(page, 'import').click();
    assert.equal(await page.locator('#public-sheet-url').inputValue(), PREFERENCE_SHEET_URL);
    assert.equal(await page.locator('#dialog a').getAttribute('href'), TEMPLATE_COPY_URL);
    await page.locator('#sheet-input').fill(valid);
    await action(page, 'preview-sheet').click();
    assert.equal(await page.locator('.sheet-preview-table tbody tr').count(), 20);
    assert.equal(await page.locator('.sheet-preview-table tbody tr').first().locator('td').last().textContent(), INITIAL_PARTICIPANTS.find(person => person.id === 'map-1').name);
    assert.equal(await action(page, 'apply-sheet').isEnabled(), true);
    const lines = valid.split('\r\n');
    const cells = lines[1].split('\t');
    cells[23 - 1] = cells[2];
    lines[1] = cells.join('\t');
    await page.locator('#sheet-input').fill(lines.join('\r\n'));
    assert.equal(await action(page, 'apply-sheet').isDisabled(), true);
    await action(page, 'preview-sheet').click();
    assert.match(await page.locator('.sheet-errors').textContent(), /중복/);
    assert.deepEqual((await state()).preferences, before.preferences);
    await page.locator('#sheet-input').fill(valid);
    await action(page, 'preview-sheet').click();
    const applied = page.waitForResponse(r => r.url().endsWith('/api/import') && r.request().method() === 'POST');
    await action(page, 'apply-sheet').click();
    assert.equal((await applied).status(), 200);
    await page.locator('#dialog[open]').waitFor({ state: 'hidden' });
    assert.deepEqual((await state()).preferences, input);
    assert.deepEqual((await state()).companions, companions);
  });
  await check('UTF8 CSV file upload imports the same validated Google Sheets rows', async () => {
    const input = createRandomPreferences(INITIAL_PARTICIPANTS, SEATS, 'browser-sheets-csv');
    await page.locator('#import-file').setInputFiles({ name: 'google-sheets.csv', mimeType: 'text/csv', buffer: Buffer.from(serializePreferenceSheet(INITIAL_PARTICIPANTS, input, { includeBom: true, companions: { 'data-1': 'map-1', 'map-1': 'data-1' } })) });
    await page.locator('.sheet-success').waitFor();
    const applied = page.waitForResponse(r => r.url().endsWith('/api/import') && r.request().method() === 'POST');
    await action(page, 'apply-sheet').click();
    assert.equal((await applied).status(), 200);
    await page.locator('#dialog[open]').waitFor({ state: 'hidden' });
    assert.deepEqual((await state()).preferences, input);
  });
  await check('delayed polling GET cannot regress a subsequent preference save', async () => {
    await page.clock.install();
    let release, intercepted;
    const gate = new Promise(resolve => { release = resolve; });
    const seen = new Promise(resolve => { intercepted = resolve; });
    await page.route('**/api/state', async route => {
      const response = await route.fetch();
      intercepted();
      await gate;
      await route.fulfill({ response });
    });
    await page.locator('h1').click();
    await page.clock.fastForward(12001);
    await seen;
    await page.locator('[data-action="rank-up"][data-index="1"]').click();
    const edited = await rankings(page);
    const saved = page.waitForResponse(response => response.url().includes('/api/preferences/') && response.request().method() === 'PUT');
    await action(page, 'save-preferences').click();
    assert.equal((await saved).status(), 200);
    await page.waitForFunction(() => document.querySelector('[data-action="save-preferences"]').textContent.includes('저장 완료'));
    const poll = page.waitForResponse(response => response.url().endsWith('/api/state'));
    release();
    await poll;
    await page.waitForTimeout(100);
    assert.deepEqual(await rankings(page), edited);
    assert.deepEqual((await state()).preferences['data-1'], edited);
    await page.unroute('**/api/state');
  });
  let firstAssignments;
  await check('worker distance draw returns stable 20-person assignment with one vacancy', async () => {
    await draw(page, 'browser-smoke-seed');
    const latest = await state();
    firstAssignments = latest.result.assignments;
    assert.equal(firstAssignments.length, 20);
    assert.equal(new Set(firstAssignments.map(entry => entry.seatId)).size, 20);
    assert.equal(latest.result.metrics.vacancies, 1);
    assert.ok(latest.result.metrics.candidateCount > 7981);
    assert.equal(latest.result.metrics.companionRequested, 2);
    assert.equal(latest.result.metrics.companionSatisfied, 2);
    assert.equal(getAssignedCompanion('data-1', SEATS, firstAssignments), 'map-1');
    assert.equal(await page.locator('.companion-status').textContent(), '희망 동료와 함께 배정');
    for (const entry of firstAssignments) assert.equal(entry.rank, latest.preferences[entry.participantId].indexOf(entry.seatId) + 1);
    assert.deepEqual(findBlockingPairs(latest.participants, SEATS, buildMatchingPreferences(latest.participants, SEATS, latest.preferences, latest.companions, latest.result.companionPlan), latest.result.seatPriorities, firstAssignments), []);
    assert.equal(await page.locator('.seat-occupant').count(), 21);
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, 'browser-desktop-results.png'), fullPage: true });
  });
  await check('CSV export includes all participants and vacancy; same seed reproduces assignments', async () => {
    const csv = await download(page, 'download-csv');
    assert.match(csv.name, /\.csv$/);
    assert.equal(csv.content.trim().split('\r\n').length, 22);
    assert.match(csv.content, /빈자리/);
    assert.match(csv.content, /희망 동료/);
    assert.match(csv.content, /C구역 실제 짝 동료/);
    assert.match(csv.content, /희망 동료와 함께 배정/);
    await draw(page, 'browser-smoke-seed');
    assert.deepEqual((await state()).result.assignments, firstAssignments);
  });
  await check('demo edits and allocation never change actual server data', async () => {
    const before = await state();
    const demo = await context.newPage();
    monitor(demo);
    await demo.goto(`${base}/?demo=1`);
    await ready(demo);
    await demo.locator('[data-action="rank-up"][data-index="1"]').click();
    await action(demo, 'save-preferences').click();
    await demo.waitForFunction(() => document.querySelector('[data-action="save-preferences"]').textContent.includes('저장 완료'));
    await action(demo, 'draw-settings').click();
    await action(demo, 'run-draw').click();
    await demo.locator('.result-panel').waitFor();
    assert.deepEqual(await state(), before);
    await demo.close();
  });
  await check('random demo opens a reproducible allocation immediately without changing the workspace', async () => {
    const before = await state();
    const random = await context.newPage();
    monitor(random);
    await random.goto(`${base}/?demo=1&random=1&view=results`);
    await random.locator('.result-panel').waitFor();
    assert.match(await random.locator('.content').textContent(), /14/);
    assert.equal(await random.locator('.floor-card [data-action="seat"]').count(), 21);
    assert.deepEqual(await state(), before);
    await random.close();
  });
  await check('complete random draw preserves companion settings and explicitly ignores requests', async () => {
    const before = await state();
    await action(page, 'random-settings').click();
    await page.locator('#random-seed').fill('browser-pure-random');
    await page.locator('input[name="random-kind"][value="random"]').check();
    const saved = page.waitForResponse(response => response.url().endsWith('/api/result') && response.request().method() === 'PUT');
    await action(page, 'run-random').click();
    assert.equal((await saved).status(), 200);
    await page.locator('.result-panel').waitFor();
    const latest = await state();
    assert.equal(latest.result.mode, 'random');
    assert.deepEqual(latest.companions, before.companions);
    assert.ok(latest.result.assignments.every(entry => entry.rank === null));
    assert.equal(await page.locator('.companion-stats').count(), 0);
    assert.match(await page.locator('.companion-status').textContent(), /미반영/);
  });
  await check('browser storage mode loads legacy state, preserves legacy imports and prunes deleted companions', async () => {
    const participants = [INITIAL_PARTICIPANTS.find(person => person.id === 'data-1'), INITIAL_PARTICIPANTS.find(person => person.id === 'map-1'), INITIAL_PARTICIPANTS.find(person => person.id === 'dispatch-1')];
    const preferences = createRandomPreferences(participants, SEATS, 'local-companion');
    const localContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await localContext.addInitScript(({ participants, preferences }) => {
      localStorage.setItem('jari-workspace-v1', JSON.stringify({ version: 1, participants, preferences, result: null, updatedAt: null }));
      localStorage.setItem('jari-current-person-v1', 'data-1');
    }, { participants, preferences });
    const local = await localContext.newPage();
    monitor(local);
    await local.route('**/api/state', route => route.abort());
    await local.goto(base);
    await ready(local);
    assert.equal(await local.locator('#companion-select').inputValue(), '');
    await local.locator('#companion-select').selectOption('map-1');
    await action(local, 'save-preferences').click();
    await local.waitForFunction(() => document.querySelector('[data-action="save-preferences"]').textContent.includes('저장 완료'));
    const readLocal = () => local.evaluate(() => JSON.parse(localStorage.getItem('jari-workspace-v1')));
    assert.deepEqual((await readLocal()).companions, { 'data-1': 'map-1' });
    const legacy = serializePreferenceSheet(participants, preferences, { delimiter: '\t' }).split('\r\n').filter(Boolean).map(line => line.split('\t').slice(0, -1).join('\t')).join('\r\n');
    await action(local, 'import').click();
    await local.locator('#sheet-input').fill(legacy);
    await action(local, 'preview-sheet').click();
    await action(local, 'apply-sheet').click();
    await local.locator('#dialog[open]').waitFor({ state: 'hidden' });
    assert.deepEqual((await readLocal()).companions, { 'data-1': 'map-1' });
    await action(local, 'import').click();
    await local.locator('#sheet-input').fill(serializePreferenceSheet(participants, preferences, { delimiter: '\t' }));
    await action(local, 'preview-sheet').click();
    await action(local, 'apply-sheet').click();
    await local.locator('#dialog[open]').waitFor({ state: 'hidden' });
    assert.deepEqual((await readLocal()).companions, {});
    await local.locator('#companion-select').selectOption('dispatch-1');
    await action(local, 'save-preferences').click();
    await local.waitForFunction(() => document.querySelector('[data-action="save-preferences"]').textContent.includes('저장 완료'));
    await action(local, 'manage').click();
    await local.locator('[data-action="remove-person"][data-index="2"]').click();
    await action(local, 'save-roster').click();
    await local.locator('#dialog[open]').waitFor({ state: 'hidden' });
    assert.equal((await readLocal()).participants.length, 2);
    assert.deepEqual((await readLocal()).companions, {});
    assert.equal(await local.locator('#companion-select option[value="dispatch-1"]').count(), 0);
    await localContext.close();
  });
  await check('390px mobile has no page overflow and all 21 seats fit the scrollable map', async () => {
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
    const mobile = await mobileContext.newPage();
    monitor(mobile);
    await mobile.goto(base);
    await ready(mobile);
    const geometry = await mobile.evaluate(() => {
      const stage = document.querySelector('.floor-stage').getBoundingClientRect();
      return {
        viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
        seatsContained: [...document.querySelectorAll('.floor-card [data-action="seat"]')].every(node => {
          const seat = node.getBoundingClientRect();
          return seat.width > 0 && seat.height > 0 && seat.left >= stage.left && seat.right <= stage.right && seat.top >= stage.top && seat.bottom <= stage.bottom;
        }),
      };
    });
    assert.ok(geometry.pageWidth <= geometry.viewport, JSON.stringify(geometry));
    assert.equal(geometry.seatsContained, true, JSON.stringify(geometry));
    await mobile.screenshot({ path: path.join(artifacts, 'browser-mobile-seats.png'), fullPage: true });
    await action(mobile, 'import').click();
    await mobile.locator('#sheet-input').fill(serializePreferenceSheet(INITIAL_PARTICIPANTS, createRandomPreferences(), { delimiter: '\t' }));
    await action(mobile, 'preview-sheet').click();
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await mobile.screenshot({ path: path.join(artifacts, 'browser-mobile-sheet-input.png') });
    await mobile.keyboard.press('Escape');
    await mobileContext.close();
  });
  assert.deepEqual(errors, [], 'Browser JavaScript errors');
  console.log(`Browser smoke: ${checks.length} checks passed; no browser JavaScript errors.`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
