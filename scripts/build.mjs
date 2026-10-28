import { access, cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const files = ['index.html', 'app.mjs', 'styles.css', 'data.mjs', 'matching.mjs', 'allocation-worker.mjs', 'sheet-input.mjs', 'random-preferences.mjs', 'random-allocation.mjs', 'assets'];
await Promise.all(files.map(file => access(path.join(root, file))));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files) {
  await cp(path.join(root, file), path.join(output, file), { recursive: true });
}
console.log('정적 파일 빌드 완료: dist (API와 저장 기능은 Node 서버로 실행하세요.)');
