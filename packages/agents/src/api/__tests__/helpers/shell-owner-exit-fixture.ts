/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseline = process.listenerCount('beforeExit');
const setupKeepAlive = setInterval(() => {}, 1000);
const agents: Agent[] = [];
for (let i = 0; i < 4; i++) {
  agents.push(
    await createAgent({
      provider: 'openai',
      model: 'test-model',
      auth: { apiKey: 'test-key', baseUrl: 'http://127.0.0.1:9/v1' },
      workingDir: process.cwd(),
      folderTrust: true,
      telemetry: { enabled: false },
      recording: { enabled: false },
      skillsSupport: false,
    }),
  );
}
const afterConstruction = process.listenerCount('beforeExit');

async function launch(
  index: number,
): Promise<{ id: string; pgid: number; log: string }> {
  const agent = agents[index];
  const shell = agent.tools.get('run_shell_command');
  if (!shell) throw new Error('Missing public shell tool');
  const marker = join(tmpdir(), `owner-${index}.pid`);
  const script = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid));setTimeout(()=>{},120000)`;
  const quote = (value: string): string =>
    `'${value.replaceAll("'", "'\\''")}'`;
  const command = `exec ${quote(process.execPath)} -e ${quote(script)}`;
  await shell.buildAndExecute(
    { command, is_background: true },
    new AbortController().signal,
  );
  const job = agent.tasks
    .list()
    .find((item) => item.kind === 'shell' && item.command === command);
  if (!job) throw new Error('Missing launched public shell job');
  for (let i = 0; i < 200 && !existsSync(marker); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!existsSync(marker))
    throw new Error(
      `Missing child PID marker: ${command} ${JSON.stringify(agent.tasks.list())} ${JSON.stringify(agent.tasks.get(job.id))}`,
    );
  const pid = Number(readFileSync(marker, 'utf8'));
  const group = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
    encoding: 'utf8',
  });
  const pgid = Number(group.stdout.trim());
  if (group.status !== 0 || !Number.isSafeInteger(pgid) || pgid <= 1)
    throw new Error(`Missing real group: ${group.stderr}`);
  const log = readdirSync(tmpdir())
    .filter((name) => name.startsWith('shell-jobs-'))
    .map((name) => join(tmpdir(), name, `${job.id}.log`))
    .find((path) => existsSync(path));
  if (!log) throw new Error('Missing public shell job log');
  return { id: job.id, pgid, log };
}

const a = await launch(0);
const b = await launch(1);
const afterTwoLaunches = process.listenerCount('beforeExit');
const d = await launch(3);
const afterThreeLaunches = process.listenerCount('beforeExit');
await agents[3].dispose();
const afterExplicitDispose = process.listenerCount('beforeExit');
const originalKill = process.kill;
process.kill = (pid, signal): true => {
  if (pid === -a.pgid && signal === 0) {
    throw Object.assign(new Error('ownership observation denied'), {
      code: 'EPERM',
    });
  }
  if (pid === -a.pgid && signal !== 0) {
    throw new Error('Parent must not send a numeric group signal');
  }
  return originalKill.call(process, pid, signal);
};
let failedDisposal: string | undefined;
let afterFailedDispose: number | undefined;
if (process.argv[2] === 'explicit-failure') {
  try {
    await agents[0].dispose();
    throw new Error('Expected public Agent disposal failure');
  } catch (error) {
    failedDisposal = String(error);
  }
  afterFailedDispose = process.listenerCount('beforeExit');
}
if (process.argv[2] === 'preset') process.exitCode = 7;
process.once('exit', () => {
  process.stderr.write(
    JSON.stringify({
      event: 'exit',
      listenerCount: process.listenerCount('beforeExit'),
      exitCode: process.exitCode,
    }) + '\n',
  );
});
process.stdout.write(
  JSON.stringify({
    event: 'ready',
    baseline,
    afterConstruction,
    afterTwoLaunches,
    afterThreeLaunches,
    afterExplicitDispose,
    afterFailedDispose,
    failedDisposal,
    a,
    b,
    d,
  }) + '\n',
);
process.emit('beforeExit', 0);
clearInterval(setupKeepAlive);
