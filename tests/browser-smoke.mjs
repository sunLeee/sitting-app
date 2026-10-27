import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
import { INITIAL_PARTICIPANTS, SEATS, createDemoPreferences } from '../data.mjs';
import { findBlockingPairs } from '../matching.mjs';

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
  await check('edits made during a delayed preference PUT survive response and reload', async () => {
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
    assert.notDeepEqual(edited, submitted);
    release();
    await action(page, 'save-preferences').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('[data-action="save-preferences"]').disabled);
    assert.deepEqual(await rankings(page), edited);
    assert.deepEqual((await state()).preferences['data-1'], submitted);
    await page.unroute('**/api/preferences/*');
    await page.reload();
    await ready(page);
    assert.deepEqual(await rankings(page), edited);
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
    assert.equal(latest.result.metrics.candidateCount, 7981);
    assert.deepEqual(findBlockingPairs(latest.participants, SEATS, latest.preferences, latest.result.seatPriorities, firstAssignments), []);
    assert.equal(await page.locator('.seat-occupant').count(), 21);
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, 'browser-desktop-results.png'), fullPage: true });
  });
  await check('CSV export includes all participants and vacancy; same seed reproduces assignments', async () => {
    const csv = await download(page, 'download-csv');
    assert.match(csv.name, /\.csv$/);
    assert.equal(csv.content.trim().split('\r\n').length, 22);
    assert.match(csv.content, /빈자리/);
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
    await mobileContext.close();
  });
  assert.deepEqual(errors, [], 'Browser JavaScript errors');
  console.log(`Browser smoke: ${checks.length} checks passed; no browser JavaScript errors.`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
