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
  evaluateMultiMetricPlateau,
  evaluatePostGcPlateau,
  parseFootprintBytes,
  parsePostGcRecords,
  parsePsRssBytes,
  parseVmmapSummary,
  validateCheckpointOrder,
  validateExactPid,
  type CheckpointRecord,
  type PostGcMetrics,
} from './issue-2852-memory-benchmark.js';

const artifactDir = resolve(
  process.argv[2] ?? `/tmp/llxprt-issue-2852-${Date.now()}`,
);
const mode = process.argv[3] ?? 'text';
if (mode !== 'text' && mode !== 'media' && mode !== 'reasoning') {
  throw new Error('Mode must be text, media, or reasoning');
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
const osByCheckpointName = new Map(checkpoints.map((cp) => [cp.name, cp]));
writeFileSync(resolve(artifactDir, 'target.stdout'), Buffer.concat(stdout));
writeFileSync(resolve(artifactDir, 'target.stderr'), Buffer.concat(stderr));

// `reasoning` gates every retention metric because bounding reasoning blocks
// must show up in external and dirty WebKit Malloc, not just the JSC heap.
const plateau =
  mode === 'reasoning'
    ? evaluateMultiMetricPlateau(
        readPostGcMetrics(targetOutput, osByCheckpointName),
        PLATEAU_TOLERANCE,
      )
    : evaluatePostGcPlateau(
        readPostGcHeapBytes(targetOutput),
        PLATEAU_TOLERANCE,
      );

writeFileSync(
  resolve(artifactDir, 'os-checkpoints.json'),
  `${JSON.stringify({ targetPid: target.pid, mode, turns, plateau, checkpoints }, null, 2)}\n`,
);
process.stdout.write(`${artifactDir}\n`);

if ('overallWithinTolerance' in plateau) {
  if (!plateau.overallWithinTolerance) {
    const failed = plateau.metrics
      .filter((metric) => !metric.withinTolerance)
      .map(
        (metric) =>
          `${metric.name} grew ${(metric.growthRatio * 100).toFixed(1)}%`,
      )
      .join(', ');
    throw new Error(`Post-GC plateau failed: ${failed}`);
  }
} else if (!plateau.withinTolerance) {
  throw new Error(
    `Post-GC JSC heap grew ${(plateau.growthRatio * 100).toFixed(1)}% across equivalent turns`,
  );
}

/** Post-GC checkpoint records from the target's JSONL, oldest first. */
function readPostGcRecords(path: string): CheckpointRecord[] {
  return parsePostGcRecords(path, readFileSync(path, 'utf8'));
}

/** Post-GC JSC heap size for each turn, oldest first. */
function readPostGcHeapBytes(path: string): number[] {
  return readPostGcRecords(path).map((record) =>
    requireMetric(record.jsc?.heapSize, 'jscHeap', record.name),
  );
}

/**
 * Post-GC combined metrics for the multi-metric plateau verdict: JSC heap and
 * process.memoryUsage().external from the target checkpoint, plus dirty WebKit
 * Malloc from the matching OS (vmmap) checkpoint.
 */
function readPostGcMetrics(
  path: string,
  osCheckpoints: ReadonlyMap<string, OsCheckpoint>,
): PostGcMetrics[] {
  return readPostGcRecords(path).map((record) => {
    const osCheckpoint = osCheckpoints.get(record.name ?? '');
    return {
      jscHeapBytes: requireMetric(record.jsc?.heapSize, 'jscHeap', record.name),
      externalBytes: requireMetric(
        record.processMemory?.external,
        'external',
        record.name,
      ),
      webkitMallocDirtyBytes: requireMetric(
        osCheckpoint?.vmmap.webkitMallocDirtyBytes,
        'webkitMallocDirty',
        record.name,
      ),
    };
  });
}

/**
 * Fails fast, naming the metric and checkpoint, so a missing OS checkpoint or a
 * malformed target record is diagnosable without inspecting the raw artifacts.
 */
function requireMetric(
  value: unknown,
  metric: string,
  checkpointName: string | undefined,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `Checkpoint ${checkpointName ?? '<unnamed>'} is missing required metric ${metric}`,
    );
  }
  return value;
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
