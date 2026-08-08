// Does my proposed in-process byte counter + rename rotation survive N instances?
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const DIR = '/tmp/rot_race'; const ACTIVE = DIR + '/perf.jsonl'; const PREV = DIR + '/perf.1.jsonl';
const CAP = 1024 * 1024;           // 1 MiB cap (scaled down from 8 MiB)
const N_PROC = 8, N_LINES = 1200;
const self = fileURLToPath(import.meta.url);

if (process.argv[2] === 'child') {
  const id = Number(process.argv[3]);
  let myBytes = 0;                  // <-- the flaw: per-process counter
  try { myBytes = fs.statSync(ACTIVE).size; } catch {}
  for (let i = 0; i < N_LINES; i++) {
    const line = JSON.stringify({ w: id, i, pad: 'x'.repeat(600) }) + '\n';
    fs.appendFileSync(ACTIVE, line);
    myBytes += Buffer.byteLength(line);
    if (myBytes >= CAP) {
      try { fs.unlinkSync(PREV); } catch {}
      try { fs.renameSync(ACTIVE, PREV); } catch {}
      myBytes = 0;
    }
  }
  process.exit(0);
}

fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
await Promise.all(Array.from({ length: N_PROC }, (_, k) => new Promise((r) => {
  spawn(process.execPath, [self, 'child', String(k)], { stdio: 'ignore' }).on('exit', r);
})));

const written = N_PROC * N_LINES;
let surviving = 0, files = [];
for (const f of fs.readdirSync(DIR)) {
  const p = DIR + '/' + f; const sz = fs.statSync(p).size;
  files.push(`${f}=${(sz/1024/1024).toFixed(2)}MiB`);
  surviving += fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).length;
}
const total = files.reduce((a, f) => a, 0);
const totalBytes = fs.readdirSync(DIR).reduce((a, f) => a + fs.statSync(DIR + '/' + f).size, 0);
console.log(`cap per file: 1.00 MiB   intended ceiling: 2.00 MiB (2 files)`);
console.log(`files on disk: ${files.join('  ')}`);
console.log(`ACTUAL total bytes: ${(totalBytes/1024/1024).toFixed(2)} MiB`);
console.log(`records written: ${written}   records still readable: ${surviving}   LOST: ${written - surviving}`);
console.log(`\nceiling respected? ${totalBytes <= 2*CAP ? 'yes' : 'NO — exceeded by ' + ((totalBytes/(2*CAP))).toFixed(1) + 'x'}`);
fs.rmSync(DIR, { recursive: true, force: true });
