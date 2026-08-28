/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Production memory-tool workflow integration test (issue #3230). Runs the
 * REAL production path end-to-end in child processes on any platform
 * (this file is the Windows 11 CI coverage, and also runs locally):
 *
 *   1. probe startup via the launcher's exact `--preload` mechanism
 *      (probe-preload.ts — the preload entry that installs the probe)
 *   2. request queue -> probe consume (real poller, real filesystem channel)
 *   3. guarded snapshot refusal while unarmed
 *   4. probe lease lifecycle: active while running, released on normal exit
 *   5. request CLI rejects dead runs (no live lease) and accepts live ones
 *   6. report and heap-analyzer CLI entry points
 *
 * Everything is platform-neutral (path.join, child_process.spawn with the
 * current Bun executable, plain file I/O). No signals, ports, pgrep, shells,
 * or PowerShell are required for any step; the children exit on their own
 * timers (or are terminated after assertions complete, with close awaited so
 * cleanup never masks a failure). Artifacts live in a temp directory outside
 * the repository and are removed afterwards.
 */

import { describe, expect, it } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLease } from '../../memory/lease.ts';
import { REQUEST_DIR_NAME, queueRequest } from '../../memory/request.ts';
import { parseSamples } from '../../memory/sample.ts';
import { spawnSyncWithFileCapture } from './sync-process.ts';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..', '..');
// The launcher preloads probe-preload.ts (the module with the install side
// effect); probe.ts itself only exports logic.
const probePath = join(repoRoot, 'scripts', 'memory', 'probe-preload.ts');
const requestCliPath = join(repoRoot, 'scripts', 'memory', 'request-cli.ts');

/** Polls until predicate holds or timeout; throws with context on timeout. */
async function waitFor(
  what: string,
  predicate: () => boolean,
  timeoutMs = 15_000,
  intervalMs = 200,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

interface ProbeChild {
  readonly runDir: string;
  /** Waits for the child to close (exit + stdio flushed). */
  readonly closed: Promise<void>;
  /** Best-effort post-assertion termination; resolves once closed. */
  readonly stop: () => Promise<void>;
}

/**
 * Starts the real probe in a child exactly the way the launcher does:
 * `bun --preload <probe-preload> <entry>` with LLXPRT_MEM_DIR set. The entry
 * is a short-lived script; `lifetimeMs` controls when it exits normally (the
 * probe's exit handler runs, releasing the lease).
 */
function startProbeChild(
  runDir: string,
  lifetimeMs: number,
  envExtra: Record<string, string> = {},
): ProbeChild {
  const env = {
    ...process.env,
    LLXPRT_MEM_DIR: runDir,
    LLXPRT_MEM_INTERVAL_MS: '60000',
    ...envExtra,
  };
  const child: ChildProcess = spawn(
    process.execPath,
    [
      '--preload',
      probePath,
      '-e',
      `setTimeout(() => process.exit(0), ${lifetimeMs})`,
    ],
    { env, cwd: repoRoot, stdio: 'ignore' },
  );
  const closed = new Promise<void>((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', () => resolvePromise());
  });
  return {
    runDir,
    closed,
    stop: () => {
      child.kill();
      return closed;
    },
  };
}

function runCli(
  args: readonly string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const result = spawnSyncWithFileCapture(
    join(repoRoot, 'tmp'),
    process.execPath,
    args,
    { cwd: repoRoot },
  );
  return Promise.resolve({
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
}

describe('memory-tool workflow — probe startup via launcher preload path', () => {
  it('arms the probe and records a startup sample', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memflow-startup-'));
    const probe = startProbeChild(runDir, 60_000);
    try {
      const samplesPath = join(runDir, 'samples.jsonl');
      await waitFor('startup sample', () => existsSync(samplesPath));
      const samples = parseSamples(readFileSync(samplesPath, 'utf8'));
      expect(samples.some((s) => s.tag === 'startup')).toBe(true);
      // The armed log line names the acquired lease: ownership is recorded.
      const logPath = join(runDir, 'probe.log');
      await waitFor('armed log line', () => existsSync(logPath));
      const log = readFileSync(logPath, 'utf8');
      expect(log).toContain('lease=');
    } finally {
      // Await close so cleanup cannot race a still-running child.
      await probe.stop();
      rmSync(runDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('leaves snapshots unarmed unless explicitly armed', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memflow-unarmed-'));
    const probe = startProbeChild(runDir, 60_000, {
      LLXPRT_MEM_SNAPSHOT: '0', // what the launcher writes when unarmed
    });
    try {
      const logPath = join(runDir, 'probe.log');
      await waitFor('armed log line', () => existsSync(logPath));
      const log = readFileSync(logPath, 'utf8');
      expect(log).toContain('snapshots=off');
    } finally {
      await probe.stop();
      rmSync(runDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('falls back with a warning on an invalid env interval instead of dying', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memflow-badenv-'));
    const probe = startProbeChild(runDir, 60_000, {
      LLXPRT_MEM_INTERVAL_MS: 'banana', // invalid: positive integer required
    });
    try {
      const logPath = join(runDir, 'probe.log');
      await waitFor('warning log line', () => existsSync(logPath));
      const log = readFileSync(logPath, 'utf8');
      expect(log).toContain('WARNING LLXPRT_MEM_INTERVAL_MS');
      // The probe is still alive and sampling with the default interval.
      await waitFor('startup sample', () =>
        existsSync(join(runDir, 'samples.jsonl')),
      );
    } finally {
      await probe.stop();
      rmSync(runDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('memory-tool workflow — probe lease lifecycle', () => {
  it('holds an active lease while running and releases it on normal exit', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memflow-lease-'));
    const probe = startProbeChild(runDir, 3_000);
    try {
      const leaseFile = join(runDir, 'probe.lease');
      await waitFor('lease file', () => existsSync(leaseFile));
      // The real production classifier sees the live heartbeat.
      expect(checkLease(runDir).status).toBe('active');
      // Normal exit (no signal): the exit handler releases the lease.
      await probe.closed;
      await waitFor('lease released', () => !existsSync(leaseFile));
      expect(checkLease(runDir).status).toBe('missing');
    } finally {
      await probe.stop();
      rmSync(runDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('fails before application startup when another probe owns the run directory', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memflow-lease-refused-'));
    const markerPath = join(runDir, 'application-started');
    const probe = startProbeChild(runDir, 60_000);
    try {
      await waitFor(
        'active lease',
        () => checkLease(runDir).status === 'active',
      );

      const contender = spawn(
        process.execPath,
        [
          '--preload',
          probePath,
          '-e',
          `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'started')`,
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            LLXPRT_MEM_DIR: runDir,
            LLXPRT_MEM_INTERVAL_MS: '60000',
          },
          stdio: 'ignore',
        },
      );
      const code = await new Promise<number | null>(
        (resolvePromise, reject) => {
          contender.once('error', reject);
          contender.once('close', resolvePromise);
        },
      );

      expect(code).not.toBe(0);
      expect(readFileSync(join(runDir, 'probe.log'), 'utf8')).toContain(
        'REFUSED startup: run directory lease not acquired',
      );
      expect(existsSync(markerPath)).toBe(false);
    } finally {
      await probe.stop();
      rmSync(runDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('memory-tool workflow — request queue and consume', () => {
  it('consumes a queued sample request and records it with the request id', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memflow-consume-'));
    const probe = startProbeChild(runDir, 60_000);
    try {
      const samplesPath = join(runDir, 'samples.jsonl');
      await waitFor('startup sample', () => existsSync(samplesPath));

      const queued = queueRequest('sample', {
        requestDir: join(runDir, REQUEST_DIR_NAME),
        now: () => Date.now(),
        random: () => 0.5,
        pid: process.pid,
      });

      await waitFor(
        'manual sample with request id',
        () =>
          existsSync(samplesPath) &&
          parseSamples(readFileSync(samplesPath, 'utf8')).some(
            (s) => s.tag === 'manual' && s.requestId === queued.request.id,
          ),
      );
      // The request file is fully removed after processing (claimed, done,
      // cleaned up) — exactly once.
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      await waitFor('pending drained', () => {
        const pending = readdirSync(requestDir).filter(
          (name) => name.endsWith('.json') || name.endsWith('.claimed'),
        );
        return pending.length === 0;
      });
    } finally {
      await probe.stop();
      rmSync(runDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('accepts a request CLI call against a live run and rejects a dead one', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memflow-reqcli-'));
    const probe = startProbeChild(runDir, 8_000);
    try {
      await waitFor('startup sample', () =>
        existsSync(join(runDir, 'samples.jsonl')),
      );
      // While the probe is alive (lease active) the CLI queues successfully.
      const alive = await runCli([requestCliPath, '--dir', runDir]);
      expect(alive.code).toBe(0);
      expect(alive.stdout).toContain('Queued sample request');

      // After a normal exit the lease is gone; queueing to the dead run must
      // be refused with an actionable error, not silently enqueued.
      await probe.closed;
      const dead = await runCli([requestCliPath, '--dir', runDir]);
      expect(dead.code).not.toBe(0);
      expect(dead.stderr.toLowerCase()).toContain('not active');
    } finally {
      await probe.stop();
      rmSync(runDir, { recursive: true, force: true });
    }
  }, 45_000);

  it('refuses a snapshot request while unarmed and writes no snapshot', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memflow-refuse-'));
    const probe = startProbeChild(runDir, 60_000, {
      LLXPRT_MEM_SNAPSHOT: '0',
    });
    try {
      await waitFor('startup sample', () =>
        existsSync(join(runDir, 'samples.jsonl')),
      );

      const queued = queueRequest('snapshot', {
        requestDir: join(runDir, REQUEST_DIR_NAME),
        now: () => Date.now(),
        random: () => 0.5,
        pid: process.pid,
      });

      const logPath = join(runDir, 'probe.log');
      await waitFor(
        'refusal log',
        () =>
          existsSync(logPath) &&
          readFileSync(logPath, 'utf8').includes(
            `REFUSED snapshot id=${queued.request.id}`,
          ),
      );
      // No snapshot artifact of any kind was produced.
      expect(existsSync(join(runDir, 'snapshots'))).toBe(false);
    } finally {
      await probe.stop();
      rmSync(runDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('memory-tool workflow — report and analyzer entry points', () => {
  it('renders a report from a real recorded samples file', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memflow-report-'));
    try {
      const samplesPath = join(runDir, 'samples.jsonl');
      writeFileSync(
        samplesPath,
        [
          JSON.stringify({
            t: '2026-08-14T10:00:00.000Z',
            tag: 'startup',
            pid: 1,
            rss: 1024,
            heapSize: 512,
            heapCapacity: 512,
            extraMemorySize: 0,
            objectCount: 10,
            protectedObjectCount: 0,
            types: [['Object', 5]],
          }),
          JSON.stringify({
            t: '2026-08-14T10:01:00.000Z',
            tag: 'exit',
            pid: 1,
            rss: 2048,
            heapSize: 1024,
            heapCapacity: 1024,
            extraMemorySize: 0,
            objectCount: 20,
            protectedObjectCount: 0,
            types: [['Object', 12]],
          }),
        ].join('\n') + '\n',
      );
      const result = await runCli([
        join(repoRoot, 'scripts', 'memory', 'report.ts'),
        samplesPath,
      ]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('2 samples over');
      expect(result.stdout).toContain('Object');
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects report CLI usage errors with exit 2 and usage, runtime errors with exit 1', async () => {
    const usageResult = await runCli([
      join(repoRoot, 'scripts', 'memory', 'report.ts'),
      '--nonsense',
    ]);
    expect(usageResult.code).toBe(2);
    expect(usageResult.stderr).toContain('Usage');

    const missingResult = await runCli([
      join(repoRoot, 'scripts', 'memory', 'report.ts'),
      join(tmpdir(), 'memflow-nonexistent-samples.jsonl'),
    ]);
    expect(missingResult.code).toBe(1);
    expect(missingResult.stderr.length).toBeGreaterThan(0);
  }, 30_000);

  it('analyzes a tiny synthetic snapshot from the CLI entry point', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memflow-analyze-'));
    try {
      // Minimal V8-format snapshot (see heapanalyze.test.ts for the format).
      const snapshotPath = join(runDir, 'tiny.heapsnapshot');
      const nodeFields = ['type', 'name', 'id', 'self_size', 'edge_count'];
      const edgeFields = ['type', 'name_or_index', 'to_node'];
      writeFileSync(
        snapshotPath,
        JSON.stringify({
          snapshot: {
            node_count: 2,
            edge_count: 1,
            meta: {
              node_fields: nodeFields,
              node_types: [
                ['object', 'string'],
                'string',
                'number',
                'number',
                'number',
              ],
              edge_fields: edgeFields,
              edge_types: [['property'], 'string', 'number'],
            },
          },
          nodes: [0, 0, 1, 0, 1, 1, 1, 2, 2048, 0],
          edges: [0, 0, 5],
          strings: ['root', 'payload'],
        }),
      );
      const result = await runCli([
        join(repoRoot, 'scripts', 'memory', 'heapanalyze.ts'),
        snapshotPath,
        '--min-mb',
        '0.001',
      ]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('payload');
      expect(result.stdout.toLowerCase()).toContain('not retained size');
      // Arg errors from the CLI print usage and exit 2.
      const badArgs = await runCli([
        join(repoRoot, 'scripts', 'memory', 'heapanalyze.ts'),
        '--definitely-not-a-flag',
      ]);
      expect(badArgs.code).toBe(2);
      expect(badArgs.stderr).toContain('Usage');
    } finally {
      // Heap-snapshot-shaped artifacts are never retained, even tiny
      // synthetic ones: the temp directory is removed.
      rmSync(runDir, { recursive: true, force: true });
    }
  }, 30_000);
});
