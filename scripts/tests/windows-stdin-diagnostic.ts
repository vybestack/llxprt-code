/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'windows-stdin-'));
const probe = resolve('scripts/tests/issue-2603-windows-probe.ts');
const events = join(directory, 'events.log');
const instrumented = join(directory, 'probe.ts');
writeFileSync(
  instrumented,
  readFileSync(probe, 'utf8')
    .replace("import { readFileSync }", "import { appendFileSync, readFileSync }")
    .replace("return readFileSync(0, 'utf8');", `appendFileSync(${JSON.stringify(events)}, 'before stdin\\n'); const input = readFileSync(0, 'utf8'); appendFileSync(${JSON.stringify(events)}, 'after stdin\\n'); return input;`),
);
const supervisor = join(directory, 'supervisor.mjs');
writeFileSync(supervisor, `import {spawn} from 'node:child_process'; const child = spawn(process.argv[2], process.argv.slice(3), {stdio:'inherit'}); child.on('error', error => {console.error(error); process.exit(1)}); child.on('exit', code => process.exit(code));`);
const launcher = join(directory, 'launcher.cmd');
writeFileSync(launcher, `@echo off\r\nnode "${supervisor}" "${process.execPath}" "${instrumented}" %*\r\nexit /b %errorlevel%\r\n`);
const request = 'LLXPRT_PROBE_B64=' + Buffer.from(JSON.stringify({stdin:true,exit:17})).toString('base64url');
const worker = join(directory, 'worker.ts');
writeFileSync(worker, `import {spawnSync,spawn} from 'node:child_process';
const [mode, executable, ...args] = process.argv.slice(2);
if (mode === 'sync') { const r = spawnSync(executable,args,{input:'stdin payload\\n',encoding:'utf8',timeout:4000,windowsVerbatimArguments:executable==='cmd.exe'}); console.log(JSON.stringify(r)); }
else { const c=spawn(executable,args,{stdio:['pipe','pipe','pipe'],windowsVerbatimArguments:executable==='cmd.exe'}); c.stdout.pipe(process.stdout); c.stderr.pipe(process.stderr); c.stdin.end('stdin payload\\n'); c.on('exit',code=>console.log('exit='+code)); }
`);
for (const runtime of ['node', process.execPath]) {
  for (const mode of ['sync', 'async']) {
    for (const kind of ['direct', 'cmd']) {
      writeFileSync(events, '');
      const command = kind === 'direct' ? process.execPath : 'cmd.exe';
      const args = kind === 'direct' ? [instrumented, request] : ['/d','/s','/c', `""${launcher}" "${request}""`];
      const child = spawn(runtime, [worker, mode, command, ...args], {stdio:['ignore','pipe','pipe']});
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => {stdout += String(chunk);});
      child.stderr.on('data', chunk => {stderr += String(chunk);});
      const timer = setTimeout(() => {
        if (child.pid) spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f']);
      }, 8000);
      await new Promise<void>((done, reject) => {child.on('error', reject); child.on('close', () => done());});
      clearTimeout(timer);
      console.log(JSON.stringify({runtime,mode,kind,stdout,stderr,events:readFileSync(events,'utf8')}));
    }
  }
}
