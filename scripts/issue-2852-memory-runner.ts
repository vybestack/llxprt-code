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
import { readFileSync } from 'node:fs';
import {
  evaluatePostGcPlateau,
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
const turns = Number.parseInt(process.argv[4] ?? '4', 10);
if (!Number.isInteger(turns) || turns < 3) {
  throw new Error('Turns must be an integer of at least 3 to judge a plateau');
}
/**
 * Post-GC heap growth tolerated across equivalent turns once the first
 * warm-up turn has settled caches that legitimately persist.
 */
const PLATEAU_TOLERANCE = 0.1;
/** Time the target is given to exit on its own before SIGKILL. */
const SHUTDOWN_GRACE_MS = 5_000;
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
    checkpoints.push(
      captureOsCheckpoint(target.pid, checkpoints.length, name, artifactDir),
    );
    response.writeHead(204).end();
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});

await new Promise<void>((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(0, '127.0.0.1', () => {
    server.removeListener('error', rejectListen);
    resolveListen();
  });
});
const address = server.address();
if (address === null || typeof address === 'string') {
  throw new Error('Memory benchmark server did not expose a TCP port');
}

const targetOutput = resolve(artifactDir, 'target.jsonl');
const child = spawn(
  process.execPath,
  ['scripts/issue-2852-memory-target.ts', targetOutput, mode, String(turns)],
  {
    cwd: resolve('.'),
    env: { ...process.env, LLXPRT_MEMORY_PORT: String(address.port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
if (child.pid === undefined) {
  throw new Error('Bun did not return a target PID');
}

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
/**
 * Terminates the target before exiting. Exiting immediately after SIGTERM
 * would reparent a still-running target to PID 1 and leave it alive.
 */
async function gracefulShutdown(code: number): Promise<void> {
  cleanup();
  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([
      new Promise<void>((resolveExit) =>
        child.once('exit', () => resolveExit()),
      ),
      new Promise<void>((resolveTimeout) =>
        setTimeout(() => {
          child.kill('SIGKILL');
          resolveTimeout();
        }, SHUTDOWN_GRACE_MS),
      ),
    ]);
  }
  process.exit(code);
}
process.once('SIGINT', () => void gracefulShutdown(130));
process.once('SIGTERM', () => void gracefulShutdown(143));

let exitCode: number | null;
try {
  target.pid = child.pid;
  validateExactPid(
    target.pid,
    run('/bin/ps', ['-p', String(target.pid), '-o', 'pid=,command=']),
  );
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
const plateau = evaluatePostGcPlateau(
  readPostGcHeapBytes(targetOutput),
  PLATEAU_TOLERANCE,
);
writeFileSync(resolve(artifactDir, 'target.stdout'), Buffer.concat(stdout));
writeFileSync(resolve(artifactDir, 'target.stderr'), Buffer.concat(stderr));
writeFileSync(
  resolve(artifactDir, 'os-checkpoints.json'),
  `${JSON.stringify({ targetPid: target.pid, mode, turns, plateau, checkpoints }, null, 2)}\n`,
);
process.stdout.write(`${artifactDir}\n`);
if (!plateau.withinTolerance) {
  throw new Error(
    `Post-GC JSC heap grew ${(plateau.growthRatio * 100).toFixed(1)}% across equivalent turns`,
  );
}

interface CheckpointRecord {
  readonly name?: string;
  readonly jsc?: { readonly heapSize?: number };
}

/** Post-GC JSC heap size for each turn, oldest first. */
function readPostGcHeapBytes(path: string): number[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as CheckpointRecord)
    .filter((record) => record.name?.endsWith('-post-gc') === true)
    .map((record) => {
      const heapSize = record.jsc?.heapSize;
      if (typeof heapSize !== 'number' || !Number.isFinite(heapSize)) {
        throw new Error(
          `Checkpoint ${record.name} has no usable JSC heap size`,
        );
      }
      return heapSize;
    });
}

function captureOsCheckpoint(
  pid: number,
  index: number,
  name: string,
  outputDir: string,
): OsCheckpoint {
  const filePrefix = `checkpoint-${index}`;
  const ps = run('/bin/ps', ['-p', String(pid), '-o', 'pid=,rss=,command=']);
  const vmmap = run('/usr/bin/vmmap', ['-summary', String(pid)]);
  const footprint = run('/usr/bin/footprint', [
    '-f',
    'bytes',
    '--pid',
    String(pid),
  ]);
  writeFileSync(resolve(outputDir, `${filePrefix}.ps.txt`), ps);
  writeFileSync(resolve(outputDir, `${filePrefix}.vmmap.txt`), vmmap);
  writeFileSync(resolve(outputDir, `${filePrefix}.footprint.txt`), footprint);
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
