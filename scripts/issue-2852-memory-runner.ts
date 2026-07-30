/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import {
  parseFootprintBytes,
  parsePsRssBytes,
  parseVmmapSummary,
  validateCheckpointOrder,
  validateExactPid,
} from './issue-2852-memory-benchmark.js';

const artifactDir = resolve(
  process.argv[2] ?? `/tmp/llxprt-issue-2852-${Date.now()}`,
);
const mode = process.argv[3] ?? 'text';
if (mode !== 'text' && mode !== 'media') {
  throw new Error('Mode must be text or media');
}
mkdirSync(artifactDir, { recursive: true });

interface OsCheckpoint {
  readonly name: string;
  readonly rssBytes: number;
  readonly vmmap: ReturnType<typeof parseVmmapSummary>;
  readonly footprintBytes: number;
}

const checkpoints: OsCheckpoint[] = [];
const target: { pid?: number } = {};
const server = createServer((request, response) => {
  const name = request.url?.replace('/checkpoint/', '');
  if (
    request.method !== 'POST' ||
    name === undefined ||
    !/^[a-z0-9-]+$/i.test(name) ||
    target.pid === undefined
  ) {
    response.writeHead(400).end();
    return;
  }
  try {
    checkpoints.push(captureOsCheckpoint(target.pid, name, artifactDir));
    response.writeHead(204).end();
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});

await new Promise<void>((resolveListen) =>
  server.listen(0, '127.0.0.1', resolveListen),
);
const address = server.address();
if (address === null || typeof address === 'string') {
  throw new Error('Memory benchmark server did not expose a TCP port');
}

const targetOutput = resolve(artifactDir, 'target.jsonl');
const child = spawn(
  process.execPath,
  ['scripts/issue-2852-memory-target.ts', targetOutput, mode],
  {
    cwd: resolve('.'),
    env: { ...process.env, LLXPRT_MEMORY_PORT: String(address.port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
if (child.pid === undefined) {
  throw new Error('Bun did not return a target PID');
}
target.pid = child.pid;
validateExactPid(
  target.pid,
  run('/bin/ps', ['-p', String(target.pid), '-o', 'pid=,command=']),
);

const stdout: Buffer[] = [];
const stderr: Buffer[] = [];
child.stdout.on('data', (data: Buffer) => stdout.push(data));
child.stderr.on('data', (data: Buffer) => stderr.push(data));

const cleanup = (): void => {
  server.close();
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
  }
};
process.once('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.once('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

let exitCode: number | null;
try {
  exitCode = await new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });
} finally {
  cleanup();
}
if (exitCode !== 0) {
  throw new Error(
    `Memory target exited ${exitCode}: ${Buffer.concat(stderr).toString('utf8')}`,
  );
}

validateCheckpointOrder(checkpoints.map((checkpoint) => checkpoint.name));
writeFileSync(resolve(artifactDir, 'target.stdout'), Buffer.concat(stdout));
writeFileSync(resolve(artifactDir, 'target.stderr'), Buffer.concat(stderr));
writeFileSync(
  resolve(artifactDir, 'os-checkpoints.json'),
  `${JSON.stringify({ targetPid: target.pid, mode, checkpoints }, null, 2)}\n`,
);
process.stdout.write(`${artifactDir}\n`);

function captureOsCheckpoint(
  pid: number,
  name: string,
  outputDir: string,
): OsCheckpoint {
  const ps = run('/bin/ps', ['-p', String(pid), '-o', 'pid=,rss=,command=']);
  const vmmap = run('/usr/bin/vmmap', ['-summary', String(pid)]);
  const footprint = run('/usr/bin/footprint', [
    '-f',
    'bytes',
    '--pid',
    String(pid),
  ]);
  writeFileSync(resolve(outputDir, `${name}.ps.txt`), ps);
  writeFileSync(resolve(outputDir, `${name}.vmmap.txt`), vmmap);
  writeFileSync(resolve(outputDir, `${name}.footprint.txt`), footprint);
  return {
    name,
    rssBytes: parsePsRssBytes(ps, pid),
    vmmap: parseVmmapSummary(vmmap),
    footprintBytes: parseFootprintBytes(footprint),
  };
}

function run(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr}`);
  }
  return result.stdout;
}
