const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

function sheetError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function secureUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw sheetError('올바른 공개 Google Sheets 링크를 입력해 주세요.'); }
  // Check the original authority too: URL normalizes an explicit :443 away.
  const authority = /^https:\/\/([^/?#]+)/i.exec(String(value))?.[1];
  if (url.protocol !== 'https:' || !authority || authority.includes(':') || url.username || url.password || url.port) {
    throw sheetError('포트나 로그인 정보가 없는 HTTPS Google Sheets 링크를 입력해 주세요.');
  }
  return url;
}

function exportLocation(link) {
  if (typeof link !== 'string' || !link.trim() || link.length > 4096) {
    throw sheetError('공개 Google Sheets 링크를 입력해 주세요.');
  }
  const source = secureUrl(link.trim());
  if (source.hostname !== 'docs.google.com') {
    throw sheetError('docs.google.com의 공개 Google Sheets 링크만 사용할 수 있습니다.');
  }
  const regular = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/(?:edit|export|view))?\/?$/.exec(source.pathname);
  const published = /^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]+)\/(?:pubhtml|pub)\/?$/.exec(source.pathname);
  if (!regular && !published) throw sheetError('Google Sheets 문서 링크 또는 웹에 게시한 시트 링크를 입력해 주세요.');

  const queryGids = source.searchParams.getAll('gid');
  const hashGids = new URLSearchParams(source.hash.slice(1)).getAll('gid');
  const gids = [...queryGids, ...hashGids];
  if (gids.some(gid => !/^\d+$/.test(gid)) || new Set(gids).size > 1) {
    throw sheetError('시트 탭 번호(gid)는 하나의 숫자로 지정해 주세요.');
  }
  const gid = gids[0] ?? '0';
  const target = new URL(published
    ? `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub`
    : `https://docs.google.com/spreadsheets/d/${regular[1]}/export`);
  target.searchParams.set(published ? 'output' : 'format', 'csv');
  target.searchParams.set('gid', gid);
  return { sourceUrl: source.href, exportUrl: target.href };
}

function downloadLocation(location, current) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(location)) secureUrl(location);
  else if (location.startsWith('//')) secureUrl(`https:${location}`);
  let next;
  try { next = new URL(location, current); }
  catch { throw sheetError('Google Sheets 다운로드 주소를 읽을 수 없습니다.', 502); }
  const url = secureUrl(next.href);
  if (url.hostname !== 'docs.google.com' && !url.hostname.endsWith('.googleusercontent.com')) {
    throw sheetError('공개 시트를 읽을 수 없습니다. 공유 설정을 “링크가 있는 모든 사용자: 뷰어”로 변경하거나 “웹에 게시”해 주세요.', 422);
  }
  return url.href;
}

async function readBounded(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel();
    throw sheetError('시트 CSV는 1MiB 이하로 준비해 주세요.', 413);
  }
  if (!response.body) throw sheetError('Google Sheets에서 빈 응답을 받았습니다.', 502);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw sheetError('시트 CSV는 1MiB 이하로 준비해 주세요.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

/** Fetch a public Google Sheets tab as CSV without changing saved preferences. */
export async function fetchPublicPreferenceSheet(link) {
  const locations = exportLocation(link);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  timeout.unref();
  try {
    let current = locations.exportUrl;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'text/csv, text/plain;q=0.9' },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location || redirects === MAX_REDIRECTS) {
          throw sheetError('Google Sheets 다운로드 리디렉션이 올바르지 않습니다.', 502);
        }
        current = downloadLocation(location, current);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403, 404].includes(response.status)) {
          throw sheetError('시트를 찾거나 읽을 수 없습니다. 링크와 공유 설정(“링크가 있는 모든 사용자: 뷰어” 또는 “웹에 게시”)을 확인해 주세요.', 422);
        }
        throw sheetError(`Google Sheets를 불러오지 못했습니다 (HTTP ${response.status}). 잠시 후 다시 시도해 주세요.`, 502);
      }
      if (/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel();
        throw sheetError('CSV 대신 로그인 또는 안내 페이지가 반환되었습니다. 시트를 공개하거나 웹에 게시해 주세요.', 422);
      }
      const text = await readBounded(response);
      if (/^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(text.replace(/^\uFEFF/, ''))) {
        throw sheetError('CSV 대신 로그인 또는 안내 페이지가 반환되었습니다. 시트를 공개하거나 웹에 게시해 주세요.', 422);
      }
      if (!text.trim()) throw sheetError('공개 시트가 비어 있습니다. 예시 헤더와 참가자 지망 행을 입력해 주세요.', 422);
      return { text, ...locations };
    }
    throw sheetError('Google Sheets 다운로드를 완료하지 못했습니다.', 502);
  } catch (error) {
    if (controller.signal.aborted) throw sheetError('Google Sheets 읽기가 15초를 초과했습니다. 잠시 후 다시 시도해 주세요.', 504);
    if (error.status) throw error;
    throw sheetError('Google Sheets에 연결할 수 없습니다. 네트워크와 공개 시트 링크를 확인해 주세요.', 502);
  } finally {
    clearTimeout(timeout);
  }
}
