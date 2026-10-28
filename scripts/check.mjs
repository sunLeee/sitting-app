import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['app.mjs', 'allocation-worker.mjs', 'data.mjs', 'matching.mjs', 'server.mjs', 'sheet-input.mjs', 'random-preferences.mjs'];
for (const directory of ['scripts', 'tests']) {
  for (const file of await readdir(path.join(root, directory))) if (file.endsWith('.mjs')) files.push(`${directory}/${file}`);
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`JavaScript 구문 검사 통과: ${files.length}개 파일`);
