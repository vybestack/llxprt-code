/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function diagnoseInstalledStdin(
  bin: string,
  directory: string,
  env: NodeJS.ProcessEnv,
  request: string,
): Promise<void> {
  const worker = join(directory, 'stdin-worker.ts');
  writeFileSync(worker, `import {spawnSync,spawn} from 'node:child_process';
const [mode, bin, request] = process.argv.slice(2);
const args = ['/d','/s','/c', '\"\"'+bin+'\" \"'+request+'\"\"'];
if (mode === 'sync') { const r = spawnSync('cmd.exe',args,{input:'stdin payload\\n',encoding:'utf8',timeout:4000,windowsVerbatimArguments:true}); console.log(JSON.stringify(r)); }
else { const c=spawn('cmd.exe',args,{stdio:['pipe','pipe','pipe'],windowsVerbatimArguments:true}); c.stdout.pipe(process.stdout); c.stderr.pipe(process.stderr); c.stdin.end('stdin payload\\n'); c.on('exit',code=>console.log('exit='+code)); }
`);
  for (const runtime of ['node', process.execPath]) {
    for (const mode of ['sync', 'async']) {
      const child = spawn(runtime, [worker, mode, `${bin}.cmd`, request], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      const timer = setTimeout(() => {
        if (child.pid) spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f']);
      }, 8000);
      await new Promise<void>((done, reject) => {
        child.on('error', reject);
        child.on('close', () => done());
      });
      clearTimeout(timer);
      console.log(JSON.stringify({runtime, mode, stdout, stderr}));
    }
  }
  console.log('stdin events: ' + readFileSync(join(directory, 'stdin-events.log'), 'utf8'));
}
