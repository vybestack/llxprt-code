/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the cross-process credential write lock.
 *
 * These tests exercise the real filesystem-based lock: overlapping
 * operations must serialize, different keys must not false-share, dead owners
 * must be recovered, and acquisition timeout must fail closed (throw
 * SecureStoreError TIMEOUT) rather than proceed unlocked.
 *
 * The child-process liveness test spawns `process.execPath` (Node.js) — it
 * does NOT depend on `bun` being on PATH.
 *
 * @plan PLAN-20260801-ISSUE2927
 * @requirement R3, R4
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  CANONICAL_START_TIME_PLATFORMS,
  CredentialWriteLock,
} from '../src/secure-store/credential-write-lock.js';
import { SecureStoreError } from '../src/secure-store/secure-store-errors.js';

/**
 * Narrows a caught value to a SecureStoreError at runtime.
 *
 * Used instead of a type assertion so a wrong error type fails the test with a
 * clear message rather than being silently coerced.
 */
function asSecureStoreError(error: unknown): SecureStoreError {
  if (!(error instanceof SecureStoreError)) {
    throw new Error(`Expected a SecureStoreError, received: ${String(error)}`);
  }
  return error;
}

/**
 * Builds the start-time fields for a fabricated "stall" owner record, using the
 * canonical `ps -o lstart=` value where it exists (the same mechanism
 * production's `readProcessStartTimeMs` uses) and an approximate value
 * everywhere else.
 *
 * On canonical platforms a `'canonical'` record must use the real `ps` value —
 * not the approximate `Date.now() - process.uptime() * 1000` — otherwise the
 * record is internally inconsistent: `probeOwnerLiveness` trusts the
 * `'canonical'` claim, re-reads the real `ps` value, and the quantization
 * error (lstart is rounded to the whole second) plus uptime drift can exceed
 * the 2000 ms tolerance, causing a live owner to be misjudged dead.
 *
 * On Windows there is no `ps`, so production returns `null` and never produces a
 * `'canonical'` record. A fabricated `'canonical'` record would be
 * unverifiable-but-harmless, but we cannot even compute its `startTimeMs`, so
 * we mirror production: emit an `'approximate'` record instead. Such an owner is
 * still judged `'unverifiable'` (never `'dead'`) by `probeOwnerLiveness`, so a
 * live process's lock is still never reclaimed — the TIMEOUT this test asserts
 * still holds.
 */
function buildStallOwnerStartTime(): {
  startTimeMs: number;
  startTimeSource: 'canonical' | 'approximate';
} {
  if (!CANONICAL_START_TIME_PLATFORMS.includes(process.platform)) {
    return {
      startTimeMs: Date.now() - process.uptime() * 1000,
      startTimeSource: 'approximate',
    };
  }
  const raw = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
  }).trim();
  const value = Date.parse(`${raw} UTC`);
  if (!Number.isFinite(value)) {
    throw new Error(`Could not parse canonical process start time: ${raw}`);
  }
  return { startTimeMs: value, startTimeSource: 'canonical' };
}

// ─── Shared temp-dir lifecycle helper (DRY-setup per dev-docs/RULES.md) ──────

function useTempDir(): {
  dir: () => string;
  lockDir: () => string;
  setup: () => Promise<void>;
  teardown: () => Promise<void>;
} {
  let tempDir = '';
  let lockDirPath = '';
  const setup = async (): Promise<void> => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cred-write-lock-test-'));
    lockDirPath = path.join(tempDir, 'locks');
  };
  const teardown = async (): Promise<void> => {
    await fs.rm(tempDir, { recursive: true, force: true });
  };
  return {
    dir: () => tempDir,
    lockDir: () => lockDirPath,
    setup,
    teardown,
  };
}

const CHILD_READY_TIMEOUT_MS = 2_000;
const CHILD_EXIT_TIMEOUT_MS = 2_000;

async function waitForChildReady(
  child: ReturnType<typeof spawn>,
): Promise<void> {
  const stdout = child.stdout;
  if (stdout === null) {
    throw new Error('Lock-owner child stdout is not piped');
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      stdout.removeListener('data', onData);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
    };
    const onData = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      cleanup();
      reject(
        new Error(
          `Lock-owner child exited before ready (code=${String(code)}, signal=${String(signal)})`,
        ),
      );
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for lock-owner child readiness'));
    }, CHILD_READY_TIMEOUT_MS);
    stdout.once('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error('Lock-owner child did not exit after SIGKILL')),
          CHILD_EXIT_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    // O10: Clear the timeout from the losing branch so it does not keep the
    // event loop alive for up to CHILD_EXIT_TIMEOUT_MS after the exit event
    // arrives first.
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

/**
 * A gate is a deferred promise that can be resolved externally, replacing
 * sleep-based timing with explicit synchronization points. This makes
 * overlap/non-overlap assertions deterministic rather than timing-dependent.
 */
function createGate(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolveFn: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  return { promise, resolve: resolveFn };
}

describe('CredentialWriteLock', () => {
  const temp = useTempDir();

  beforeEach(() => temp.setup());
  afterEach(() => temp.teardown());

  const lockDir = (): string => temp.lockDir();

  it('serializes overlapping operations for the same (service, account) across instances', async () => {
    const lockA = new CredentialWriteLock({ lockDir: lockDir() });
    const lockB = new CredentialWriteLock({ lockDir: lockDir() });

    const executionOrder: string[] = [];
    const aStartedGate = createGate();

    const opA = lockA.withLock('svc', 'acct', async () => {
      executionOrder.push('A-start');
      // Hold the lock until B has tried to acquire it.
      await aStartedGate.promise;
      executionOrder.push('A-end');
      return 'A';
    });

    // Wait for A to genuinely hold the lock (the lock file exists on disk).
    const lockPath = lockA.lockFilePath('svc', 'acct');
    let aHoldsLock = false;
    for (let i = 0; i < 100 && !aHoldsLock; i++) {
      try {
        await fs.readFile(lockPath, 'utf8');
        aHoldsLock = true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    expect(aHoldsLock).toBe(true);

    const opB = lockB.withLock('svc', 'acct', async () => {
      executionOrder.push('B-start');
      executionOrder.push('B-end');
      return 'B';
    });

    // B is now contending. Resolve A so it releases the lock and B can proceed.
    // The key: B must NOT start until A ends.
    aStartedGate.resolve();

    const [resultA, resultB] = await Promise.all([opA, opB]);

    expect(resultA).toBe('A');
    expect(resultB).toBe('B');
    // A must fully complete before B starts.
    expect(executionOrder).toStrictEqual([
      'A-start',
      'A-end',
      'B-start',
      'B-end',
    ]);
  });

  it('cross-instance serialization is produced by the filesystem lock, not an in-memory chain', async () => {
    // Two independent instances share one lock dir but NOT an in-memory chain.
    // Serialization between them must come from the filesystem lock.
    const lockA = new CredentialWriteLock({ lockDir: lockDir() });
    const lockB = new CredentialWriteLock({ lockDir: lockDir() });
    const lockPath = lockA.lockFilePath('xc-svc', 'acct');

    let observedOnDiskDuringA = '';
    const executionOrder: string[] = [];
    const aStartedGate = createGate();

    const opA = lockA.withLock('xc-svc', 'acct', async () => {
      observedOnDiskDuringA = await fs.readFile(lockPath, 'utf8');
      executionOrder.push('A-start');
      await aStartedGate.promise;
      executionOrder.push('A-end');
      return 'A';
    });

    // Wait for A's lock file to appear on disk, proving it holds the lock.
    let aHoldsLock2 = false;
    for (let i = 0; i < 100 && !aHoldsLock2; i++) {
      try {
        await fs.readFile(lockPath, 'utf8');
        aHoldsLock2 = true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    expect(aHoldsLock2).toBe(true);

    const opB = lockB.withLock('xc-svc', 'acct', async () => {
      executionOrder.push('B-start');
      await new Promise((resolve) => setTimeout(resolve, 10));
      executionOrder.push('B-end');
      return 'B';
    });

    // Resolve A so B can proceed after A releases.
    aStartedGate.resolve();

    const [resultA, resultB] = await Promise.all([opA, opB]);

    expect(resultA).toBe('A');
    expect(resultB).toBe('B');
    expect(executionOrder).toStrictEqual([
      'A-start',
      'A-end',
      'B-start',
      'B-end',
    ]);
    expect(observedOnDiskDuringA).toContain('ownerToken');
    expect(observedOnDiskDuringA).toContain('"pid"');
    const remaining = await fs.readdir(lockDir());
    expect(remaining.filter((f) => f.endsWith('.lock'))).toStrictEqual([]);
  });

  it('runs different (service, account) pairs concurrently (no false sharing)', async () => {
    const lock = new CredentialWriteLock({ lockDir: lockDir() });

    // Record an ordered event sequence instead of timestamp windows, so the
    // overlap assertion is resolution-independent and deterministic. The gates
    // prove genuine overlap: both operations enter their critical sections,
    // and neither is released until both have entered — which logically
    // proves they ran concurrently.
    const events: string[] = [];
    const gateX = createGate();
    const gateY = createGate();

    const opX = lock.withLock('svc-x', 'acct', async () => {
      events.push('x-enter');
      await gateX.promise;
      events.push('x-exit');
      return 'X';
    });
    const opY = lock.withLock('svc-y', 'acct', async () => {
      events.push('y-enter');
      await gateY.promise;
      events.push('y-exit');
      return 'Y';
    });

    // Wait for both operations to have entered their critical sections.
    while (!events.includes('x-enter') || !events.includes('y-enter')) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    // Both are now inside their critical sections. Release both.
    gateX.resolve();
    gateY.resolve();

    const [resultX, resultY] = await Promise.all([opX, opY]);

    expect(resultX).toBe('X');
    expect(resultY).toBe('Y');
    // Both enter events must occur before either exit event — proving the
    // two operations ran concurrently (distinct keys do not false-share).
    const lastEnterIdx = Math.max(
      events.indexOf('x-enter'),
      events.indexOf('y-enter'),
    );
    const firstExitIdx = Math.min(
      events.indexOf('x-exit'),
      events.indexOf('y-exit'),
    );
    expect(lastEnterIdx).toBeLessThan(firstExitIdx);
  });

  it('serializes same-process concurrent sibling withLock calls on one instance', async () => {
    const lock = new CredentialWriteLock({ lockDir: lockDir() });

    const executionOrder: string[] = [];
    const op1StartedGate = createGate();

    const op1 = lock.withLock('svc', 'acct', async () => {
      executionOrder.push('1-start');
      await op1StartedGate.promise;
      executionOrder.push('1-end');
    });
    const op2 = lock.withLock('svc', 'acct', async () => {
      executionOrder.push('2-start');
      await new Promise((resolve) => setTimeout(resolve, 10));
      executionOrder.push('2-end');
    });

    // Wait for op1 to hold the lock.
    const lockPath = lock.lockFilePath('svc', 'acct');
    let op1HoldsLock = false;
    for (let i = 0; i < 100 && !op1HoldsLock; i++) {
      try {
        await fs.readFile(lockPath, 'utf8');
        op1HoldsLock = true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    expect(op1HoldsLock).toBe(true);

    // op2 is now contending in memory. Release op1.
    op1StartedGate.resolve();

    await Promise.all([op1, op2]);

    expect(executionOrder).toStrictEqual([
      '1-start',
      '1-end',
      '2-start',
      '2-end',
    ]);
  });

  it('removes the lock file after withLock resolves', async () => {
    const lock = new CredentialWriteLock({ lockDir: lockDir() });

    await lock.withLock('svc', 'acct', async () => 'done');

    const files = await fs.readdir(lockDir());
    const lockFiles = files.filter((f) => f.endsWith('.lock'));
    expect(lockFiles).toStrictEqual([]);
  });

  it('removes the lock file after withLock rejects', async () => {
    const lock = new CredentialWriteLock({ lockDir: lockDir() });

    await expect(
      lock.withLock('svc', 'acct', async () => {
        throw new Error('operation failed');
      }),
    ).rejects.toThrow('operation failed');

    const files = await fs.readdir(lockDir());
    const lockFiles = files.filter((f) => f.endsWith('.lock'));
    expect(lockFiles).toStrictEqual([]);
  });

  it('lock path is deterministic — same (service, account) always yields the same path across instances', async () => {
    const lockA = new CredentialWriteLock({ lockDir: lockDir() });
    const lockB = new CredentialWriteLock({ lockDir: lockDir() });

    // Two independently constructed instances must derive the same path.
    const pathA = lockA.lockFilePath('myservice', 'myaccount');
    const pathB = lockB.lockFilePath('myservice', 'myaccount');
    expect(pathA).toBe(pathB);

    // The on-disk file name matches what lockFilePath predicts.
    let observedFileName = '';
    await lockA.withLock('myservice', 'myaccount', async () => {
      const files = await fs.readdir(lockDir());
      observedFileName = files.find((f) => f.endsWith('.lock')) ?? '';
    });
    expect(observedFileName).not.toBe('');
    expect(path.join(lockDir(), observedFileName)).toBe(pathA);
  });

  it('lock path is injective — different component splits never collide across the delimiter boundary', () => {
    const lock = new CredentialWriteLock({ lockDir: lockDir() });
    // ('ab', 'c') and ('a', 'bc') must produce distinct paths.
    const path1 = lock.lockFilePath('ab', 'c');
    const path2 = lock.lockFilePath('a', 'bc');
    expect(path1).not.toBe(path2);

    // Completely different pairs must also never collide.
    expect(lock.lockFilePath('svc-x', 'acct')).not.toBe(
      lock.lockFilePath('svc-y', 'acct'),
    );
  });

  it('lock path is injective for control characters below 0x10 — escapes are zero-padded', () => {
    const lock = new CredentialWriteLock({ lockDir: lockDir() });

    // Without a zero pad, TAB (0x09) would encode as '%9' and absorb the
    // following 'A', producing '%9A' — identical to U+009A's encoding. Two
    // different services would then share one lock file, silently breaking
    // cross-process write serialization.
    const tabThenA = lock.lockFilePath('\u0009A', 'acct');
    const singleU009A = lock.lockFilePath('\u009A', 'acct');
    expect(tabThenA).not.toBe(singleU009A);

    // Every escape must be exactly two hex digits.
    expect(path.basename(tabThenA)).toContain('%09');
  });

  it('lock path is filesystem-safe — path-unsafe characters are escaped and cannot escape the lock directory', () => {
    const ld = lockDir();
    const lock = new CredentialWriteLock({ lockDir: ld });

    // Each pair contains at least one character that is path-unsafe.
    const unsafePairs: ReadonlyArray<readonly [string, string]> = [
      ['svc/with/slash', 'acct'],
      ['svc', 'acct/with/slash'],
      ['svc\\with\\backslash', 'acct'],
      ['svc:with:colon', 'acct'],
      ['../escape', 'acct'],
      ['svc', '../../escape'],
      ['svc\x00null', 'acct'],
      ['svc\x1funit', 'acct'],
      ['svc|pipe', 'acct'],
      ['svc*star', 'acct'],
      ['svc?question', 'acct'],
      ['svc"quote', 'acct'],
      ['svc<lt>gt', 'acct'],
    ];

    for (const [svc, acct] of unsafePairs) {
      const resolved = lock.lockFilePath(svc, acct);
      const base = path.basename(resolved);
      // The encoded file name must never contain a raw path separator or
      // null/control character — those are all percent-encoded.
      expect(base).not.toContain('/');
      expect(base).not.toContain('\\');
      expect(base).not.toContain('\x00');
      expect(base).not.toContain('\x1f');
      // No path-traversal sequence can appear: all separators (`/` `\`) are
      // encoded, so a literal `..` can never be adjacent to a separator.
      expect(base).not.toMatch(/\.\.[/\\]/);
      expect(base).not.toMatch(/[/\\]\.\./);
      // The resolved path must stay inside the lock directory.
      expect(resolved.startsWith(ld + path.sep)).toBe(true);
    }
  });

  it('lock path escapes the @ delimiter so it cannot appear inside an encoded component', () => {
    const lock = new CredentialWriteLock({ lockDir: lockDir() });
    const resolved = lock.lockFilePath('svc@evil', 'acct');
    const base = path.basename(resolved);
    // The raw '@' from the service must be encoded as %40; only the single
    // delimiter '@' between components may appear.
    expect(base.match(/@/g)?.length).toBe(1);
    expect(base).toContain('svc%40evil');
  });

  it('lock path escapes the % character so encoding cannot be ambiguous', () => {
    const lock = new CredentialWriteLock({ lockDir: lockDir() });
    const resolved = lock.lockFilePath('svc%2F', 'acct');
    const base = path.basename(resolved);
    // The literal '%' in the input must itself be percent-encoded as %25,
    // so 'svc%2F' does not decode to a path separator.
    expect(base).not.toContain('svc%2F');
    expect(base).toContain('svc%252F');
  });

  it('lock path throws SecureStoreError when the encoded name exceeds the filesystem length cap', () => {
    const lock = new CredentialWriteLock({ lockDir: lockDir() });
    const longId = 'a'.repeat(200);
    let caught: unknown = null;
    try {
      lock.lockFilePath(longId, longId);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SecureStoreError);
    expect(asSecureStoreError(caught).code).toBe('CORRUPT');
  });

  it('fails closed with TIMEOUT when the lock cannot be acquired within waitMs', async () => {
    const ld = lockDir();
    await fs.mkdir(ld, { recursive: true });
    // Place a lock owned by a live process (this process) so it will never
    // be reclaimable as dead. Use the canonical start time where `ps` exists
    // and an approximate one on platforms without it; in both cases the owner
    // is judged live/unverifiable and never reclaimed, so acquisition times out.
    const { startTimeMs, startTimeSource } = buildStallOwnerStartTime();
    const stallPayload = {
      version: 1,
      ownerToken: 'perpetual-owner',
      pid: process.pid,
      hostname: os.hostname(),
      startTimeMs,
      startTimeSource,
    };
    const lockPath = new CredentialWriteLock({
      lockDir: ld,
    }).lockFilePath('svc', 'acct');
    await fs.writeFile(lockPath, JSON.stringify(stallPayload), {
      mode: 0o600,
    });

    const lock = new CredentialWriteLock({ lockDir: ld, waitMs: 150 });
    let callbackRan = false;
    const error = await lock
      .withLock('svc', 'acct', async () => {
        callbackRan = true;
        return 'should-not-reach';
      })
      .catch((e: unknown) => e);

    // H1: the callback must NOT have run — we never invoke the mutating
    // operation without ownership.
    expect(callbackRan).toBe(false);
    expect(error).toBeInstanceOf(SecureStoreError);
    expect(asSecureStoreError(error).code).toBe('TIMEOUT');
    // The error message must name the contended item and include the lock
    // file path for remediation, without exposing any secret material.
    const message = asSecureStoreError(error).message;
    expect(message).toContain('svc:acct');
    expect(message).toContain(lockPath);
  });

  it('release failure does not mask the operation error (M4)', async () => {
    // Inject a logger that captures warnings so we can verify the release
    // error was surfaced.
    const warnings: string[] = [];
    const lock = new CredentialWriteLock({
      lockDir: lockDir(),
      logger: {
        debug: () => undefined,
        warn: (msg: () => string) => warnings.push(msg()),
        error: () => undefined,
      },
    });

    const opError = new Error('operation-blew-up');
    const result = await lock
      .withLock('svc', 'acct', async () => {
        // Sabotage the lock AFTER acquisition so that release()'s
        // readOwner → fs.readFile fails with a non-ENOENT error, genuinely
        // exercising the M4 catch-and-warn path. Replacing the lock file with
        // a directory yields EISDIR on every platform; the previous
        // "remove the lock dir and put a file in its place" approach produced
        // ENOTDIR on POSIX but ENOENT on Windows (libuv maps a path that
        // traverses a non-directory component to ENOENT there), so readOwner
        // swallowed it as "absent" and no warning was logged — silently hiding
        // the release failure on Windows.
        const lockPath = lock.lockFilePath('svc', 'acct');
        await fs.rm(lockPath, { force: true });
        await fs.mkdir(lockPath);
        throw opError;
      })
      .catch((e: unknown) => e);

    // The operation error must win — it must NOT be masked by the release
    // error.
    expect(result).toBe(opError);
    // Exactly one warning must be logged, and it must name the lock path so
    // the release failure is never silently discarded.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(lock.lockFilePath('svc', 'acct'));
  });

  it('wraps lock-directory creation failure in SecureStoreError (M4)', async () => {
    // Create the parent lockDir first, then block the subdir path.
    await fs.mkdir(lockDir(), { recursive: true });
    const ld = path.join(lockDir(), 'not-a-dir');
    await fs.writeFile(ld, 'blocks mkdir');

    const lock = new CredentialWriteLock({ lockDir: ld, waitMs: 100 });
    const error = await lock
      .withLock('svc', 'acct', async () => 'should-not-reach')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SecureStoreError);
    expect(asSecureStoreError(error).code).toBe('UNAVAILABLE');
  });

  it('dead-owner recovery errors do not abort the acquire loop (O4) — surfaces TIMEOUT, not a raw errno', async () => {
    const ld = lockDir();
    await fs.mkdir(ld, { recursive: true });
    const warnings: string[] = [];
    const lock = new CredentialWriteLock({
      lockDir: ld,
      waitMs: 200,
      logger: {
        debug: () => undefined,
        warn: (msg: () => string) => warnings.push(msg()),
        error: () => undefined,
      },
    });
    const lockPath = lock.lockFilePath('recover-err-svc', 'acct');

    // Place a DIRECTORY at the lock path so that:
    // - tryCreateLock → publishOwnerFile → fs.link fails with EEXIST (path
    //   already exists) → returns false (entering the recovery path).
    // - maybeRecoverDeadOwnerLock → fs.readFile(lockPath) fails with EISDIR
    //   (not ENOENT) → THROWS.
    // Without O4 this throw would abort the loop and propagate as a raw
    // errno error. With O4 it is caught, logged, and the loop keeps backing
    // off until the TIMEOUT deadline.
    await fs.mkdir(lockPath, { recursive: true });

    const error = await lock
      .withLock('recover-err-svc', 'acct', async () => 'should-not-reach')
      .catch((e: unknown) => e);

    // The loop must have kept retrying until the deadline, then thrown
    // TIMEOUT — NOT a raw EISDIR errno error.
    expect(error).toBeInstanceOf(SecureStoreError);
    expect(asSecureStoreError(error).code).toBe('TIMEOUT');
    // At least one warning must have been logged about the recovery failure.
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w) => w.includes('dead-owner recovery failed'))).toBe(
      true,
    );
  });

  it('raw errno errors from lock acquisition are wrapped as SecureStoreError (O5)', async () => {
    // Point lockDir at a path whose parent is a regular file so that
    // ensureLockDir → mkdir fails. ensureLockDir is already wrapped, but
    // this proves the wrapping works end-to-end.
    const ld = lockDir();
    const blocker = path.join(ld, 'blocker');
    await fs.mkdir(ld, { recursive: true });
    await fs.writeFile(blocker, 'blocks-mkdir');
    const badLockDir = path.join(blocker, 'locks');

    const lock = new CredentialWriteLock({ lockDir: badLockDir, waitMs: 100 });
    const error = await lock
      .withLock('svc', 'acct', async () => 'should-not-reach')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SecureStoreError);
    expect(asSecureStoreError(error).code).toBe('UNAVAILABLE');
  });

  // ─── Lock-record classification: garbage / version-mismatch recovery ──────
  //
  // FIX 1: an unparseable or version-mismatched lock file used to cause a
  // PERMANENT deadlock — recovery returned false for any null parse, so
  // every subsequent writer timed out forever. Now unparseable and
  // older-version records are reclaimed via a fenced takeover, while a
  // NEWER-version record fails fast with an actionable UNAVAILABLE error
  // (not a generic TIMEOUT) because stealing it would break cross-version
  // serialization.

  it('reclaims a garbage (non-JSON) lock file via fenced takeover', async () => {
    const ld = lockDir();
    await fs.mkdir(ld, { recursive: true });
    const lock = new CredentialWriteLock({ lockDir: ld });
    const lockPath = lock.lockFilePath('garbage-svc', 'acct');
    await fs.writeFile(lockPath, 'this is not json {{{', { mode: 0o600 });

    let callbackRan = false;
    const result = await lock.withLock('garbage-svc', 'acct', async () => {
      callbackRan = true;
      return 'reclaimed';
    });

    expect(result).toBe('reclaimed');
    expect(callbackRan).toBe(true);
    // The garbage lock file must have been replaced (and then released
    // normally on success), so no .lock file remains.
    const files = await fs.readdir(ld);
    expect(files.filter((f) => f.endsWith('.lock'))).toStrictEqual([]);
  });

  it('reclaims a well-formed record with version LOCK_VERSION - 1', async () => {
    const ld = lockDir();
    await fs.mkdir(ld, { recursive: true });
    const lock = new CredentialWriteLock({ lockDir: ld });
    const lockPath = lock.lockFilePath('oldver-svc', 'acct');
    // version 0 — one less than the current LOCK_VERSION (1).
    await fs.writeFile(
      lockPath,
      JSON.stringify({
        version: 0,
        ownerToken: 'legacy-owner',
        pid: 999999,
        hostname: os.hostname(),
        startTimeMs: Date.now(),
        startTimeSource: 'canonical',
      }),
      { mode: 0o600 },
    );

    let callbackRan = false;
    const result = await lock.withLock('oldver-svc', 'acct', async () => {
      callbackRan = true;
      return 'reclaimed';
    });

    expect(result).toBe('reclaimed');
    expect(callbackRan).toBe(true);
    const files = await fs.readdir(ld);
    expect(files.filter((f) => f.endsWith('.lock'))).toStrictEqual([]);
  });

  it('fails fast with UNAVAILABLE (not TIMEOUT) for a newer-version lock file and leaves it untouched', async () => {
    const ld = lockDir();
    await fs.mkdir(ld, { recursive: true });
    const lock = new CredentialWriteLock({ lockDir: ld, waitMs: 200 });
    const lockPath = lock.lockFilePath('newer-svc', 'acct');
    // version 2 — one more than the current LOCK_VERSION (1).
    const newerPayload = JSON.stringify({
      version: 2,
      ownerToken: 'future-owner',
      pid: 999999,
      hostname: os.hostname(),
      startTimeMs: Date.now(),
      startTimeSource: 'canonical',
    });
    await fs.writeFile(lockPath, newerPayload, { mode: 0o600 });

    let callbackRan = false;
    const error = await lock
      .withLock('newer-svc', 'acct', async () => {
        callbackRan = true;
        return 'should-not-reach';
      })
      .catch((e: unknown) => e);

    // Must fail fast with UNAVAILABLE — NOT TIMEOUT.
    expect(callbackRan).toBe(false);
    expect(error).toBeInstanceOf(SecureStoreError);
    const storeError = asSecureStoreError(error);
    expect(storeError.code).toBe('UNAVAILABLE');
    expect(storeError.code).not.toBe('TIMEOUT');
    // Message must name the observed version and the lock file path.
    expect(storeError.message).toContain('2');
    expect(storeError.message).toContain(lockPath);
    // The lock file must be left byte-for-byte untouched.
    const afterContent = await fs.readFile(lockPath, 'utf8');
    expect(afterContent).toBe(newerPayload);
  });

  it('two instances concurrently recovering the same corrupt lock file are serialized (max concurrent-entry depth 1) and both succeed', async () => {
    const ld = lockDir();
    await fs.mkdir(ld, { recursive: true });
    const lockA = new CredentialWriteLock({ lockDir: ld });
    const lockB = new CredentialWriteLock({ lockDir: ld });
    const lockPath = lockA.lockFilePath('concurrent-corrupt-svc', 'acct');
    await fs.writeFile(lockPath, 'garbage {{{ not json', { mode: 0o600 });

    let currentDepth = 0;
    let maxDepth = 0;

    const track = async <T>(
      label: string,
      fn: () => Promise<T>,
    ): Promise<T> => {
      currentDepth += 1;
      if (currentDepth > maxDepth) {
        maxDepth = currentDepth;
      }
      // Yield so a concurrent caller has a chance to interleave if it is not
      // serialized. A genuinely serialized lock will never let both critical
      // sections overlap.
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await fn();
      } finally {
        currentDepth -= 1;
        void label;
      }
    };

    const opA = lockA.withLock('concurrent-corrupt-svc', 'acct', () =>
      track('A', async () => 'A'),
    );
    const opB = lockB.withLock('concurrent-corrupt-svc', 'acct', () =>
      track('B', async () => 'B'),
    );

    const [resultA, resultB] = await Promise.all([opA, opB]);

    expect(resultA).toBe('A');
    expect(resultB).toBe('B');
    // Exactly one callback at a time — no overlap.
    expect(maxDepth).toBe(1);
    // Both completed; lock released.
    const files = await fs.readdir(ld);
    expect(files.filter((f) => f.endsWith('.lock'))).toStrictEqual([]);
  });

  describe.skipIf(!CANONICAL_START_TIME_PLATFORMS.includes(process.platform))(
    'OS-observed subprocess owner identity',
    () => {
      // Runs under both Vitest and Bun. It previously had to be skipped under
      // Bun because `bun test` forces the test process's JS timezone to UTC
      // without setting process.env.TZ, so a spawned `ps` inherited the real
      // system timezone while the parent parsed its output as UTC — a whole
      // UTC-offset error (measured: 10,801,053 ms on a UTC-3 system) that
      // exceeded PROCESS_START_TOLERANCE_MS and made a live owner look dead.
      // readProcessStartTimeMs now pins the `ps` child to TZ=UTC and parses
      // explicitly as UTC, so the reading no longer depends on either
      // timezone and the drift is back to ~1 s.
      it('rejects with TIMEOUT while a real live subprocess holds the lock, then recovers after it exits', async () => {
        const ld = lockDir();
        await fs.mkdir(ld, { recursive: true });
        const lock = new CredentialWriteLock({ lockDir: ld, waitMs: 3_000 });
        const lockPath = lock.lockFilePath('subprocess-svc', 'acct');

        const child = spawn(
          process.execPath,
          [
            '-e',
            [
              "const fs=require('node:fs')",
              "const os=require('node:os')",
              "const cp=require('node:child_process')",
              "const raw=cp.execFileSync('ps',['-o','lstart=','-p',String(process.pid)],{encoding:'utf8',env:{...process.env,LC_ALL:'C',TZ:'UTC'}}).trim()",
              "const started=Date.parse(raw+' UTC')",
              "fs.writeFileSync(process.argv[1],JSON.stringify({version:1,ownerToken:'child-owner',pid:process.pid,hostname:os.hostname(),startTimeMs:started,startTimeSource:'canonical'}),{mode:0o600})",
              "process.stdout.write('ready\\n')",
              'setInterval(()=>{},1000)',
            ].join(';'),
            lockPath,
          ],
          {
            env: { ...process.env, LC_ALL: 'C' },
          },
        );

        try {
          await waitForChildReady(child);
          // While the child holds the lock, our operation must NOT run.
          // It must reject with TIMEOUT, and the child's lock file must
          // be untouched.
          let callbackRan = false;
          const error = await lock
            .withLock(
              'subprocess-svc',
              'acct',
              async () => {
                callbackRan = true;
                return 'parent-ran';
              },
              { waitMs: 200 },
            )
            .catch((e: unknown) => e);

          expect(callbackRan).toBe(false);
          expect(error).toBeInstanceOf(SecureStoreError);
          expect(asSecureStoreError(error).code).toBe('TIMEOUT');
          // The child's lock file must still be intact (not stolen).
          const content = await fs.readFile(lockPath, 'utf8');
          expect(content).toContain('child-owner');
        } finally {
          await stopChild(child);
        }

        // After the child exits, a new lock acquisition should succeed and
        // own the lock (dead-owner recovery via fenced takeover).
        const result2 = await lock.withLock(
          'subprocess-svc',
          'acct',
          async () => {
            const content = await fs.readFile(lockPath, 'utf8');
            expect(content).not.toContain('child-owner');
            expect(content).toContain(String(process.pid));
            return 'parent-recovered';
          },
          { waitMs: 2_000 },
        );
        expect(result2).toBe('parent-recovered');
      });
    },
  );
});
