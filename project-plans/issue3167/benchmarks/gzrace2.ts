#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Distinguish shared vs private tmp when writers produce DIFFERENT bytes
// (realistic: different llxprt versions / zlib levels running concurrently).
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const DIR = '/tmp/gzrace2';
const SRC = DIR + '/perf-20260807-9999-000.jsonl';
const GZ = SRC + '.gz';
const N = 8;
const self = fileURLToPath(import.meta.url);

function makeSource(): string {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  let s = '';
  for (let i = 0; i < 4000; i++) s += JSON.stringify({ i, pad: 'y'.repeat(600), ts: 1 }) + '\n';
  fs.writeFileSync(SRC, s);
  return crypto.createHash('sha256').update(s).digest('hex');
}

if (process.argv[2] === 'child') {
  const mode = process.argv[3];
  const k = Number(process.argv[4]);
  const level = [1, 6, 9][k % 3]; // <-- mixed levels => different bytes
  const tmp = mode === 'shared' ? GZ + '.tmp' : `${GZ}.${process.pid}.tmp`;
  const errs: string[] = [];
  try {
    const raw = fs.readFileSync(SRC);
    const out = zlib.gzipSync(raw, { level });
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, GZ);
    try {
      fs.unlinkSync(SRC);
    } catch {}
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    errs.push(String(err.code ?? err.message).slice(0, 40));
  }
  if (errs.length)
    process.stdout.write(`    [${mode}] worker ${k}: ${errs.join(',')}\n`);
  process.exit(0);
}

for (const mode of ['shared', 'private']) {
  const sha = makeSource();
  console.log(
    `--- ${N} concurrent compressors, MIXED gzip levels, ${mode.toUpperCase()} tmp ---`,
  );
  await Promise.all(
    Array.from(
      { length: N },
      (_, k) =>
        new Promise<void>((r) => {
          spawn(process.execPath, [self, 'child', mode, String(k)], {
            stdio: ['ignore', 'inherit', 'ignore'],
          }).on('exit', () => r());
        }),
    ),
  );
  let verdict: string;
  try {
    const dec = zlib.gunzipSync(fs.readFileSync(GZ));
    const ok = crypto.createHash('sha256').update(dec).digest('hex') === sha;
    verdict = ok
      ? 'VALID, matches source'
      : `CORRUPT (decoded ${dec.toString().split('\n').filter(Boolean).length} lines, sha mismatch)`;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    verdict = 'UNREADABLE: ' + String(err.message ?? e).slice(0, 70);
  }
  const leftover = fs.readdirSync(DIR).filter((f) => f.includes('.tmp'));
  console.log(`    archive: ${verdict}`);
  console.log(
    `    leftover tmp: ${leftover.length}   gz size: ${fs.existsSync(GZ) ? fs.statSync(GZ).size : '-'}\n`,
  );
}
fs.rmSync(DIR, { recursive: true, force: true });
