// Does per-process file + its OWN byte counter respect the ceiling? (rev.1 lost 49%)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const DIR = '/tmp/perproc_test';
const PER_FILE_CAP = 256 * 1024;   // scaled-down sub-roll threshold
const N_PROC = 8, N_LINES = 1200;
const self = fileURLToPath(import.meta.url);

if (process.argv[2] === 'child') {
  const pid = process.pid;
  let day = 8, seq = 0, bytes = 0;
  const name = () => `${DIR}/perf-2026080${day}-${pid}-${String(seq).padStart(3,'0')}.jsonl`;
  let target = name();
  for (let i = 0; i < N_LINES; i++) {
    // simulate crossing a UTC midnight a third of the way through
    const newDay = i > N_LINES / 3 ? 9 : 8;
    if (newDay !== day) { day = newDay; seq = 0; bytes = 0; target = name(); }
    const line = JSON.stringify({ p: pid, i, pad: 'x'.repeat(600) }) + '\n';
    if (bytes + Buffer.byteLength(line) > PER_FILE_CAP) { seq++; bytes = 0; target = name(); }
    fs.appendFileSync(target, line);
    bytes += Buffer.byteLength(line);
  }
  process.exit(0);
}

fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
await Promise.all(Array.from({ length: N_PROC }, () => new Promise((r) => {
  spawn(process.execPath, [self, 'child'], { stdio: 'ignore' }).on('exit', r);
})));

const files = fs.readdirSync(DIR);
let total = 0, records = 0, over = 0;
const writersPerFile = new Map();
for (const f of files) {
  const p = DIR + '/' + f; const sz = fs.statSync(p).size; total += sz;
  if (sz > PER_FILE_CAP) over++;
  const ws = new Set();
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!l) continue; records++;
    try { ws.add(JSON.parse(l).p); } catch { records--; }
  }
  writersPerFile.set(f, ws.size);
}
const multiWriter = [...writersPerFile.values()].filter(n => n > 1).length;
console.log(`processes: ${N_PROC}   records written: ${N_PROC*N_LINES}`);
console.log(`files created : ${files.length}`);
console.log(`records readable: ${records}   LOST: ${N_PROC*N_LINES - records}`);
console.log(`files over the per-file cap: ${over}`);
console.log(`files with MORE THAN ONE writer: ${multiWriter}`);
console.log(`total bytes: ${(total/1024/1024).toFixed(2)} MiB`);
console.log(`\nVERDICT: ${records === N_PROC*N_LINES && over === 0 && multiWriter === 0 ? 'correct — no loss, cap respected, single writer per file' : 'BROKEN'}`);
fs.rmSync(DIR, { recursive: true, force: true });
