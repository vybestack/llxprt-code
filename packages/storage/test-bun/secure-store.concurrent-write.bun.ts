/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Acceptance test for issue #2927 (R5): two independently constructed
 * SecureStore instances writing different values to the same key against a
 * shared fake keyring adapter that counts every deletePassword.
 *
 * M3: The test instruments the shared fake keyring to detect OVERLAPPING
 * critical sections between the two stores using a monotonic logical clock
 * (not wall-clock timestamps), so overlap detection is resolution-independent
 * and deterministic.
 *
 * - POSITIVE test (shared lock dir): the lock serializes writes, so the
 *   monotonic-clock event sequence is nested (no interleave). Deterministic.
 *
 * - NEGATIVE CONTROL (disjoint lock dirs): a barrier in the keyring FORCES
 *   both setPassword calls to enter before either can exit, guaranteeing
 *   overlap regardless of async scheduling. This proves the positive
 *   assertion genuinely detects the lock — if the lock broke, the barrier
 *   would deadlock (test timeout), not pass silently.
 *
 * NOTE: this file asserts in-process serialization only. The real
 * cross-OS-process coverage lives in credential-write-lock.bun.ts, which
 * spawns a genuine child process that writes a canonical owner record. This test
 * instead verifies that two in-process SecureStore instances with independent
 * CredentialWriteLock instances (distinct owner tokens) serialize through the
 * shared filesystem lock dir.
 *
 * @plan PLAN-20260801-ISSUE2927
 * @requirement R5
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SecureStore,
  type KeyringAdapter,
} from '../src/secure-store/secure-store.js';

function isErrorWithCode(value: unknown): value is { code: string } {
  if (typeof value !== 'object' || value === null || !('code' in value)) {
    return false;
  }
  return typeof value.code === 'string';
}

function extractErrorCode(reason: unknown): string {
  return isErrorWithCode(reason) ? reason.code : '__no_code__';
}

/**
 * A logical-clock event emitted by the instrumented keyring. The clock is a
 * monotonic counter incremented on every event, so event ordering is
 * resolution-independent (unlike Date.now() which has millisecond
 * granularity). Two critical sections overlap if and only if their enter/exit
 * events interleave (e.g. enter-A, enter-B, exit-A, exit-B). If they are
 * serialized, the sequence is nested: enter-A, exit-A, enter-B, exit-B.
 *
 * O11: The storeId is derived deterministically from the value being written
 * (the password), not from a shared FIFO queue. The FIFO approach assigned
 * tags in source order but consumed them in lock-acquisition order, which
 * could misattribute events to the wrong store.
 */
interface CriticalSectionEvent {
  readonly storeId: string;
  readonly phase: 'enter' | 'exit';
  readonly clock: number;
}

/**
 * Extracts a deterministic store identity from the value being written. The
 * tests write values like 'value-from-A' and 'value-from-B', so the suffix
 * after the last '-' identifies the originating store.
 */
function storeIdFromValue(value: string): string {
  const dashIndex = value.lastIndexOf('-');
  return dashIndex >= 0 ? value.substring(dashIndex + 1) : value;
}

/**
 * A fake keyring adapter that records every operation AND tracks
 * setPassword critical section boundaries via a monotonic logical clock.
 * Under the shared lock, setPassword calls from different stores must NEVER
 * interleave (serialize). Used for the POSITIVE assertion test.
 */
function createInstrumentedKeyring(): KeyringAdapter & {
  store: Map<string, string>;
  readonly deleteCount: number;
  readonly setCount: number;
  readonly getCount: number;
  readonly events: CriticalSectionEvent[];
} {
  const store = new Map<string, string>();
  let deleteCount = 0;
  let setCount = 0;
  let getCount = 0;
  let clock = 0;
  const events: CriticalSectionEvent[] = [];
  return {
    store,
    get deleteCount(): number {
      return deleteCount;
    },
    get setCount(): number {
      return setCount;
    },
    get getCount(): number {
      return getCount;
    },
    get events(): CriticalSectionEvent[] {
      return events;
    },
    getPassword: async (_service: string, account: string) => {
      getCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return store.get(account) ?? null;
    },
    setPassword: async (
      _service: string,
      account: string,
      password: string,
    ) => {
      setCount += 1;
      // O11: Derive storeId deterministically from the value being written,
      // not from a shared FIFO queue.
      const storeId = storeIdFromValue(password);
      events.push({ storeId, phase: 'enter', clock: clock++ });
      await new Promise((resolve) => setTimeout(resolve, 10));
      store.set(account, password);
      events.push({ storeId, phase: 'exit', clock: clock++ });
    },
    deletePassword: async (_service: string, account: string) => {
      deleteCount += 1;
      return store.delete(account);
    },
  };
}

/**
 * A gated keyring that forces setPassword calls to overlap via a barrier.
 * Every setPassword caller records 'enter', increments the entered count,
 * and waits until ALL expected callers have entered before recording 'exit'.
 * This guarantees deterministic overlap regardless of async scheduling, and
 * deadlocks if the lock serializes the callers (which is the point — it
 * proves the negative control would detect a broken lock). Used only for the
 * NEGATIVE CONTROL test where disjoint lock dirs allow concurrent entry.
 *
 * O8: The barrier is bounded by a timeout so that if a caller rejects before
 * reaching setPassword (e.g. because set() threw early), the barrier fails
 * fast with an explicit message instead of hanging until the test-runner timeout.
 *
 * O11: StoreId is derived deterministically from the value being written.
 */
function createBarrierKeyring(expectedCallers: number): KeyringAdapter & {
  store: Map<string, string>;
  readonly deleteCount: number;
  readonly setCount: number;
  readonly events: CriticalSectionEvent[];
} {
  const store = new Map<string, string>();
  let deleteCount = 0;
  let setCount = 0;
  let clock = 0;
  let entered = 0;
  const events: CriticalSectionEvent[] = [];
  let barrierResolve!: (value: void) => void;
  let barrierReject!: (reason: Error) => void;
  const barrierPromise = new Promise<void>((resolve, reject) => {
    barrierResolve = resolve;
    barrierReject = reject;
  });
  // O8: Bound the barrier with a timeout. If not all expected callers enter
  // within this window, fail fast with a clear message instead of hanging.
  const barrierTimeoutMs = 2_000;
  const barrierTimer = setTimeout(() => {
    barrierReject(
      new Error(
        `Barrier timed out after ${barrierTimeoutMs}ms: only ${entered}/${expectedCallers} callers entered setPassword (a caller may have rejected before reaching it)`,
      ),
    );
  }, barrierTimeoutMs);
  return {
    store,
    get deleteCount(): number {
      return deleteCount;
    },
    get setCount(): number {
      return setCount;
    },
    get events(): CriticalSectionEvent[] {
      return events;
    },
    getPassword: async (_service: string, account: string) =>
      store.get(account) ?? null,
    setPassword: async (
      _service: string,
      account: string,
      password: string,
    ) => {
      setCount += 1;
      // O11: Derive storeId deterministically from the value being written.
      const storeId = storeIdFromValue(password);
      events.push({ storeId, phase: 'enter', clock: clock++ });
      entered += 1;
      // Release the barrier once all expected callers have entered.
      if (entered >= expectedCallers) {
        clearTimeout(barrierTimer);
        barrierResolve();
      }
      // Wait for all callers to have entered before proceeding to exit.
      await barrierPromise;
      store.set(account, password);
      events.push({ storeId, phase: 'exit', clock: clock++ });
    },
    deletePassword: async (_service: string, account: string) => {
      deleteCount += 1;
      return store.delete(account);
    },
  };
}

/**
 * Checks whether any pair of critical sections from DIFFERENT stores
 * interleave (overlap). Two sections overlap if one starts after the other
 * starts but before the other ends — i.e. the event sequence interleaves
 * rather than nesting. This is computed from the monotonic logical clock,
 * NOT from wall-clock timestamps, so it is deterministic regardless of
 * timing resolution.
 *
 * O7: Accumulates a list of {enter, exit} windows per store rather than
 * collapsing to a single window, so repeated enter/exit pairs for the same
 * store do not corrupt the overlap analysis.
 */
interface StoreWindow {
  readonly storeId: string;
  readonly enter: number;
  readonly exit: number;
}

/** Pairs each `exit` event with its matching open `enter` for the same store. */
function collectWindows(events: CriticalSectionEvent[]): StoreWindow[] {
  const windows: StoreWindow[] = [];
  const openEnter = new Map<string, number>();
  for (const event of events) {
    const enter = openEnter.get(event.storeId);
    if (event.phase === 'enter') {
      openEnter.set(event.storeId, event.clock);
    } else if (enter !== undefined) {
      openEnter.delete(event.storeId);
      windows.push({ storeId: event.storeId, enter, exit: event.clock });
    }
  }
  return windows;
}

function overlaps(a: StoreWindow, b: StoreWindow): boolean {
  return a.enter < b.exit && b.enter < a.exit;
}

function anyInterleave(events: CriticalSectionEvent[]): boolean {
  const windows = collectWindows(events);
  return windows.some((a, index) =>
    windows
      .slice(index + 1)
      .some((b) => b.storeId !== a.storeId && overlaps(a, b)),
  );
}

describe('SecureStore concurrent write acceptance (issue #2927, R5)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'secure-store-concurrent-'),
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('two instances sharing one lock dir produce zero deletions, one survivor, and non-overlapping critical sections', async () => {
    const keyring = createInstrumentedKeyring();
    const lockDir = path.join(tempDir, 'locks');

    const storeA = new SecureStore('test-service', {
      fallbackDir: path.join(tempDir, 'fb-a'),
      fallbackPolicy: 'allow',
      keyringLoader: async () => keyring,
      lockDir,
    });
    const storeB = new SecureStore('test-service', {
      fallbackDir: path.join(tempDir, 'fb-b'),
      fallbackPolicy: 'allow',
      keyringLoader: async () => keyring,
      lockDir,
    });

    const results = await Promise.allSettled([
      (async () => storeA.set('shared-key', 'value-from-A'))(),
      (async () => storeB.set('shared-key', 'value-from-B'))(),
    ]);

    // R5: zero deletions occurred.
    expect(keyring.deleteCount).toBe(0);

    // R5: exactly one value survives.
    const survivors = keyring.store.get('shared-key');
    expect(survivors).toBeDefined();
    expect(survivors === 'value-from-A' || survivors === 'value-from-B').toBe(
      true,
    );

    const winnerValue: string = survivors ?? '__none__';

    // Every rejection must be a CONFLICT.
    const rejectionCodes = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => extractErrorCode(r.reason));
    for (const code of rejectionCodes) {
      expect(code).toBe('CONFLICT');
    }

    // M3 PRIMARY ASSERTION: the critical sections must NOT interleave — the
    // lock serialized the two writes.
    expect(keyring.events.length).toBeGreaterThanOrEqual(4);
    expect(anyInterleave(keyring.events)).toBe(false);

    // R5: the surviving value is durable and readable from a fresh instance.
    const storeC = new SecureStore('test-service', {
      fallbackDir: path.join(tempDir, 'fb-c'),
      fallbackPolicy: 'allow',
      keyringLoader: async () => keyring,
      lockDir,
    });
    expect(await storeC.get('shared-key')).toBe(winnerValue);
  });

  it('NEGATIVE CONTROL: two instances with DIFFERENT lock dirs produce overlapping critical sections', async () => {
    // Use a barrier keyring that forces both setPassword calls to enter before
    // either can exit, guaranteeing deterministic overlap regardless of async
    // scheduling. With disjoint lock dirs, both stores acquire their own locks
    // concurrently and both enter setPassword — the barrier resolves and both
    // exit, producing interleaved events. If the lock broke (shared lock dir),
    // the barrier would deadlock because only one caller could enter, proving
    // the positive assertion genuinely detects the lock.
    const keyring = createBarrierKeyring(2);
    const lockDirA = path.join(tempDir, 'locks-a');
    const lockDirB = path.join(tempDir, 'locks-b');

    const storeA = new SecureStore('test-service', {
      fallbackDir: path.join(tempDir, 'fb-a'),
      fallbackPolicy: 'allow',
      keyringLoader: async () => keyring,
      lockDir: lockDirA,
    });
    const storeB = new SecureStore('test-service', {
      fallbackDir: path.join(tempDir, 'fb-b'),
      fallbackPolicy: 'allow',
      keyringLoader: async () => keyring,
      lockDir: lockDirB,
    });

    const setA = storeA.set.bind(storeA);
    const setB = storeB.set.bind(storeB);

    await Promise.allSettled([
      (async () => setA('shared-key', 'value-from-A'))(),
      (async () => setB('shared-key', 'value-from-B'))(),
    ]);

    // NEGATIVE CONTROL: with disjoint lock roots, the critical sections MUST
    // interleave (overlap) — this proves the primary assertion above is
    // genuinely detecting the lock and would fail if the lock were removed or
    // bypassed.
    expect(keyring.events.length).toBeGreaterThanOrEqual(4);
    expect(anyInterleave(keyring.events)).toBe(true);
  });
});
