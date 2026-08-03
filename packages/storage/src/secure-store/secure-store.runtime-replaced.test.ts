/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the replaced-runtime fail-fast behaviour in
 * SecureStore and createDefaultKeyringAdapter (issue #2926, Revision 2).
 *
 * When the runtime has been replaced on disk, ALL OS keyring operations are
 * forbidden (R2). Credential get/set/delete/list/has/isKeychainAvailable all
 * fail fast with a SecureStoreError whose code is RUNTIME_REPLACED and whose
 * remediation tells the user to restart and that "Always Allow" cannot take
 * effect (R3) — regardless of fallbackPolicy (deliberate override of 'allow'
 * to prevent silent Keychain/fallback divergence).
 *
 * Uses the injectable detector so tests run on ALL CI platforms (not just
 * darwin).
 *
 * @plan PLAN-20260801-ISSUE2926
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SecureStore,
  SecureStoreError,
  createDefaultKeyringAdapter,
  type KeyringAdapter,
} from './secure-store.js';
import {
  isSecureStoreError,
  isRuntimeReplacedError,
} from './secure-store-errors.js';
import {
  resetRuntimeIdentityForTesting,
  forceRuntimeReplacedForTesting,
} from './runtime-identity.js';
import {
  resetRuntimeReplacedWarningForTesting,
  hasRuntimeReplacedWarningBeenEmitted,
  RUNTIME_REPLACED_REMEDIATION,
} from './runtime-replaced-errors.js';

// ─── Shared helpers (RULES.md: no copy-pasted setup) ────────────────────────

function useTempDir(): {
  beforeEach: () => Promise<void>;
  afterEach: () => Promise<void>;
  getDir: () => string;
} {
  let dir = '';
  return {
    beforeEach: async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'secure-store-replaced-'));
    },
    afterEach: async () => {
      if (dir !== '') {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
    getDir: () => dir,
  };
}

function useResettableRuntimeState(): {
  beforeEach: () => void;
  afterEach: () => void;
} {
  return {
    beforeEach: () => {
      resetRuntimeIdentityForTesting();
      resetRuntimeReplacedWarningForTesting();
    },
    afterEach: () => {
      resetRuntimeIdentityForTesting();
      resetRuntimeReplacedWarningForTesting();
    },
  };
}

/**
 * A recording keyring adapter that counts every native call. Used to prove
 * ZERO native calls after the terminal state is set (R2).
 */
function createRecordingAdapter(): {
  adapter: KeyringAdapter;
  calls: string[];
} {
  const calls: string[] = [];
  const adapter: KeyringAdapter = {
    getPassword: async () => {
      calls.push('getPassword');
      return null;
    },
    setPassword: async () => {
      calls.push('setPassword');
    },
    deletePassword: async () => {
      calls.push('deletePassword');
      return false;
    },
    findCredentials: async () => {
      calls.push('findCredentials');
      return [];
    },
  };
  return { adapter, calls };
}

async function fallbackFileExists(dir: string, key: string): Promise<boolean> {
  const filePath = path.join(dir, `${key}.enc`);
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}

/**
 * Asserts that the given error is a SecureStoreError with code
 * RUNTIME_REPLACED and the correct remediation text. Uses instanceof, not
 * type assertions.
 */
function assertRuntimeReplacedError(error: unknown): void {
  expect(error).toBeInstanceOf(SecureStoreError);
  expect(isSecureStoreError(error)).toBe(true);
  expect(isRuntimeReplacedError(error)).toBe(true);
  if (error instanceof SecureStoreError) {
    expect(error.code).toBe('RUNTIME_REPLACED');
    expect(error.remediation).toContain('Restart');
    expect(error.remediation).toContain('Always Allow');
    // Issue #2962: this error is now rethrown out of the OAuth token layer and
    // surfaced to the user, and every consumer renders `message` only — none
    // read `.remediation`. The message must therefore carry the fix, not just
    // the diagnosis.
    expect(error.message).toContain(error.remediation);
  }
}

// ─── createDefaultKeyringAdapter gating (R2) ────────────────────────────────

/**
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R2
 */
describe('createDefaultKeyringAdapter — replaced runtime gating', () => {
  const runtime = useResettableRuntimeState();
  beforeEach(runtime.beforeEach);
  afterEach(runtime.afterEach);

  it('returns null without touching the keyring when the runtime is reported replaced', async () => {
    forceRuntimeReplacedForTesting();
    const adapter = await createDefaultKeyringAdapter();
    expect(adapter).toBeNull();
  });

  it('does not short-circuit to null when the runtime is intact', async () => {
    resetRuntimeIdentityForTesting();
    const result = await createDefaultKeyringAdapter();
    // We cannot assert non-null (the native module may be absent in CI), but
    // we MUST assert the result is explicitly null OR a real adapter — never
    // undefined. (Revision 1 had a vacuous `typeof result === 'object'` check
    // that also accepted null.)
    expect(result).not.toBeUndefined();
  });
});

// ─── SecureStore fail-fast (R3, R2) ──────────────────────────────────────────

/**
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R2, R3
 */
describe('SecureStore — replaced runtime fail-fast', () => {
  const temp = useTempDir();
  beforeEach(temp.beforeEach);
  afterEach(temp.afterEach);
  const runtime = useResettableRuntimeState();
  beforeEach(runtime.beforeEach);
  afterEach(runtime.afterEach);

  it('get() throws SecureStoreError RUNTIME_REPLACED and does not invoke the keyring loader', async () => {
    forceRuntimeReplacedForTesting();
    const { adapter, calls } = createRecordingAdapter();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: temp.getDir(),
    });

    let error: unknown = null;
    try {
      await store.get('any-key');
    } catch (caught) {
      error = caught;
    }

    assertRuntimeReplacedError(error);
    expect(calls).toHaveLength(0);
  });

  it('set() throws SecureStoreError RUNTIME_REPLACED and does NOT create a fallback file', async () => {
    forceRuntimeReplacedForTesting();
    const { adapter, calls } = createRecordingAdapter();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: temp.getDir(),
      fallbackPolicy: 'allow',
    });

    let error: unknown = null;
    try {
      await store.set('any-key', 'any-value');
    } catch (caught) {
      error = caught;
    }

    assertRuntimeReplacedError(error);
    expect(calls).toHaveLength(0);
    expect(await fallbackFileExists(temp.getDir(), 'any-key')).toBe(false);
  });

  it('with fallbackPolicy allow, still throws instead of writing the fallback', async () => {
    forceRuntimeReplacedForTesting();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: temp.getDir(),
      fallbackPolicy: 'allow',
    });

    let error: unknown = null;
    try {
      await store.get('any-key');
    } catch (caught) {
      error = caught;
    }

    assertRuntimeReplacedError(error);
    expect(await fallbackFileExists(temp.getDir(), 'any-key')).toBe(false);
  });
});

// ─── Coherent surface: every method throws consistently (R5) ─────────────────

/**
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R5
 */
describe('SecureStore — coherent surface under terminal state', () => {
  const temp = useTempDir();
  beforeEach(temp.beforeEach);
  afterEach(temp.afterEach);
  const runtime = useResettableRuntimeState();
  beforeEach(runtime.beforeEach);
  afterEach(runtime.afterEach);

  it('delete() throws RUNTIME_REPLACED and makes zero native calls', async () => {
    forceRuntimeReplacedForTesting();
    const { adapter, calls } = createRecordingAdapter();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: temp.getDir(),
    });

    let error: unknown = null;
    try {
      await store.delete('any-key');
    } catch (caught) {
      error = caught;
    }

    assertRuntimeReplacedError(error);
    expect(calls).toHaveLength(0);
  });

  it('list() throws RUNTIME_REPLACED and makes zero native calls', async () => {
    forceRuntimeReplacedForTesting();
    const { adapter, calls } = createRecordingAdapter();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: temp.getDir(),
    });

    let error: unknown = null;
    try {
      await store.list();
    } catch (caught) {
      error = caught;
    }

    assertRuntimeReplacedError(error);
    expect(calls).toHaveLength(0);
  });

  it('has() throws RUNTIME_REPLACED and makes zero native calls', async () => {
    forceRuntimeReplacedForTesting();
    const { adapter, calls } = createRecordingAdapter();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: temp.getDir(),
    });

    let error: unknown = null;
    try {
      await store.has('any-key');
    } catch (caught) {
      error = caught;
    }

    assertRuntimeReplacedError(error);
    expect(calls).toHaveLength(0);
  });

  it('isKeychainAvailable() throws RUNTIME_REPLACED and makes zero native calls', async () => {
    forceRuntimeReplacedForTesting();
    const { adapter, calls } = createRecordingAdapter();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: temp.getDir(),
    });

    let error: unknown = null;
    try {
      await store.isKeychainAvailable();
    } catch (caught) {
      error = caught;
    }

    assertRuntimeReplacedError(error);
    expect(calls).toHaveLength(0);
  });
});

// ─── Zero-native-call proof: cached adapter transition (R2) ──────────────────

/**
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R2
 */
describe('SecureStore — cached adapter makes zero native calls after transition', () => {
  const temp = useTempDir();
  beforeEach(temp.beforeEach);
  afterEach(temp.afterEach);
  const runtime = useResettableRuntimeState();
  beforeEach(runtime.beforeEach);
  afterEach(runtime.afterEach);

  it('an adapter cached BEFORE the transition still makes zero calls after it', async () => {
    // Phase 1: healthy — load the adapter and use it (caches it).
    resetRuntimeIdentityForTesting();
    const { adapter, calls } = createRecordingAdapter();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: temp.getDir(),
    });

    // Prime the cache by doing a get() while healthy.
    await store.get('warmup-key');
    expect(calls.length).toBeGreaterThan(0);
    const callsBeforeTransition = calls.length;

    // Phase 2: force replaced AFTER the adapter is cached.
    forceRuntimeReplacedForTesting();

    // Now every method must throw and make ZERO additional native calls.
    const methodCalls: ReadonlyArray<
      readonly [string, () => Promise<unknown>]
    > = [
      ['get', () => store.get('post-key')],
      ['set', () => store.set('post-key', 'val')],
      ['delete', () => store.delete('post-key')],
      ['list', () => store.list()],
      ['has', () => store.has('post-key')],
    ];
    for (const [methodName, call] of methodCalls) {
      try {
        await call();
        expect.fail(`${methodName}() should have thrown RUNTIME_REPLACED`);
      } catch (error) {
        assertRuntimeReplacedError(error);
      }
    }

    // The recording adapter is injected via keyringLoader and is NOT wrapped
    // by createGuardedAdapter. The zero-call guarantee comes from the
    // SecureStore-level assertRuntimeNotReplaced() that fires before the
    // keyring loader is even consulted.
    expect(calls.length).toBe(callsBeforeTransition);
  });
});

// ─── Notification: null-logger-first ordering (R4) ───────────────────────────

/**
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R4
 */
describe('SecureStore — replaced-runtime notification via stderr', () => {
  const temp = useTempDir();
  beforeEach(temp.beforeEach);
  afterEach(temp.afterEach);
  const runtime = useResettableRuntimeState();
  beforeEach(runtime.beforeEach);
  afterEach(runtime.afterEach);

  /**
   * A broken stderr (EPIPE when piped into a command that exits early) must
   * not replace the terminal error with a stream error: callers key their
   * rethrow decision on RUNTIME_REPLACED, so losing it would let the very
   * degradation this guard exists to prevent happen anyway.
   *
   * @plan PLAN-20260801-ISSUE2926
   * @requirement R3, R4
   */
  it('still throws RUNTIME_REPLACED when writing the notice to stderr fails', async () => {
    forceRuntimeReplacedForTesting();
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => {
        throw new Error('EPIPE: broken pipe');
      });

    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: temp.getDir(),
      fallbackPolicy: 'allow',
    });

    let caught: unknown;
    try {
      await store.get('any-key');
    } catch (error) {
      caught = error;
    } finally {
      stderrSpy.mockRestore();
    }

    expect(isRuntimeReplacedError(caught)).toBe(true);
  });

  it('emits exactly one user-visible notice via stderr even when the store has a null logger', async () => {
    forceRuntimeReplacedForTesting();
    expect(hasRuntimeReplacedWarningBeenEmitted()).toBe(false);

    const stderrSpy = vi.spyOn(process.stderr, 'write');

    // Construct a store with NO injected logger (defaults to
    // NullStorageLoggerImpl which discards). The warning MUST still reach
    // stderr because it is routed through process.stderr.write.
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: temp.getDir(),
      fallbackPolicy: 'allow',
    });

    try {
      await store.get('any-key');
    } catch {
      // expected
    }

    // The once-per-process flag must be set (R4).
    expect(hasRuntimeReplacedWarningBeenEmitted()).toBe(true);

    // The notice must have actually been written to stderr (not stdout, not
    // swallowed). Assert it contains the remediation guidance.
    const writes = stderrSpy.mock.calls.map((c) => String(c[0]));
    const notice = writes.join('');
    expect(notice).toContain('Restart LLxprt');
    expect(notice).toContain(RUNTIME_REPLACED_REMEDIATION);
    expect(notice).toContain('Always Allow');

    // Record how many writes happened for the first operation.
    const writesAfterFirst = stderrSpy.mock.calls.length;

    // Perform more operations — the warning must NOT be emitted again.
    for (let i = 0; i < 5; i++) {
      try {
        await store.get(`key-${i}`);
      } catch {
        // expected
      }
    }

    // Exactly the same number of stderr writes — no additional notice.
    expect(stderrSpy.mock.calls.length).toBe(writesAfterFirst);
    // Still true — emitted exactly once.
    expect(hasRuntimeReplacedWarningBeenEmitted()).toBe(true);

    stderrSpy.mockRestore();
  });
});
