// Do concurrent O_APPEND writes from N processes tear or interleave? Empirical, APFS.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const FILE = '/tmp/append_race_test.jsonl';
const N_PROC = 8;
const N_LINES = 1500;
const self = fileURLToPath(import.meta.url);

if (process.argv[2] === 'child') {
  const id = Number(process.argv[3]);
  // ~688 byte records, same shape as the real perf record
  for (let i = 0; i < N_LINES; i++) {
    const rec = { w: id, i, pad: 'x'.repeat(600), ts: Date.now() };
    fs.appendFileSync(FILE, JSON.stringify(rec) + '\n');
  }
  process.exit(0);
}

try { fs.unlinkSync(FILE); } catch {}
const t0 = Date.now();
await Promise.all(Array.from({ length: N_PROC }, (_, k) => new Promise((res) => {
  const c = spawn(process.execPath, [self, 'child', String(k)], { stdio: 'ignore' });
  c.on('exit', res);
})));
const dt = Date.now() - t0;

const raw = fs.readFileSync(FILE, 'utf8');
const lines = raw.split('\n').filter((l) => l.length > 0);
let parsed = 0, torn = 0;
const perWriter = new Map();
for (const l of lines) {
  try {
    const o = JSON.parse(l);
    parsed++;
    perWriter.set(o.w, (perWriter.get(o.w) ?? 0) + 1);
  } catch { torn++; }
}
console.log(`processes: ${N_PROC}   lines each: ${N_LINES}   record size: ~${Buffer.byteLength(JSON.stringify({w:0,i:0,pad:'x'.repeat(600),ts:Date.now()}))+1} B`);
console.log(`elapsed: ${dt} ms   file size: ${(fs.statSync(FILE).size/1024/1024).toFixed(2)} MiB`);
console.log(`expected lines: ${N_PROC * N_LINES}`);
console.log(`actual lines  : ${lines.length}`);
console.log(`parsed OK     : ${parsed}`);
console.log(`TORN/corrupt  : ${torn}`);
console.log(`per-writer counts complete: ${[...perWriter.entries()].sort((a,b)=>a[0]-b[0]).map(([w,n])=>`${w}:${n}`).join(' ')}`);
console.log(`\nVERDICT: ${torn === 0 && lines.length === N_PROC*N_LINES ? 'NO tearing, NO loss — concurrent O_APPEND of small records is safe' : 'UNSAFE'}`);
try { fs.unlinkSync(FILE); } catch {}
