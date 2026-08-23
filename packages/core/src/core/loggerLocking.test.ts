/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from 'bun:test';
import type { LogEntry } from './logger.js';
import { Logger, MessageSenderType } from './logger.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { debugLogger } from '../utils/debugLogger.js';
import crypto from 'node:crypto';

const TMP_DIR_NAME = 'tmp';
const LOG_FILE_NAME = 'logs.json';
const LOCK_FILE_SUFFIX = '.lock';

// From this test file (packages/core/src/core) the repo root is three levels up.
const REPO_ROOT = path.resolve(import.meta.dir, '../../..');
// Generated child-process drivers live in the repo's gitignored tmp/ so bare
// imports of @vybestack/llxprt-code-settings resolve from node_modules.
const DRIVER_DIR = path.join(REPO_ROOT, 'tmp');

const ORIGINAL_CONFIG_HOME = process.env['LLXPRT_CONFIG_HOME'];
const ORIGINAL_LOG_HOME = process.env['LLXPRT_LOG_HOME'];
const TEST_CONFIG_HOME = path.join(
  os.tmpdir(),
  `llxprt-logger-lock-test-${process.pid}`,
);
process.env['LLXPRT_CONFIG_HOME'] = TEST_CONFIG_HOME;
process.env['LLXPRT_LOG_HOME'] = TEST_CONFIG_HOME;

const projectDir = process.cwd();
const hash = crypto.createHash('sha256').update(projectDir).digest('hex');
const TEST_LLXPRT_DIR = path.join(
  Storage.getGlobalLogDir(),
  TMP_DIR_NAME,
  hash,
);
const TEST_LOG_FILE_PATH = path.join(TEST_LLXPRT_DIR, LOG_FILE_NAME);
const TEST_LOCK_FILE_PATH = `${TEST_LOG_FILE_PATH}${LOCK_FILE_SUFFIX}`;

async function cleanupLogFiles() {
  try {
    await fs.rm(TEST_LLXPRT_DIR, { recursive: true, force: true });
  } catch {
    // Directory may not exist — cleanup is best-effort.
  }
}

async function readLogFile(): Promise<LogEntry[]> {
  try {
    const content = await fs.readFile(TEST_LOG_FILE_PATH, 'utf-8');
    const trimmed = content.trim();
    if (trimmed.length === 0) return [];
    const entries: LogEntry[] = [];
    for (const line of trimmed.split('\n').map((l) => l.trim())) {
      if (line.length === 0) continue;
      try {
        entries.push(JSON.parse(line) as LogEntry);
      } catch {
        // Skip unparseable lines — mirrors production resilient parsing.
      }
    }
    return entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Resolve to 'pending' when `promise` has not settled within `ms`, otherwise
 * to the promise's settlement tag. Used to prove a Logger operation is blocked on
 * an externally-held lock file rather than merely slow.
 */
async function settledWithin<T>(
  promise: Promise<T>,
  ms: number,
): Promise<boolean> {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return settled;
}

describe('Logger inter-process locking', () => {
  let logger: Logger;
  const testSessionId = 'lock-test-session';

  beforeEach(async () => {
    vi.resetAllMocks();
    await cleanupLogFiles();
    await fs.mkdir(TEST_LLXPRT_DIR, { recursive: true });
    logger = new Logger(testSessionId, new Storage(process.cwd()));
    await logger.initialize();
  });

  afterEach(async () => {
    await logger.close();
    await cleanupLogFiles();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    // Best-effort cleanup of any generated driver script.
    const driverPath = path.join(
      DRIVER_DIR,
      `logger-child-driver-${process.pid}.ts`,
    );
    await fs.rm(driverPath, { force: true }).catch(() => {});
    if (ORIGINAL_CONFIG_HOME !== undefined) {
      process.env['LLXPRT_CONFIG_HOME'] = ORIGINAL_CONFIG_HOME;
    } else {
      delete process.env['LLXPRT_CONFIG_HOME'];
    }
    if (ORIGINAL_LOG_HOME !== undefined) {
      process.env['LLXPRT_LOG_HOME'] = ORIGINAL_LOG_HOME;
    } else {
      delete process.env['LLXPRT_LOG_HOME'];
    }
  });

  it('REQ-LOCK-002: blocks appends while another process holds the lock, then completes once released', async () => {
    // Simulate an external lock holder with a fresh lock file (mtime = now).
    await fs.writeFile(
      TEST_LOCK_FILE_PATH,
      JSON.stringify({ pid: 999999, timestamp: Date.now() }),
      'utf-8',
    );

    const pending = logger.logMessage(
      MessageSenderType.USER,
      'blocked-message',
    );
    // With a fresh lock and the default 5s deadline the append must still be
    // waiting after 150ms of real backoff/polling.
    expect(await settledWithin(pending, 150)).toBe(false);

    await fs.rm(TEST_LOCK_FILE_PATH, { force: true });
    await pending;

    const onDisk = await readLogFile();
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0].message).toBe('blocked-message');
    expect(onDisk[0].messageId).toBe(0);
  });

  it('REQ-LOCK-001: initialize reads and computes messageId only while holding the lock', async () => {
    const seed: LogEntry = {
      sessionId: testSessionId,
      messageId: 4,
      timestamp: new Date('2026-01-01T10:00:00.000Z').toISOString(),
      type: MessageSenderType.USER,
      message: 'seeded',
    };
    await fs.writeFile(
      TEST_LOG_FILE_PATH,
      JSON.stringify(seed) + '\n',
      'utf-8',
    );

    // Hold the lock so the fresh logger's initialize must wait on acquisition.
    await fs.writeFile(
      TEST_LOCK_FILE_PATH,
      JSON.stringify({ pid: 999999, timestamp: Date.now() }),
      'utf-8',
    );

    const fresh = new Logger(testSessionId, new Storage(process.cwd()));
    const init = fresh.initialize();
    expect(await settledWithin(init, 150)).toBe(false);

    // While initialize is blocked, another writer (the lock holder) appends a
    // messageId-5 entry directly to the file.
    const holderAppend: LogEntry = {
      sessionId: testSessionId,
      messageId: 5,
      timestamp: new Date('2026-01-01T10:00:01.000Z').toISOString(),
      type: MessageSenderType.USER,
      message: 'holder-append',
    };
    await fs.appendFile(
      TEST_LOG_FILE_PATH,
      JSON.stringify(holderAppend) + '\n',
    );

    await fs.rm(TEST_LOCK_FILE_PATH, { force: true });
    await init;

    // The load happens under the lock, so it must observe BOTH direct entries:
    // max messageId is 5, next id is 6.
    expect(fresh['messageId']).toBe(6);
    expect(fresh['logs']).toHaveLength(2);
    expect(fresh['initialized']).toBe(true);
    await fresh.close();
  });

  it('REQ-LOCK-004: recovers a stale lock file past the staleness threshold', async () => {
    await logger.logMessage(MessageSenderType.USER, 'pre-stale');

    // A crashed holder left a lock file behind; backdate its mtime past the
    // 10s staleness threshold (mtime granularity on both APFS and ext4 is
    // sub-second, so 11s back is unambiguous).
    await fs.writeFile(
      TEST_LOCK_FILE_PATH,
      JSON.stringify({ pid: 999999, timestamp: Date.now() - 60_000 }),
      'utf-8',
    );
    const old = new Date(Date.now() - 11_000);
    await fs.utimes(TEST_LOCK_FILE_PATH, old, old);

    // No manual release — staleness recovery must break the deadlock.
    await logger.logMessage(MessageSenderType.USER, 'after-stale-recovery');

    const onDisk = await readLogFile();
    expect(onDisk).toHaveLength(2);
    expect(onDisk[1].message).toBe('after-stale-recovery');
  });

  it('REQ-LOCK-003: times out without throwing, without advancing messageId, without writing; initialize completes uninitialized', async () => {
    await fs.writeFile(
      TEST_LOCK_FILE_PATH,
      JSON.stringify({ pid: 999999, timestamp: Date.now() }),
      'utf-8',
    );
    process.env['LLXPRT_LOG_LOCK_TIMEOUT_MS'] = '250';
    try {
      const startMessageId = logger['messageId'];
      const debugSpy = vi
        .spyOn(debugLogger, 'debug')
        .mockImplementation(() => {});

      await logger.logMessage(MessageSenderType.USER, 'timeout-message');
      expect(logger['messageId']).toBe(startMessageId);
      expect(logger['logs']).toHaveLength(0);
      expect(await readLogFile()).toHaveLength(0);
      expect(debugSpy).toHaveBeenCalledWith(
        'Error appending to log file:',
        expect.any(Error),
      );
      debugSpy.mockRestore();

      const fresh = new Logger(testSessionId, new Storage(process.cwd()));
      await fresh.initialize();
      expect(fresh['initialized']).toBe(false);
      await fresh.close();
    } finally {
      delete process.env['LLXPRT_LOG_LOCK_TIMEOUT_MS'];
    }
  });

  it('REQ-LOCK-005: leaves no lock residue and same-process instances can interleave without deadlock', async () => {
    await logger.logMessage(MessageSenderType.USER, 'm0');
    await logger.logMessage(MessageSenderType.USER, 'm1');
    await logger.close();

    const l1 = new Logger(testSessionId, new Storage(process.cwd()));
    const l2 = new Logger(testSessionId, new Storage(process.cwd()));
    await l1.initialize();
    await l2.initialize();
    await Promise.all([
      l1.logMessage(MessageSenderType.USER, 'i1'),
      l2.logMessage(MessageSenderType.USER, 'i2'),
      l1.logMessage(MessageSenderType.USER, 'i3'),
      l2.logMessage(MessageSenderType.USER, 'i4'),
    ]);
    await l1.close();
    await l2.close();

    const files = await fs.readdir(TEST_LLXPRT_DIR);
    expect(files.filter((f) => f.endsWith(LOCK_FILE_SUFFIX))).toStrictEqual([]);
    const onDisk = await readLogFile();
    expect(onDisk).toHaveLength(6);
    // Both instances' writes must survive. The physical order across instances is
    // arbitrary (the lock grants them in whatever order they contend), so compare
    // the message set rather than exact ordering.
    expect(onDisk.map((e) => e.message).sort()).toStrictEqual([
      'i1',
      'i2',
      'i3',
      'i4',
      'm0',
      'm1',
    ]);
  });

  it('REQ-LOCK-006: legacy entries survive and all writers land on a valid JSONL file across child processes', async () => {
    const sessionId = 'e2e-cross-process-session';
    const legacyEntries: LogEntry[] = [
      {
        sessionId,
        messageId: 0,
        timestamp: new Date('2026-01-01T10:00:00.000Z').toISOString(),
        type: MessageSenderType.USER,
        message: 'legacy-0',
      },
      {
        sessionId,
        messageId: 1,
        timestamp: new Date('2026-01-01T10:00:01.000Z').toISOString(),
        type: MessageSenderType.USER,
        message: 'legacy-1',
      },
    ];
    await fs.writeFile(
      TEST_LOG_FILE_PATH,
      JSON.stringify(legacyEntries, null, 2),
      'utf-8',
    );

    const driverPath = path.join(
      DRIVER_DIR,
      `logger-child-driver-${process.pid}.ts`,
    );
    await fs.mkdir(DRIVER_DIR, { recursive: true });
    await fs.writeFile(driverPath, CHILD_DRIVER_SOURCE, 'utf-8');

    const parent = new Logger(sessionId, new Storage(process.cwd()));
    try {
      // Eagerly migrate the legacy array under the lock before children start, so
      // the parent's initialize and the children's all serialize on the same file.
      await parent.initialize();

      const childA = runChildDriver(driverPath, sessionId, 'A');
      const childB = runChildDriver(driverPath, sessionId, 'B');

      try {
        await parent.logMessage(MessageSenderType.USER, 'parent-0');
        await parent.logMessage(MessageSenderType.USER, 'parent-1');
      } finally {
        await Promise.all([childA, childB]);
      }
    } finally {
      await parent.close();
      await fs.rm(driverPath, { force: true }).catch(() => {});
    }

    const content = await fs.readFile(TEST_LOG_FILE_PATH, 'utf-8');
    const trimmed = content.trim();
    // Valid JSONL: the file must not be a legacy JSON array.
    expect(trimmed.startsWith('[')).toBe(false);
    expect(trimmed.startsWith('{')).toBe(true);

    const rawLines = trimmed.split('\n').filter((l) => l.length > 0);
    const onDisk = await readLogFile();
    // Nothing may be lost and every physical line must parse as a valid LogEntry:
    // 2 legacy + 3 (child A) + 3 (child B) + 2 (parent) = 10. readLogFile
    // skips unparseable lines, so equal counts prove all lines parsed.
    expect(onDisk).toHaveLength(10);
    expect(rawLines).toHaveLength(onDisk.length);

    // Legacy entries survive, in order, at the head of the file.
    expect(onDisk.slice(0, 2).map((e) => e.message)).toStrictEqual([
      'legacy-0',
      'legacy-1',
    ]);
    const newMessages = onDisk.map((e) => e.message);
    for (const m of [
      'A-0',
      'A-1',
      'A-2',
      'B-0',
      'B-1',
      'B-2',
      'parent-0',
      'parent-1',
    ]) {
      expect(newMessages).toContain(m);
    }
    for (const m of ['A-0', 'A-1', 'A-2', 'B-0', 'B-1', 'B-2']) {
      expect(onDisk.filter((e) => e.message === m)).toHaveLength(1);
    }
  });
});

/**
 * Driver source for child bun processes. Imports Logger directly by absolute path (bun
 * runs TS natively) and resolves the settings package as a bare specifier from the
 * repo-root node_modules. The session id and a per-child tag come from the
 * environment so the parent can map each message back to its writer.
 */
const CHILD_DRIVER_SOURCE = `
import { Logger, MessageSenderType } from ${JSON.stringify(pathForDriver())};
import { Storage } from '@vybestack/llxprt-code-settings';

async function main(): Promise<void> {
  const sessionId = process.env['LLXPRT_LOCK_E2E_SESSION'] ?? 'e2e-session';
  const tag = process.env['LLXPRT_LOCK_E2E_TAG'] ?? 'child';
  const logger = new Logger(sessionId, new Storage(process.cwd()));
  await logger.initialize();
  for (let i = 0; i < 3; i++) {
    await logger.logMessage(MessageSenderType.USER, tag + '-' + i);
  }
  await logger.close();
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
`;

function pathForDriver(): string {
  return path.resolve(import.meta.dir, 'logger.ts');
}

/**
 * Spawn one child bun process running the driver, awaiting its exit with a bounded
 * timeout so a hang can never wedge the suite. Rejects (after killing the child)
 * if the child fails to exit in time or reports a non-zero exit code.
 */
async function runChildDriver(
  driverPath: string,
  sessionId: string,
  tag: string,
): Promise<number> {
  const proc = Bun.spawn({
    cmd: [process.execPath, driverPath],
    // cwd MUST match the parent so Storage.getProjectTempDir() hashes agree.
    cwd: process.cwd(),
    env: {
      ...process.env,
      LLXPRT_LOCK_E2E_SESSION: sessionId,
      LLXPRT_LOCK_E2E_TAG: tag,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const exitCode = await Promise.race([
    proc.exited,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill();
        reject(
          new Error(`child driver ${tag} did not exit within 60s (killed)`),
        );
      }, 60_000);
    }),
  ]);
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `child driver ${tag} exited with code ${exitCode}: ${stderr}`,
    );
  }
  return exitCode;
}
