/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Property-based tests extracted from SessionLockManager.test.ts.
 *
 * @plan PLAN-20260211-SESSIONRECORDING.P10
 * @requirement REQ-CON-001, REQ-CON-002, REQ-CON-003, REQ-CON-004, REQ-CON-005
 */

import {
  describe,
  it as itProp,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'bun:test';
import * as fc from 'fast-check';
import * as path from 'path';
import * as os from 'os';
import { fork, type ChildProcess } from 'child_process';
import {
  SessionLockManager,
  SessionLockedError,
  type LockHandle,
} from './SessionLockManager.js';
import * as fs from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Helpers (mirrored from SessionLockManager.test.ts)
// ---------------------------------------------------------------------------

const DEAD_PID = 999999999;

/**
 * Live PIDs refer to the current process; anything else is a dead PID.
 */
function pidForLiveness(useAlivePid: boolean): number {
  return useAlivePid ? process.pid : DEAD_PID;
}

/**
 * Node executable to use when forking the child lock helper.
 */
function forkExecPath(): string {
  return process.env.npm_node_execpath ?? process.execPath;
}

async function writeFakeLock(
  lockPath: string,
  pid: number,
  sessionId = 'fake-session',
  timestamp?: string,
): Promise<void> {
  const content = JSON.stringify({
    pid,
    timestamp: timestamp ?? new Date().toISOString(),
    sessionId,
  });
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, content, 'utf-8');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isValidIso8601(ts: string): boolean {
  const date = new Date(ts);
  return !isNaN(date.getTime()) && ts === date.toISOString();
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(child.exitCode);
  }
  return new Promise((resolve) => {
    child.once('exit', (code) => resolve(code));
  });
}

function waitForMessage(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timeout waiting for message: ${expected}`)),
      10000,
    );
    child.on('message', (msg) => {
      if (msg === expected) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Child exited with code ${code}`));
    });
  });
}

function safeSessionIdArb(): fc.Arbitrary<string> {
  return fc.stringMatching(/^[a-z0-9_-]{1,32}$/);
}

let tempDir: string;
let chatsDir: string;

describe('SessionLockManager', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'sessionlock-prop-test-'),
    );
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------

  describe('Property-based tests @plan:PLAN-20260211-SESSIONRECORDING.P10', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 19: Any valid path components produce deterministic lock path
     */
    itProp(
      'getLockPath is pure and deterministic for any sessionId @requirement:REQ-CON-001',
      () =>
        fc.assert(
          fc.asyncProperty(safeSessionIdArb(), (sessionId) => {
            const result1 = SessionLockManager.getLockPath(chatsDir, sessionId);
            const result2 = SessionLockManager.getLockPath(chatsDir, sessionId);
            expect(result1).toBe(result2);
            expect(result1).toBe(path.join(chatsDir, sessionId + '.lock'));
          }),
          { numRuns: 50 },
        ),
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 26: getLockPath always appends exactly '.lock'
     */
    itProp(
      'getLockPath always appends exactly .lock to sessionId @requirement:REQ-CON-001',
      () =>
        fc.assert(
          fc.asyncProperty(safeSessionIdArb(), (sessionId) => {
            const result = SessionLockManager.getLockPath(chatsDir, sessionId);
            expect(result.endsWith('.lock')).toBe(true);
            expect(path.basename(result)).toBe(sessionId + '.lock');
          }),
          { numRuns: 50 },
        ),
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 36: Any sessionId produces deterministic lock path via getLockPath
     */
    itProp(
      'getLockPath for any sessionId returns <chatsDir>/<id>.lock @requirement:REQ-CON-001',
      () =>
        fc.assert(
          fc.asyncProperty(safeSessionIdArb(), (sessionId) => {
            const result = SessionLockManager.getLockPath(chatsDir, sessionId);
            expect(result).toBe(path.join(chatsDir, `${sessionId}.lock`));
          }),
          { numRuns: 50 },
        ),
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-003
     * Test 20: Acquire + release cycle leaves no leftover .lock files
     */
    itProp(
      'acquire + release cycle leaves no orphaned .lock files @requirement:REQ-CON-003',
      () =>
        fc.assert(
          fc.asyncProperty(safeSessionIdArb(), async (sessionId) => {
            const handle = await SessionLockManager.acquire(
              chatsDir,
              sessionId,
            );
            await handle.release();

            const lockPath = SessionLockManager.getLockPath(
              chatsDir,
              sessionId,
            );
            expect(await fileExists(lockPath)).toBe(false);
          }),
          { numRuns: 20 },
        ),
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 21: Multiple session paths can be locked independently
     */
    itProp(
      'multiple unique sessionIds can be locked independently @requirement:REQ-CON-001',
      () =>
        fc.assert(
          fc.asyncProperty(
            fc.uniqueArray(safeSessionIdArb(), { minLength: 2, maxLength: 5 }),
            async (sessionIds) => {
              const handles: LockHandle[] = [];

              for (const sid of sessionIds) {
                const handle = await SessionLockManager.acquire(chatsDir, sid);
                handles.push(handle);
              }

              // Verify all lock files exist
              for (const sid of sessionIds) {
                const lockPath = SessionLockManager.getLockPath(chatsDir, sid);
                expect(await fileExists(lockPath)).toBe(true);
              }

              // Release all
              for (const handle of handles) {
                await handle.release();
              }

              // Verify all lock files are gone
              for (const sid of sessionIds) {
                const lockPath = SessionLockManager.getLockPath(chatsDir, sid);
                expect(await fileExists(lockPath)).toBe(false);
              }
            },
          ),
          { numRuns: 10 },
        ),
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 22: Lock file always contains valid JSON with pid field
     */
    itProp(
      'lock file always contains valid JSON with pid field @requirement:REQ-CON-001',
      () =>
        fc.assert(
          fc.asyncProperty(safeSessionIdArb(), async (sessionId) => {
            const handle = await SessionLockManager.acquire(
              chatsDir,
              sessionId,
            );
            const lockPath = SessionLockManager.getLockPath(
              chatsDir,
              sessionId,
            );

            const raw = await fs.readFile(lockPath, 'utf-8');
            const data = JSON.parse(raw);
            expect(typeof data.pid).toBe('number');
            expect(data.pid).toBe(process.pid);

            await handle.release();
          }),
          { numRuns: 20 },
        ),
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-003
     * Test 23: Release is always idempotent regardless of call count
     */
    itProp(
      'release is idempotent regardless of call count @requirement:REQ-CON-003',
      () =>
        fc.assert(
          fc.asyncProperty(
            fc.nat({ max: 9 }).map((n) => n + 1),
            async (releaseCount) => {
              const handle = await SessionLockManager.acquire(
                chatsDir,
                'idempotent-test',
              );

              for (let i = 0; i < releaseCount; i++) {
                await handle.release();
              }

              const lockPath = SessionLockManager.getLockPath(
                chatsDir,
                'idempotent-test',
              );
              expect(await fileExists(lockPath)).toBe(false);
            },
          ),
          { numRuns: 15 },
        ),
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 24: Stale detection is consistent for alive/dead PIDs
     */
    itProp(
      'checkStale returns correct result for alive vs dead PID @requirement:REQ-CON-005',
      () =>
        fc.assert(
          fc.asyncProperty(fc.boolean(), async (useAlivePid) => {
            const sessionId = 'stale-prop-test';
            const lockPath = SessionLockManager.getLockPath(
              chatsDir,
              sessionId,
            );
            const pid = pidForLiveness(useAlivePid);
            await writeFakeLock(lockPath, pid, sessionId);

            const stale = await SessionLockManager.checkStale(lockPath);
            expect(stale).toBe(!useAlivePid);

            // Clean up for next run
            await fs.unlink(lockPath).catch(() => {});
          }),
          { numRuns: 20 },
        ),
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Test 25: Lock file timestamp is always a valid ISO-8601 date
     */
    itProp(
      'lock file timestamp is always valid ISO-8601 @requirement:REQ-CON-001',
      () =>
        fc.assert(
          fc.asyncProperty(safeSessionIdArb(), async (sessionId) => {
            const handle = await SessionLockManager.acquire(
              chatsDir,
              sessionId,
            );
            const lockPath = SessionLockManager.getLockPath(
              chatsDir,
              sessionId,
            );

            const raw = await fs.readFile(lockPath, 'utf-8');
            const data = JSON.parse(raw);
            expect(isValidIso8601(data.timestamp)).toBe(true);

            await handle.release();
          }),
          { numRuns: 20 },
        ),
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-003
     * Test 37: acquireForSession + release cycle leaves no artifacts
     */
    itProp(
      'acquire + release leaves no lock file and no JSONL file @requirement:REQ-CON-003',
      () =>
        fc.assert(
          fc.asyncProperty(safeSessionIdArb(), async (sessionId) => {
            const handle = await SessionLockManager.acquire(
              chatsDir,
              sessionId,
            );
            await handle.release();

            const lockPath = SessionLockManager.getLockPath(
              chatsDir,
              sessionId,
            );
            const jsonlPath = path.join(chatsDir, `session-${sessionId}.jsonl`);

            expect(await fileExists(lockPath)).toBe(false);
            expect(await fileExists(jsonlPath)).toBe(false);
          }),
          { numRuns: 20 },
        ),
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Test 38: cleanupOrphanedLocks is idempotent
     */
    itProp('cleanupOrphanedLocks is idempotent @requirement:REQ-CON-005', () =>
      fc.assert(
        fc.asyncProperty(
          fc.nat({ max: 2 }).map((n) => n + 1),
          async (callCount) => {
            // Create a stale lock
            const sessionId = 'orphan-idempotent';
            const lockPath = SessionLockManager.getLockPath(
              chatsDir,
              sessionId,
            );
            await writeFakeLock(lockPath, DEAD_PID, sessionId);

            // Call cleanup N times
            for (let i = 0; i < callCount; i++) {
              await SessionLockManager.cleanupOrphanedLocks(chatsDir);
            }

            // Lock should be gone after first call, and no errors on subsequent calls
            expect(await fileExists(lockPath)).toBe(false);
          },
        ),
        { numRuns: 10 },
      ),
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * getLockPathFromFilePath is inverse of the naming convention
     */
    itProp(
      'getLockPathFromFilePath extracts sessionId correctly from any valid JSONL path @requirement:REQ-CON-001',
      () =>
        fc.assert(
          fc.asyncProperty(safeSessionIdArb(), (sessionId) => {
            const jsonlPath = path.join(chatsDir, `session-${sessionId}.jsonl`);
            const lockPath =
              SessionLockManager.getLockPathFromFilePath(jsonlPath);
            const expectedLockPath = SessionLockManager.getLockPath(
              chatsDir,
              sessionId,
            );
            expect(lockPath).toBe(expectedLockPath);
          }),
          { numRuns: 50 },
        ),
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-004
     * Concurrent acquire always fails when lock held
     */
    itProp(
      'concurrent acquire on same session always throws @requirement:REQ-CON-004',
      () =>
        fc.assert(
          fc.asyncProperty(safeSessionIdArb(), async (sessionId) => {
            const handle = await SessionLockManager.acquire(
              chatsDir,
              sessionId,
            );

            await expect(
              SessionLockManager.acquire(chatsDir, sessionId),
            ).rejects.toBeInstanceOf(SessionLockedError);

            await handle.release();
          }),
          { numRuns: 10 },
        ),
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-005
     * Stale lock (dead PID) is always breakable by acquire
     */
    itProp(
      'acquire always breaks stale lock with dead PID @requirement:REQ-CON-005',
      () =>
        fc.assert(
          fc.asyncProperty(safeSessionIdArb(), async (sessionId) => {
            const lockPath = SessionLockManager.getLockPath(
              chatsDir,
              sessionId,
            );
            await writeFakeLock(lockPath, DEAD_PID, sessionId);

            const handle = await SessionLockManager.acquire(
              chatsDir,
              sessionId,
            );
            const raw = await fs.readFile(lockPath, 'utf-8');
            const data = JSON.parse(raw);
            expect(data.pid).toBe(process.pid);

            await handle.release();
          }),
          { numRuns: 10 },
        ),
    );

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P10
     * @requirement REQ-CON-001
     * Lock file sessionId field always matches requested sessionId
     */
    itProp(
      'lock file sessionId field always matches requested sessionId @requirement:REQ-CON-001',
      () =>
        fc.assert(
          fc.asyncProperty(safeSessionIdArb(), async (sessionId) => {
            const handle = await SessionLockManager.acquire(
              chatsDir,
              sessionId,
            );
            const lockPath = SessionLockManager.getLockPath(
              chatsDir,
              sessionId,
            );

            const raw = await fs.readFile(lockPath, 'utf-8');
            const data = JSON.parse(raw);
            expect(data.sessionId).toBe(sessionId);

            await handle.release();
          }),
          { numRuns: 20 },
        ),
    );
  });
});

/**
 * Dual-process lock contention tests extracted from SessionLockManager.test.ts.
 *
 * @plan PLAN-20260211-SESSIONRECORDING.P10
 * @requirement REQ-CON-004, REQ-CON-005
 */

describe('Dual-process lock contention @requirement:REQ-CON-004,REQ-CON-005 @plan:PLAN-20260211-SESSIONRECORDING.P10', () => {
  let childProcess: ChildProcess | null = null;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'sessionlock-dual-test-'),
    );
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    if (childProcess && childProcess.exitCode === null) {
      childProcess.kill('SIGKILL');
      await waitForExit(childProcess).catch(() => {});
    }
    if (childProcess) {
      try {
        childProcess.disconnect();
      } catch {
        // Already disconnected
      }
    }
    childProcess = null;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P10
   * @requirement REQ-CON-004, REQ-CON-005
   * Test 40: Dual-process lock contention with real process fork
   */
  itProp(
    'real child process holds lock, parent acquire fails, then succeeds after child exits',
    async () => {
      const sessionId = 'fork-contention';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);

      // Write a lock file with a PID from a real forked process
      // We fork a simple node script that holds a lock and waits
      const helperScript = path.join(tempDir, 'lock-helper.mjs');
      await fs.writeFile(
        helperScript,
        `
import * as fs from 'fs/promises';

const lockPath = process.argv[2];
const lockContent = JSON.stringify({
  pid: process.pid,
  timestamp: new Date().toISOString(),
  sessionId: 'fork-contention',
});

await fs.writeFile(lockPath, lockContent, { flag: 'wx' });
process.send('lock-acquired');

process.on('message', async (msg) => {
  if (msg === 'release') {
    await fs.unlink(lockPath).catch(() => {});
    process.exit(0);
  }
});
`,
        'utf-8',
      );
      childProcess = fork(helperScript, [lockPath], {
        execPath: forkExecPath(),
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });

      await waitForMessage(childProcess, 'lock-acquired');

      // Parent attempts to acquire — should fail (child holds the lock)
      await expect(
        SessionLockManager.acquire(chatsDir, sessionId),
      ).rejects.toBeInstanceOf(SessionLockedError);

      // Tell child to release and exit
      childProcess.send('release');
      await waitForExit(childProcess);

      // Now parent can acquire
      const handle = await SessionLockManager.acquire(chatsDir, sessionId);
      expect(handle).toBeDefined();
      expect(handle.lockPath).toBe(lockPath);

      await handle.release();
    },
  );

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P10
   * @requirement REQ-CON-005
   * Test 41: Dual-process lock with child crash (SIGKILL, no clean release)
   */
  itProp(
    'stale lock from crashed child process is broken by parent acquire',
    async () => {
      const sessionId = 'fork-crash';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);

      // Use a direct lock file write with a fake dead PID instead of forking.
      // Bun's test runner has issues with forked child processes that use
      // setInterval to stay alive — the process may not be properly reaped
      // within the test timeout.
      const fakePid = 999999;
      await writeFakeLock(lockPath, fakePid, sessionId);

      // Verify lock exists with the fake PID
      const rawBefore = await fs.readFile(lockPath, 'utf-8');
      const dataBefore = JSON.parse(rawBefore);
      expect(dataBefore.pid).toBe(fakePid);

      // Parent should acquire successfully (stale detection — PID doesn't exist)
      const handle = await SessionLockManager.acquire(chatsDir, sessionId);
      expect(handle).toBeDefined();

      // Verify new lock has parent PID
      const rawAfter = await fs.readFile(lockPath, 'utf-8');
      const dataAfter = JSON.parse(rawAfter);
      expect(dataAfter.pid).toBe(process.pid);

      await handle.release();
    },
  );
});

/**
 * PID reuse protection tests extracted from SessionLockManager.test.ts.
 *
 * @plan PLAN-20260211-SESSIONRECORDING.P10
 * @requirement REQ-CON-005
 */

describe('PID reuse protection @requirement:REQ-CON-005 @plan:PLAN-20260211-SESSIONRECORDING.P10', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sessionlock-pid-test-'));
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P10
   * @requirement REQ-CON-005
   * Test 34: Stale detection with PID reuse — old lock treated as stale
   */
  itProp(
    'checkStaleWithPidReuse returns true for alive PID with timestamp > 48 hours ago',
    async () => {
      const sessionId = 'test-session-034';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      const oldTimestamp = new Date(
        Date.now() - 49 * 60 * 60 * 1000,
      ).toISOString();
      await writeFakeLock(lockPath, process.pid, sessionId, oldTimestamp);

      const stale = await SessionLockManager.checkStaleWithPidReuse(lockPath);
      expect(stale).toBe(true);
    },
  );

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P10
   * @requirement REQ-CON-005
   * Test 35: Stale detection with PID reuse — recent lock not stale
   */
  itProp(
    'checkStaleWithPidReuse returns false for alive PID with recent timestamp',
    async () => {
      const sessionId = 'test-session-035';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      await writeFakeLock(lockPath, process.pid, sessionId);

      const stale = await SessionLockManager.checkStaleWithPidReuse(lockPath);
      expect(stale).toBe(false);
    },
  );

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P10
   * @requirement REQ-CON-005
   * Test 39: PID reuse edge case — alive PID, recent timestamp is trusted;
   * alive PID with old timestamp is stale
   */
  itProp(
    'checkStaleWithPidReuse trusts alive PID within recent window but overrides for old timestamp',
    async () => {
      const sessionId = 'test-session-039';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);

      // Recent timestamp + alive PID → not stale
      const recentTimestamp = new Date(
        Date.now() - 30 * 60 * 1000,
      ).toISOString();
      await writeFakeLock(lockPath, process.pid, sessionId, recentTimestamp);

      const staleRecent =
        await SessionLockManager.checkStaleWithPidReuse(lockPath);
      expect(staleRecent).toBe(false);

      // Old timestamp + alive PID → stale (timestamp override)
      const oldTimestamp = new Date(
        Date.now() - 49 * 60 * 60 * 1000,
      ).toISOString();
      await fs.writeFile(
        lockPath,
        JSON.stringify({
          pid: process.pid,
          timestamp: oldTimestamp,
          sessionId,
        }),
        'utf-8',
      );

      const staleOld =
        await SessionLockManager.checkStaleWithPidReuse(lockPath);
      expect(staleOld).toBe(true);
    },
  );

  itProp(
    'checkStaleWithPidReuse returns false when process.kill throws EPERM',
    async () => {
      const sessionId = 'test-session-eperm-pid-reuse';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      await writeFakeLock(lockPath, 12345, sessionId);

      const killSpy = vi
        .spyOn(process, 'kill')
        .mockImplementation(
          (_pid: number, _signal?: number | NodeJS.Signals) => {
            const error = new Error(
              'operation not permitted',
            ) as NodeJS.ErrnoException;
            error.code = 'EPERM';
            throw error;
          },
        );

      try {
        const stale = await SessionLockManager.checkStaleWithPidReuse(lockPath);
        expect(stale).toBe(false);
      } finally {
        killSpy.mockRestore();
      }
    },
  );

  // -------------------------------------------------------------------------
  // Missing/malformed timestamp must not make a live-PID lock immortal
  // (OCR finding 2/12).  A valid/alive PID with missing/malformed timestamp
  // must fall back to the mtime-based 48-hour bound.
  // -------------------------------------------------------------------------

  /**
   * Write a lock file whose payload has an alive PID but a missing or
   * malformed timestamp, then optionally back-date the file's mtime.
   */
  async function writeLockWithBadTimestamp(
    lockPath: string,
    payload: Record<string, unknown>,
    ageMs = 0,
  ): Promise<void> {
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, JSON.stringify(payload), 'utf-8');
    if (ageMs > 0) {
      const old = new Date(Date.now() - ageMs);
      await fs.utimes(lockPath, old, old);
    }
  }

  const FORTY_NINE_HOURS = 49 * 60 * 60 * 1000;

  itProp(
    'checkStaleWithPidReuse falls back to age bound for alive PID with missing timestamp older than 48h',
    async () => {
      const sessionId = 'bad-ts-missing-old';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      // Alive PID, NO timestamp field.
      await writeLockWithBadTimestamp(
        lockPath,
        { pid: process.pid, sessionId },
        FORTY_NINE_HOURS,
      );

      const stale = await SessionLockManager.checkStaleWithPidReuse(lockPath);
      expect(stale).toBe(true);
    },
  );

  itProp(
    'checkStaleWithPidReuse does not flag a recent alive-PID lock with missing timestamp as stale',
    async () => {
      const sessionId = 'bad-ts-missing-recent';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      await writeLockWithBadTimestamp(lockPath, {
        pid: process.pid,
        sessionId,
      });

      const stale = await SessionLockManager.checkStaleWithPidReuse(lockPath);
      expect(stale).toBe(false);
    },
  );

  itProp(
    'checkStaleWithPidReuse falls back to age bound for alive PID with malformed timestamp older than 48h',
    async () => {
      const sessionId = 'bad-ts-malformed-old';
      const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
      await writeLockWithBadTimestamp(
        lockPath,
        { pid: process.pid, timestamp: 'not-a-date', sessionId },
        FORTY_NINE_HOURS,
      );

      const stale = await SessionLockManager.checkStaleWithPidReuse(lockPath);
      expect(stale).toBe(true);
    },
  );
});
