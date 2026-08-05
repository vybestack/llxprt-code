/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the discarded "Always Allow" grant heuristic
 * (issue #3020).
 *
 * The leaf module correlates by credential: a discarded-grant event is counted
 * only on a SECOND interactive-length successful read of the SAME credential
 * that began at or after the first completed. Overlapping reads and reads of
 * different credentials prove nothing. This suite verifies the leaf module's
 * contract, its wiring into the default keyring adapter, and its surface on
 * SecureStore.
 *
 * Leaf-module cases pass the observation objects directly (the startedAt /
 * endedAt are explicit monotonic-clock values), so no clock is mocked there.
 * Adapter-level cases exercise the production timing path: the adapter times
 * the native read with `performance.now()`, so a controllable `performance.now`
 * (layered over the real one) makes a read appear to exceed the threshold
 * without real sleeping. The real clock is restored in afterEach.
 *
 * @plan PLAN-20260805-ISSUE3020
 */

import { beforeEach, afterEach, describe, expect, it, mock } from 'bun:test';
import type { KeyringAdapter } from '../src/secure-store/secure-store.js';
import {
  INTERACTIVE_AUTH_THRESHOLD_MS,
  recordAuthorizedKeyringRead,
  isKeychainGrantPersistenceBroken,
  resetKeychainGrantPersistenceForTesting,
  setKeychainGrantPersistencePlatformForTesting,
} from '../src/secure-store/keychain-grant-persistence.js';
import type { KeyringReadObservation } from '../src/secure-store/keychain-grant-persistence.js';
import { createDefaultKeyringAdapter } from '../src/secure-store/default-keyring-adapter.js';
import { SecureStore } from '../src/secure-store/secure-store.js';
import { resetRuntimeIdentityForTesting } from '../src/secure-store/runtime-identity.js';
import { resetRuntimeReplacedWarningForTesting } from '../src/secure-store/runtime-replaced-errors.js';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ─── Controllable clock (adapter-level timing) ──────────────────────────────
//
// The adapter times a read as `performance.now()` snapshots around the native
// call. To make a read appear to exceed the interactive-auth threshold without
// real sleeping, the fake read advances `clockNow` (layered over the real
// performance.now) before it resolves. The real performance.now is restored in
// afterEach so process-wide timing outside these tests stays accurate.

const realPerformanceNow: typeof performance.now =
  performance.now.bind(performance);
let clockNow = 0;

function installControllableClock(): void {
  clockNow = 0;
  performance.now = (): number => clockNow;
}

function restoreRealClock(): void {
  performance.now = realPerformanceNow;
  clockNow = 0;
}

function advanceClock(ms: number): void {
  clockNow += ms;
}

/** Builds an observation with explicit monotonic-clock start/end values. */
function obs(
  credentialKey: string,
  startedAt: number,
  endedAt: number,
): KeyringReadObservation {
  return { credentialKey, startedAt, endedAt };
}

// ─── Fake @napi-rs/keyring (boundary double) ────────────────────────────────
//
// Same technique as test-bun/keyring-delete-verification.bun.ts: bun's
// mock.module intercepts the dynamic import for this isolated process (one
// process per file). The fake read's apparent wall-clock cost and return value
// are independently controllable, so a slow successful read, a slow null, and a
// slow rejection can all be staged.

interface FakeKeyringController {
  readonly entries: Map<string, string>;
  /** Monotonic ms the fake read appears to take (drives the controllable clock). */
  readDurationMs: number;
  /** When set, getPassword() rejects with this error. */
  getPasswordError: Error | null;
}

function createFreshController(): FakeKeyringController {
  return {
    entries: new Map(),
    readDurationMs: 0,
    getPasswordError: null,
  };
}

function compositeKey(service: string, account: string): string {
  return `${service}\u0000${account}`;
}

let controller: FakeKeyringController = createFreshController();

mock.module('@napi-rs/keyring', () => ({
  AsyncEntry: class {
    constructor(
      private readonly service: string,
      private readonly account: string,
    ) {}

    async getPassword(): Promise<string | null> {
      if (controller.getPasswordError !== null) {
        throw controller.getPasswordError;
      }
      // Advance the controllable clock BEFORE resolving, so the adapter's
      // performance.now() snapshots reflect an interactive-authorization window.
      if (controller.readDurationMs > 0) {
        advanceClock(controller.readDurationMs);
      }
      return (
        controller.entries.get(compositeKey(this.service, this.account)) ?? null
      );
    }

    async deleteCredential(): Promise<boolean> {
      return false;
    }
  },
}));

// ─── stderr capture ─────────────────────────────────────────────────────────
//
// The once-per-process warning is written via process.stderr.write. To assert
// on its text (and the once-per-process guarantee) without spy-invocation
// counting, the real write is swapped for a capturing function and restored in
// afterEach.

let realStderrWrite: typeof process.stderr.write | null = null;
let capturedStderr = '';

function startStderrCapture(): void {
  realStderrWrite = process.stderr.write;
  capturedStderr = '';
  process.stderr.write = (chunk: unknown): boolean => {
    capturedStderr += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  };
}

function stopStderrCapture(): void {
  if (realStderrWrite !== null) {
    process.stderr.write = realStderrWrite;
    realStderrWrite = null;
  }
}

function resetLeafState(): void {
  resetKeychainGrantPersistenceForTesting();
  setKeychainGrantPersistencePlatformForTesting(null);
}

async function loadAdapter(): Promise<KeyringAdapter> {
  const adapter = await createDefaultKeyringAdapter();
  if (adapter === null) {
    throw new Error(
      'createDefaultKeyringAdapter returned null — fake @napi-rs/keyring mock did not load',
    );
  }
  return adapter;
}

/** Strictly above the threshold, so a read of this duration counts as an event. */
const SLOW = INTERACTIVE_AUTH_THRESHOLD_MS + 500;

// ─── Leaf module (direct observations) ──────────────────────────────────────

/**
 * @plan PLAN-20260805-ISSUE3020
 */
describe('keychain-grant-persistence leaf module (issue #3020)', () => {
  beforeEach(() => {
    resetKeychainGrantPersistenceForTesting();
    setKeychainGrantPersistencePlatformForTesting('darwin');
  });
  afterEach(() => {
    stopStderrCapture();
    resetLeafState();
  });

  it('one slow successful read does not flip the predicate (case 1)', () => {
    recordAuthorizedKeyringRead(obs('cred-a', 0, SLOW));
    expect(isKeychainGrantPersistenceBroken()).toBe(false);
  });

  it('two slow sequential reads of the same credential flip the predicate and emit one warning block (case 2)', () => {
    startStderrCapture();
    // First interactive authorization for cred-a.
    recordAuthorizedKeyringRead(obs('cred-a', 0, SLOW));
    // Second began at or after the first completed (SLOW >= SLOW).
    recordAuthorizedKeyringRead(obs('cred-a', SLOW, 2 * SLOW));

    expect(isKeychainGrantPersistenceBroken()).toBe(true);
    // The warning describes the observation, references #3020, and names both
    // remedies (Oven-signed Bun and LLXPRT_DISABLE_OS_KEYRING).
    expect(capturedStderr).toContain('not persisting');
    expect(capturedStderr).toContain('#3020');
    expect(capturedStderr).toContain('oven-sh/bun/bun');
    expect(capturedStderr).toContain('LLXPRT_DISABLE_OS_KEYRING');
  });

  it('third and fourth slow reads keep the predicate true and never repeat the warning (case 3)', () => {
    startStderrCapture();
    recordAuthorizedKeyringRead(obs('cred-a', 0, SLOW));
    recordAuthorizedKeyringRead(obs('cred-a', SLOW, 2 * SLOW));
    const afterSecond = capturedStderr;
    expect(isKeychainGrantPersistenceBroken()).toBe(true);

    recordAuthorizedKeyringRead(obs('cred-a', 2 * SLOW, 3 * SLOW));
    recordAuthorizedKeyringRead(obs('cred-a', 3 * SLOW, 4 * SLOW));

    // Once-per-process: the captured stderr text is byte-for-byte unchanged
    // after further slow reads — asserted on the text, not a call counter.
    expect(capturedStderr).toBe(afterSecond);
    expect(isKeychainGrantPersistenceBroken()).toBe(true);
  });

  it('a duration exactly at the threshold never counts, even twice (case 4)', () => {
    recordAuthorizedKeyringRead(
      obs('cred-a', 0, INTERACTIVE_AUTH_THRESHOLD_MS),
    );
    recordAuthorizedKeyringRead(
      obs(
        'cred-a',
        INTERACTIVE_AUTH_THRESHOLD_MS,
        2 * INTERACTIVE_AUTH_THRESHOLD_MS,
      ),
    );
    expect(isKeychainGrantPersistenceBroken()).toBe(false);
  });

  it('many fast reads never flip the predicate (case 5)', () => {
    let t = 0;
    for (let i = 0; i < 20; i++) {
      recordAuthorizedKeyringRead(obs('cred-a', t, t + 10));
      t += 10;
    }
    expect(isKeychainGrantPersistenceBroken()).toBe(false);
  });

  it('a non-darwin platform never observes, regardless of durations (case 6)', () => {
    setKeychainGrantPersistencePlatformForTesting('linux');
    startStderrCapture();
    let t = 0;
    for (let i = 0; i < 10; i++) {
      recordAuthorizedKeyringRead(obs('cred-a', t, t + SLOW));
      t += SLOW;
    }
    expect(isKeychainGrantPersistenceBroken()).toBe(false);
    expect(capturedStderr).toBe('');
  });

  it('two slow reads of DIFFERENT credentials never flip the predicate (case 7)', () => {
    startStderrCapture();
    recordAuthorizedKeyringRead(obs('cred-a', 0, SLOW));
    recordAuthorizedKeyringRead(obs('cred-b', SLOW, 2 * SLOW));
    expect(isKeychainGrantPersistenceBroken()).toBe(false);
    expect(capturedStderr).toBe('');
  });

  it('two slow reads of the same credential that OVERLAP never flip the predicate (case 8)', () => {
    startStderrCapture();
    // First read: [0, SLOW). Second read begins at SLOW/2, before the first
    // completed — a concurrent first read that proves nothing.
    recordAuthorizedKeyringRead(obs('cred-a', 0, SLOW));
    recordAuthorizedKeyringRead(obs('cred-a', SLOW / 2, SLOW + SLOW / 2));
    expect(isKeychainGrantPersistenceBroken()).toBe(false);
    expect(capturedStderr).toBe('');
  });

  it('a third credential first interactive read after the state is broken leaves stderr unchanged (case 9)', () => {
    startStderrCapture();
    recordAuthorizedKeyringRead(obs('cred-a', 0, SLOW));
    recordAuthorizedKeyringRead(obs('cred-a', SLOW, 2 * SLOW));
    const afterBreak = capturedStderr;
    expect(isKeychainGrantPersistenceBroken()).toBe(true);

    // State is terminal; a brand-new credential's first read does no work.
    recordAuthorizedKeyringRead(obs('cred-c', 2 * SLOW, 3 * SLOW));

    expect(isKeychainGrantPersistenceBroken()).toBe(true);
    expect(capturedStderr).toBe(afterBreak);
  });
});

// ─── Adapter-level wiring ───────────────────────────────────────────────────

/**
 * @plan PLAN-20260805-ISSUE3020
 */
describe('createDefaultKeyringAdapter getPassword — grant persistence timing (issue #3020)', () => {
  beforeEach(() => {
    resetKeychainGrantPersistenceForTesting();
    setKeychainGrantPersistencePlatformForTesting('darwin');
    resetRuntimeIdentityForTesting();
    resetRuntimeReplacedWarningForTesting();
    installControllableClock();
    startStderrCapture();
    controller = createFreshController();
  });
  afterEach(() => {
    restoreRealClock();
    stopStderrCapture();
    resetLeafState();
    resetRuntimeIdentityForTesting();
    resetRuntimeReplacedWarningForTesting();
  });

  it('two slow sequential successful reads of the same service+account flip the predicate and still return the value (case 10)', async () => {
    controller.readDurationMs = SLOW;
    controller.entries.set(compositeKey('svc', 'acct'), 'the-secret');
    const adapter = await loadAdapter();

    // The diagnostic must not break credential access: the value is returned
    // on both reads.
    expect(await adapter.getPassword('svc', 'acct')).toBe('the-secret');
    expect(await adapter.getPassword('svc', 'acct')).toBe('the-secret');
    expect(isKeychainGrantPersistenceBroken()).toBe(true);
  });

  it('two slow reads of DIFFERENT accounts on the same service never flip the predicate (case 11)', async () => {
    controller.readDurationMs = SLOW;
    controller.entries.set(compositeKey('svc', 'acct-a'), 'secret-a');
    controller.entries.set(compositeKey('svc', 'acct-b'), 'secret-b');
    const adapter = await loadAdapter();

    expect(await adapter.getPassword('svc', 'acct-a')).toBe('secret-a');
    expect(await adapter.getPassword('svc', 'acct-b')).toBe('secret-b');
    expect(isKeychainGrantPersistenceBroken()).toBe(false);
  });

  it('slow reads resolving null never flip the predicate (case 12)', async () => {
    controller.readDurationMs = SLOW;
    const adapter = await loadAdapter();

    expect(await adapter.getPassword('svc', 'missing')).toBeNull();
    expect(await adapter.getPassword('svc', 'missing')).toBeNull();
    expect(isKeychainGrantPersistenceBroken()).toBe(false);
  });

  it('slow reads that reject propagate the rejection and never flip the predicate (case 13)', async () => {
    controller.readDurationMs = SLOW;
    controller.getPasswordError = new Error('keychain read failed');
    const adapter = await loadAdapter();

    await expect(adapter.getPassword('svc', 'acct')).rejects.toThrow(
      'keychain read failed',
    );
    await expect(adapter.getPassword('svc', 'acct')).rejects.toThrow(
      'keychain read failed',
    );
    expect(isKeychainGrantPersistenceBroken()).toBe(false);
  });
});

// ─── SecureStore surface (case 14) ──────────────────────────────────────────

/**
 * @plan PLAN-20260805-ISSUE3020
 */
describe('SecureStore — grant persistence surface (issue #3020)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'grant-persistence-'));
    resetKeychainGrantPersistenceForTesting();
    setKeychainGrantPersistencePlatformForTesting('darwin');
    resetRuntimeIdentityForTesting();
    resetRuntimeReplacedWarningForTesting();
    installControllableClock();
    startStderrCapture();
    controller = createFreshController();
  });
  afterEach(async () => {
    restoreRealClock();
    stopStderrCapture();
    resetLeafState();
    resetRuntimeIdentityForTesting();
    resetRuntimeReplacedWarningForTesting();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('after the second slow get() the store reports broken and returned the value both times (case 14)', async () => {
    controller.readDurationMs = SLOW;
    controller.entries.set(
      compositeKey('test-svc', 'token'),
      'the-token-value',
    );
    // The adapter produced by createDefaultKeyringAdapter (which loads the
    // faked @napi-rs/keyring) carries the read-timing instrumentation. Inject
    // it via keyringLoader so the full SecureStore read path is exercised.
    const adapter = await loadAdapter();
    const store = new SecureStore('test-svc', {
      keyringLoader: async () => adapter,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    expect(await store.get('token')).toBe('the-token-value');
    expect(await store.get('token')).toBe('the-token-value');
    expect(store.isKeychainGrantPersistenceBroken()).toBe(true);
  });
});
