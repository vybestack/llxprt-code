/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #2928: distinguish Keychain denial from absence,
 * degrade once, and allow an OS keyring opt-out.
 *
 * R1 — error fidelity: user-cancellation classifies as DENIED (not swallowed
 *      as UNAVAILABLE); NOT_FOUND/UNAVAILABLE still degrade. Classification narrows the
 *      cancellation test so abort/timeout text does NOT latch.
 * R2 — one process-wide latch enforced at the adapter boundary: the first
 *      DENIED/LOCKED latches the keyring unusable for the process with exactly
 *      one stderr warning; TIMEOUT and UNAVAILABLE do not latch;
 *      RUNTIME_REPLACED is not absorbed and does not latch.
 * R3 — explicit opt-out: LLXPRT_DISABLE_OS_KEYRING=1 and the settings
 *      equivalent disable the keyring; a v:2 envelope written with a
 *      file-resident machine secret round-trips through disabled mode.
 *
 * All assertions are on observable behaviour (returned values, thrown codes,
 * file contents/modes). A counting adapter is used where "zero keyring
 * operations" is itself the specification.
 *
 * @plan PLAN-20260805-ISSUE2928
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import {
  SecureStore,
  SecureStoreError,
  createDefaultKeyringAdapter,
  type KeyringAdapter,
} from '../src/secure-store/secure-store.js';
import { createGuardedAdapter } from '../src/secure-store/default-keyring-adapter.js';
import {
  resetOsKeyringSessionForTesting,
  hasOsKeyringWarningBeenEmitted,
  setOsKeyringDisabledBySetting,
  isOsKeyringSessionDisabled,
  OS_KEYRING_UNUSABLE_MESSAGE,
  OS_KEYRING_UNUSABLE_REMEDIATION,
} from '../src/secure-store/keyring-session-state.js';
import { runtimeReplacedError } from '../src/secure-store/runtime-replaced-errors.js';
import {
  getMachineSecret,
  resetMachineSecretCache,
} from '../src/secure-store/machine-secret.js';

const SERVICE = 'keyring-session-2928';
const OPT_OUT_ENV = 'LLXPRT_DISABLE_OS_KEYRING';

// ─── Shared helpers (RULES.md: no copy-pasted setup) ────────────────────────

/**
 * Wires a temp fallback dir + machine-secret path for the enclosing describe.
 * Returns lazy accessors so each describe block gets isolated on-disk state
 * with one line of setup.
 */
function useTempDirs(): {
  fallbackDir: () => string;
  machineSecretPath: () => string;
  encExists: (key: string) => Promise<boolean>;
  machineSecretExists: () => Promise<boolean>;
} {
  let tempDir = '';
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'secure-store-keyring-session-'),
    );
    resetMachineSecretCache();
  });
  afterEach(async () => {
    resetMachineSecretCache();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
  return {
    fallbackDir: () => path.join(tempDir, 'fallback'),
    machineSecretPath: () => path.join(tempDir, 'machine_secret'),
    encExists: async (key: string) =>
      fileExists(path.join(tempDir, 'fallback', `${key}.enc`)),
    machineSecretExists: async () =>
      fileExists(path.join(tempDir, 'machine_secret')),
  };
}

/** Resets the process-wide OS keyring latch + opt-out between tests. */
function useResettableSessionState(): {
  beforeEach: () => void;
  afterEach: () => void;
} {
  return {
    beforeEach: () => {
      resetOsKeyringSessionForTesting();
      setOsKeyringDisabledBySetting(false);
    },
    afterEach: () => {
      resetOsKeyringSessionForTesting();
      setOsKeyringDisabledBySetting(false);
    },
  };
}

/** Saves, sets, and restores the opt-out env var around each test. */
function useOptOutEnv(): {
  set: (value: string) => void;
  clear: () => void;
  beforeEach: () => void;
  afterEach: () => void;
} {
  let saved: string | undefined;
  return {
    set: (value: string) => {
      process.env[OPT_OUT_ENV] = value;
    },
    // `delete`, not assignment: the production check reads
    // process.env[VAR] === '1', but leaving the key present with a literal
    // 'undefined' would still be observable to any existence check.
    clear: () => {
      delete process.env[OPT_OUT_ENV];
    },
    beforeEach: () => {
      saved = process.env[OPT_OUT_ENV];
      delete process.env[OPT_OUT_ENV];
    },
    afterEach: () => {
      if (saved === undefined) delete process.env[OPT_OUT_ENV];
      else process.env[OPT_OUT_ENV] = saved;
    },
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }
}

/** Adapter whose getPassword throws the supplied error. */
function adapterThrowingOnGet(error: Error): KeyringAdapter {
  return {
    getPassword: async () => {
      throw error;
    },
    setPassword: async () => {},
    deletePassword: async () => false,
  };
}

/** Adapter whose setPassword throws the supplied error. */
function adapterThrowingOnSet(error: Error): KeyringAdapter {
  return {
    getPassword: async () => null,
    setPassword: async () => {
      throw error;
    },
    deletePassword: async () => false,
  };
}

/** Adapter that counts every call — used only for zero-call assertions. */
function createCountingAdapter(): { adapter: KeyringAdapter; calls: string[] } {
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
  };
  return { adapter, calls };
}

/**
 * Wraps an existing adapter so each native method records its invocation. Used
 * to prove that under the opt-out flag the real factory short-circuits and no
 * native method is ever reached (if it were, calls would be non-empty).
 */
function wrapWithCallCount(
  inner: KeyringAdapter,
  calls: string[],
): KeyringAdapter {
  return {
    getPassword: async (service: string, account: string) => {
      calls.push('getPassword');
      return inner.getPassword(service, account);
    },
    setPassword: async (service: string, account: string, password: string) => {
      calls.push('setPassword');
      await inner.setPassword(service, account, password);
    },
    deletePassword: async (service: string, account: string) => {
      calls.push('deletePassword');
      return inner.deletePassword(service, account);
    },
  };
}

/** A fixed 32-byte machine secret for deterministic v:2 envelopes. */
function fixedMachineSecret(): Buffer {
  return crypto.randomBytes(32);
}

/** Narrows a thrown value to a SecureStoreError or fails the test loudly. */
function asSecureStoreError(error: unknown): SecureStoreError {
  if (error instanceof SecureStoreError) return error;
  throw new Error(`Expected SecureStoreError, got: ${String(error)}`);
}

// ─── R1: error fidelity ─────────────────────────────────────────────────────

/**
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R1.1
 */
describe('R1 — classifyError fidelity', () => {
  const temp = useTempDirs();
  const session = useResettableSessionState();
  beforeEach(session.beforeEach);
  afterEach(session.afterEach);

  // Case 1
  it('classifies "User canceled the operation." as DENIED on the read path (not swallowed)', async () => {
    const store = new SecureStore(SERVICE, {
      keyringLoader: async () =>
        adapterThrowingOnGet(new Error('User canceled the operation.')),
      fallbackDir: temp.fallbackDir(),
      fallbackPolicy: 'allow',
      machineSecretLoader: async () => null,
    });

    let error: unknown = null;
    try {
      await store.get('k');
    } catch (caught) {
      error = caught;
    }

    const e = asSecureStoreError(error);
    expect(e.code).toBe('DENIED');
  });

  // Case 2
  it('classifies errSecUserCanceled-worded and British "Cancelled" variants as DENIED', async () => {
    const messages = [
      'errSecUserCanceled: The operation was canceled.',
      'The user cancelled the request.',
    ];
    for (const message of messages) {
      resetOsKeyringSessionForTesting();
      const store = new SecureStore(SERVICE, {
        keyringLoader: async () => adapterThrowingOnGet(new Error(message)),
        fallbackDir: temp.fallbackDir(),
        fallbackPolicy: 'allow',
        machineSecretLoader: async () => null,
      });

      let error: unknown = null;
      try {
        await store.get('k');
      } catch (caught) {
        error = caught;
      }

      const e = asSecureStoreError(error);
      expect(e.code).toBe('DENIED');
    }
  });

  // Case 3
  it('a NOT_FOUND-worded read error still degrades to the fallback file (no regression)', async () => {
    const dir = temp.fallbackDir();
    const seeder = new SecureStore(SERVICE, {
      keyringLoader: async () => null,
      fallbackDir: dir,
      machineSecretLoader: async () => null,
    });
    await seeder.set('seed-key', 'seed-value');

    const store = new SecureStore(SERVICE, {
      keyringLoader: async () =>
        adapterThrowingOnGet(new Error('The item was not found.')),
      fallbackDir: dir,
      fallbackPolicy: 'allow',
      machineSecretLoader: async () => null,
    });

    const value = await store.get('seed-key');
    expect(value).toBe('seed-value');
  });

  // Case 4
  it('an UNAVAILABLE ("access platform storage") read error still degrades (no regression)', async () => {
    const dir = temp.fallbackDir();
    const seeder = new SecureStore(SERVICE, {
      keyringLoader: async () => null,
      fallbackDir: dir,
      machineSecretLoader: async () => null,
    });
    await seeder.set('seed-key', 'seed-value');

    const store = new SecureStore(SERVICE, {
      keyringLoader: async () =>
        adapterThrowingOnGet(
          new Error("Couldn't access platform storage: PermissionDenied"),
        ),
      fallbackDir: dir,
      fallbackPolicy: 'allow',
      machineSecretLoader: async () => null,
    });

    const value = await store.get('seed-key');
    expect(value).toBe('seed-value');
  });

  // Case 2a
  it('"The request was cancelled due to timeout." classifies as TIMEOUT, NOT DENIED, and does NOT latch', async () => {
    const dir = temp.fallbackDir();
    const store = new SecureStore(SERVICE, {
      keyringLoader: async () =>
        adapterThrowingOnSet(
          new Error('The request was cancelled due to timeout.'),
        ),
      fallbackDir: dir,
      fallbackPolicy: 'allow',
      machineSecretLoader: async () => null,
    });

    // A write that "times out" must fall back WITHOUT latching the session.
    await store.set('k', 'v');
    expect(isOsKeyringSessionDisabled()).toBe(false);

    // And a subsequent op must still reach the adapter (proves no latch).
    const { adapter, calls } = createCountingAdapter();
    const store2 = new SecureStore(SERVICE, {
      keyringLoader: async () => adapter,
      fallbackDir: dir,
      machineSecretLoader: async () => null,
    });
    await store2.get('k');
    expect(calls.length).toBeGreaterThan(0);
  });

  // Case 2b
  it('"User canceled the operation." DOES latch (genuine user cancellation)', async () => {
    const dir = temp.fallbackDir();
    const store = new SecureStore(SERVICE, {
      keyringLoader: async () =>
        adapterThrowingOnSet(new Error('User canceled the operation.')),
      fallbackDir: dir,
      fallbackPolicy: 'allow',
      machineSecretLoader: async () => null,
    });

    await store.set('k', 'v');
    expect(isOsKeyringSessionDisabled()).toBe(true);
  });
});

// ─── R2: one process-wide latch (enforced at the adapter boundary) ──────────

/**
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R2.1–R2.6
 */
describe('R2 — process-wide latch', () => {
  const temp = useTempDirs();
  const session = useResettableSessionState();
  beforeEach(session.beforeEach);
  afterEach(session.afterEach);

  // Case 5
  it('first DENIED from a write latches: a second get() on a NEW SecureStore performs zero adapter calls', async () => {
    const dir = temp.fallbackDir();
    const store1 = new SecureStore(SERVICE, {
      keyringLoader: async () =>
        adapterThrowingOnSet(
          new Error('The user denied the keychain request.'),
        ),
      fallbackDir: dir,
      fallbackPolicy: 'allow',
      machineSecretLoader: async () => null,
    });
    await store1.set('k', 'v');

    expect(isOsKeyringSessionDisabled()).toBe(true);

    const { adapter, calls } = createCountingAdapter();
    const store2 = new SecureStore(SERVICE, {
      keyringLoader: async () => adapter,
      fallbackDir: dir,
      machineSecretLoader: async () => null,
    });
    await store2.get('k');
    expect(calls).toHaveLength(0);
  });

  // Case 6
  it('emits exactly one stderr warning across three failing operations', async () => {
    const dir = temp.fallbackDir();
    const stderrSpy = vi.spyOn(process.stderr, 'write');

    // try/finally: an assertion or async rejection before mockRestore() would
    // otherwise leave the spy attached to process.stderr.write and pollute
    // every later test in this Bun process.
    try {
      const store = new SecureStore(SERVICE, {
        keyringLoader: async () =>
          adapterThrowingOnSet(new Error('Permission denied by user')),
        fallbackDir: dir,
        fallbackPolicy: 'allow',
        machineSecretLoader: async () => null,
      });

      for (let i = 0; i < 3; i++) {
        await store.set(`k${i}`, `v${i}`);
      }

      expect(hasOsKeyringWarningBeenEmitted()).toBe(true);
      const notice = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      const occurrences = notice.split(OS_KEYRING_UNUSABLE_MESSAGE).length - 1;
      expect(occurrences).toBe(1);
      expect(notice).toContain(OS_KEYRING_UNUSABLE_REMEDIATION);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  // Case 7
  it('after latch with fallbackPolicy allow, a SECOND op on a fresh counting adapter performs ZERO calls and round-trips through the fallback', async () => {
    const dir = temp.fallbackDir();
    const store = new SecureStore(SERVICE, {
      keyringLoader: async () =>
        adapterThrowingOnSet(new Error('The keychain access was denied.')),
      fallbackDir: dir,
      fallbackPolicy: 'allow',
      machineSecretLoader: async () => null,
    });

    // First write latches the session (DENIED) and falls back to the file.
    await store.set('roundtrip', 'secret-value');
    expect(await temp.encExists('roundtrip')).toBe(true);
    expect(isOsKeyringSessionDisabled()).toBe(true);

    // Second op: a FRESH counting adapter proves ZERO native entry post-latch.
    const { adapter, calls } = createCountingAdapter();
    const writer2 = new SecureStore(SERVICE, {
      keyringLoader: async () => adapter,
      fallbackDir: dir,
      fallbackPolicy: 'allow',
      machineSecretLoader: async () => null,
    });
    await writer2.set('roundtrip', 'updated-value');
    expect(calls).toHaveLength(0);

    // Round-trip still works via the encrypted fallback.
    const reader = new SecureStore(SERVICE, {
      keyringLoader: async () => null,
      fallbackDir: dir,
      machineSecretLoader: async () => null,
    });
    const value = await reader.get('roundtrip');
    expect(value).toBe('updated-value');
  });

  // Case 8
  it('after latch with fallbackPolicy deny, a SECOND op on a fresh counting adapter performs ZERO calls and throws UNAVAILABLE with remediation', async () => {
    const dir = temp.fallbackDir();
    const primer = new SecureStore(SERVICE, {
      keyringLoader: async () =>
        adapterThrowingOnSet(new Error('The user denied access.')),
      fallbackDir: dir,
      fallbackPolicy: 'deny',
      machineSecretLoader: async () => null,
    });
    // Prime the latch with the first (denied-policy) set, which throws.
    await expect(primer.set('k', 'v')).rejects.toBeDefined();
    expect(isOsKeyringSessionDisabled()).toBe(true);

    // Second op: a FRESH counting adapter — cannot pass merely by hitting the
    // same denied adapter again. Zero native entry post-latch.
    const { adapter, calls } = createCountingAdapter();
    const store2 = new SecureStore(SERVICE, {
      keyringLoader: async () => adapter,
      fallbackDir: dir,
      fallbackPolicy: 'deny',
      machineSecretLoader: async () => null,
    });

    let error: unknown = null;
    try {
      await store2.set('k2', 'v2');
    } catch (caught) {
      error = caught;
    }

    expect(calls).toHaveLength(0);
    const e = asSecureStoreError(error);
    // Post-latch the keyring is unavailable; the deny policy surfaces
    // UNAVAILABLE with a concrete remedy, not the original DENIED.
    expect(e.code).toBe('UNAVAILABLE');
    expect(e.remediation.length).toBeGreaterThan(0);
  });

  // Case 9
  it('TIMEOUT does NOT latch: a subsequent operation still calls the adapter', async () => {
    const dir = temp.fallbackDir();
    const store1 = new SecureStore(SERVICE, {
      keyringLoader: async () =>
        adapterThrowingOnSet(new Error('The operation timed out.')),
      fallbackDir: dir,
      fallbackPolicy: 'allow',
      machineSecretLoader: async () => null,
    });
    await store1.set('k', 'v');

    expect(isOsKeyringSessionDisabled()).toBe(false);

    const { adapter, calls } = createCountingAdapter();
    const store2 = new SecureStore(SERVICE, {
      keyringLoader: async () => adapter,
      fallbackDir: dir,
      machineSecretLoader: async () => null,
    });
    await store2.get('k');
    expect(calls.length).toBeGreaterThan(0);
  });

  // Case 10
  it('UNAVAILABLE does NOT latch: a subsequent operation still calls the adapter', async () => {
    const dir = temp.fallbackDir();
    const store1 = new SecureStore(SERVICE, {
      keyringLoader: async () =>
        adapterThrowingOnSet(
          new Error("Couldn't access platform storage: NoService"),
        ),
      fallbackDir: dir,
      fallbackPolicy: 'allow',
      machineSecretLoader: async () => null,
    });
    await store1.set('k', 'v');

    expect(isOsKeyringSessionDisabled()).toBe(false);

    const { adapter, calls } = createCountingAdapter();
    const store2 = new SecureStore(SERVICE, {
      keyringLoader: async () => adapter,
      fallbackDir: dir,
      machineSecretLoader: async () => null,
    });
    await store2.get('k');
    expect(calls.length).toBeGreaterThan(0);
  });

  // Case 11
  it('RUNTIME_REPLACED still propagates, does NOT latch, and is NOT converted to the UNAVAILABLE session error', async () => {
    const dir = temp.fallbackDir();
    const { adapter: healthy, calls } = createCountingAdapter();
    const store = new SecureStore(SERVICE, {
      keyringLoader: async () => adapterThrowingOnGet(runtimeReplacedError()),
      fallbackDir: dir,
      fallbackPolicy: 'allow',
      machineSecretLoader: async () => null,
    });

    let error: unknown = null;
    try {
      await store.get('k');
    } catch (caught) {
      error = caught;
    }

    const e = asSecureStoreError(error);
    expect(e.code).toBe('RUNTIME_REPLACED');
    // Must NOT be downgraded to the session UNAVAILABLE error.
    expect(e.code).not.toBe('UNAVAILABLE');
    // The latch must NOT have fired for a terminal RUNTIME_REPLACED error.
    expect(isOsKeyringSessionDisabled()).toBe(false);

    // A NEW store with a counting adapter must still reach native code —
    // proving RUNTIME_REPLACED did not latch the session.
    const store2 = new SecureStore(SERVICE, {
      keyringLoader: async () => healthy,
      fallbackDir: dir,
      machineSecretLoader: async () => null,
    });
    await store2.get('k');
    expect(calls.length).toBeGreaterThan(0);
  });
});

// ─── R2: latch enforced at the adapter boundary ────────────────────────────

/**
 * Proves the chokepoint (createGuardedAdapter, used by
 * createDefaultKeyringAdapter) enforces the latch for every consumer that
 * holds an adapter directly — the gap that SecureStore-only catch sites left.
 *
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R2.1, R2.3, R2.5
 */
describe('R2 — latch at the adapter boundary', () => {
  const session = useResettableSessionState();
  beforeEach(session.beforeEach);
  afterEach(session.afterEach);

  it('a guarded adapter held across a latch throws UNAVAILABLE BEFORE native entry (zero native calls)', async () => {
    const { adapter: counting, calls } = createCountingAdapter();
    const guarded = createGuardedAdapter(counting);

    // First call succeeds (no latch yet) — proves the adapter is wired through.
    await guarded.getPassword(SERVICE, 'a');
    expect(calls.length).toBeGreaterThan(0);

    // Latch the session (simulating a DENIED elsewhere in the process).
    setOsKeyringDisabledBySetting(true);

    // The held adapter's SECOND call must throw BEFORE entering native code.
    const callsBefore = calls.length;
    let error: unknown = null;
    try {
      await guarded.getPassword(SERVICE, 'a');
    } catch (caught) {
      error = caught;
    }
    expect(calls.length).toBe(callsBefore); // zero native entry post-latch
    const e = asSecureStoreError(error);
    expect(e.code).toBe('UNAVAILABLE');
    // The remediation names the concrete remedy (restart / clear opt-out).
    expect(e.remediation.toLowerCase()).toContain('restart');
  });

  it('an error raised through the guarded adapter latches the session even when the caller swallows it', async () => {
    const guarded = createGuardedAdapter(
      adapterThrowingOnGet(new Error('The user denied the keychain request.')),
    );

    expect(isOsKeyringSessionDisabled()).toBe(false);
    // Swallow the error, machine-secret-style (readFromKeyring catches).
    try {
      await guarded.getPassword(SERVICE, 'a');
    } catch {
      // swallowed
    }
    // The guard classified + latched via noteKeyringError regardless of the
    // caller swallowing it — the gap that SecureStore-only catch sites left.
    expect(isOsKeyringSessionDisabled()).toBe(true);
  });
});

// ─── R3: explicit opt-out ───────────────────────────────────────────────────

/**
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R3.1–R3.5
 */
describe('R3 — explicit opt-out', () => {
  const temp = useTempDirs();
  const session = useResettableSessionState();
  const env = useOptOutEnv();
  beforeEach(session.beforeEach);
  afterEach(session.afterEach);
  beforeEach(env.beforeEach);
  afterEach(env.afterEach);

  // Case 12
  it('LLXPRT_DISABLE_OS_KEYRING=1 makes createDefaultKeyringAdapter() resolve null', async () => {
    env.set('1');
    const adapter = await createDefaultKeyringAdapter();
    expect(adapter).toBeNull();
  });

  // Case 13
  it('with the flag set, a SecureStore set/get/delete round-trip uses the fallback file and the counting loader is never invoked', async () => {
    env.set('1');
    const dir = temp.fallbackDir();
    const { adapter, calls } = createCountingAdapter();
    const store = new SecureStore(SERVICE, {
      keyringLoader: async () => adapter,
      fallbackDir: dir,
      machineSecretLoader: async () => null,
    });

    await store.set('optout-key', 'optout-value');
    expect(await temp.encExists('optout-key')).toBe(true);

    const got = await store.get('optout-key');
    expect(got).toBe('optout-value');

    const deleted = await store.delete('optout-key');
    expect(deleted).toBe(true);

    expect(calls).toHaveLength(0);
  });

  // Case 14
  it('with the flag set, getMachineSecret() resolves from the file only with ZERO adapter/native calls', async () => {
    env.set('1');
    const secretPath = temp.machineSecretPath();

    // Counting keyringLoader: delegates to the real factory so the flag
    // short-circuit is exercised, and wraps any returned adapter to count
    // native method calls. Under the flag the factory returns null, so the
    // wrapper records zero calls — proving no OS keychain access. If the flag
    // short-circuit were deleted, the factory would return a real adapter and
    // these calls would be non-empty.
    const adapterCalls: string[] = [];
    const countingKeyringLoader = async (): Promise<KeyringAdapter | null> => {
      const real = await createDefaultKeyringAdapter();
      if (real === null) return null;
      return wrapWithCallCount(real, adapterCalls);
    };

    const first = await getMachineSecret({
      filePath: secretPath,
      keyringLoader: countingKeyringLoader,
    });
    expect(first).not.toBeNull();
    expect(await temp.machineSecretExists()).toBe(true);
    expect(adapterCalls).toHaveLength(0);

    const known = crypto.randomBytes(32).toString('base64');
    await fs.writeFile(secretPath, known, { mode: 0o600 });
    resetMachineSecretCache();
    const second = await getMachineSecret({
      filePath: secretPath,
      generateIfMissing: false,
      keyringLoader: countingKeyringLoader,
    });
    expect(second).not.toBeNull();
    expect(Buffer.compare(Buffer.from(known, 'base64'), second!)).toBe(0);
    // Read-only resolution must also invoke zero native calls.
    expect(adapterCalls).toHaveLength(0);
  });

  // Case 15
  it('the env var and the setting are independent opt-out paths: either alone disables the keyring', async () => {
    // Setting alone (env unset) disables.
    setOsKeyringDisabledBySetting(true);
    expect(isOsKeyringSessionDisabled()).toBe(true);
    expect(await createDefaultKeyringAdapter()).toBeNull();
    setOsKeyringDisabledBySetting(false);

    // Env alone (setting explicitly false) disables — the env var is read
    // directly, so it does not depend on the setter ever being called.
    env.set('1');
    expect(isOsKeyringSessionDisabled()).toBe(true);
    expect(await createDefaultKeyringAdapter()).toBeNull();

    // Neither set: the session is enabled again.
    env.clear();
    expect(isOsKeyringSessionDisabled()).toBe(false);
  });

  // Case 16 (R3 migration, post-R3.4-removal): a v:2 envelope written while a
  // file-resident machine secret exists is still readable in disabled mode — a
  // genuine round-trip through the opt-out, not a file-existence check.
  it('a v:2 envelope written with a file-resident machine secret round-trips through disabled mode', async () => {
    const dir = temp.fallbackDir();
    const secretPath = temp.machineSecretPath();
    const secret = fixedMachineSecret();

    // Persist the machine secret to the file FIRST, so it is file-resident.
    await fs.mkdir(path.dirname(secretPath), { recursive: true });
    await fs.writeFile(secretPath, secret.toString('base64'), { mode: 0o600 });

    // Write a v:2 envelope using that same secret (injected loader).
    const writer = new SecureStore(SERVICE, {
      keyringLoader: async () => null,
      fallbackDir: dir,
      machineSecretPath: secretPath,
      machineSecretLoader: async () => secret,
    });
    await writer.set('migrate-key', 'migrate-value');
    expect(await temp.encExists('migrate-key')).toBe(true);

    // Switch to disabled mode and read back through the opt-out. The read path
    // resolves the machine secret read-only from the file (keyring disabled).
    env.set('1');
    resetMachineSecretCache();
    const reader = new SecureStore(SERVICE, {
      keyringLoader: async () => null,
      fallbackDir: dir,
      machineSecretPath: secretPath,
      // No injected machineSecretLoader: read path resolves read-only from file.
    });
    const value = await reader.get('migrate-key');
    expect(value).toBe('migrate-value');
  });

  // Case 17
  it('R3.5: in disabled mode with a v:2 envelope and no file secret, get() throws CORRUPT naming the concrete remedy and does NOT create a secret file', async () => {
    const dir = temp.fallbackDir();
    const secretPath = temp.machineSecretPath();
    const secret = fixedMachineSecret();

    // Phase 1 (healthy): write a v:2 envelope using an injected machine secret.
    const writer = new SecureStore(SERVICE, {
      keyringLoader: async () => null,
      fallbackDir: dir,
      machineSecretPath: secretPath,
      machineSecretLoader: async () => secret,
    });
    await writer.set('orphan-key', 'orphan-value');
    expect(await temp.encExists('orphan-key')).toBe(true);

    // Remove the machine-secret file so the read path cannot resolve it.
    await fs.unlink(secretPath).catch(() => {});
    expect(await temp.machineSecretExists()).toBe(false);

    // Phase 2 (disabled): read with the default (read-only) machine secret
    // loader — no generation, no new secret file.
    env.set('1');
    resetMachineSecretCache();
    const reader = new SecureStore(SERVICE, {
      keyringLoader: async () => null,
      fallbackDir: dir,
      machineSecretPath: secretPath,
      // No injected machineSecretLoader: read path resolves read-only.
    });

    let error: unknown = null;
    try {
      await reader.get('orphan-key');
    } catch (caught) {
      error = caught;
    }

    const e = asSecureStoreError(error);
    expect(e.code).toBe('CORRUPT');
    // Actionable: names a concrete remedy (re-enable / re-save / restore), not
    // just the word "keyring".
    const remedy = e.remediation.toLowerCase();
    expect(
      remedy.includes('re-enable') ||
        remedy.includes('re-save') ||
        remedy.includes('restore'),
    ).toBe(true);

    // No new machine-secret file was created.
    expect(await temp.machineSecretExists()).toBe(false);
  });
});

// ─── Review remediation: latch-safety and durability boundaries ─────────────

/**
 * Boundaries surfaced by review that the earlier cases did not cover:
 * the factory must honor the runtime latch (not only the env/setting flags),
 * a filesystem errno error must not latch, and the fallback write must never
 * mint a replacement machine secret that would orphan existing v:2 envelopes.
 *
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R2.1, R2.3, R3.4
 */
describe('latch safety and fallback durability', () => {
  const temp = useTempDirs();
  const session = useResettableSessionState();
  beforeEach(session.beforeEach);
  afterEach(session.afterEach);

  it('createDefaultKeyringAdapter returns null after a runtime latch, not a throwing adapter', async () => {
    const guarded = createGuardedAdapter(
      adapterThrowingOnGet(new Error('The user denied the keychain request.')),
    );
    try {
      await guarded.getPassword(SERVICE, 'a');
    } catch {
      // swallowed — the guard has latched the session
    }
    expect(isOsKeyringSessionDisabled()).toBe(true);

    // A throwing adapter here would make machine-secret report 'unusable' and
    // abort without ever trying its file fallback.
    expect(await createDefaultKeyringAdapter()).toBeNull();
  });

  it('a filesystem errno error does not latch the keyring even when its message reads as denied', async () => {
    const eacces: NodeJS.ErrnoException = new Error(
      "EACCES: permission denied, open '/tmp/cache'",
    );
    eacces.code = 'EACCES';

    const store = new SecureStore(SERVICE, {
      keyringLoader: async () => adapterThrowingOnSet(eacces),
      fallbackDir: temp.fallbackDir(),
      fallbackPolicy: 'allow',
      machineSecretLoader: async () => null,
    });
    await store.set('k', 'v');

    expect(isOsKeyringSessionDisabled()).toBe(false);
  });

  it('refuses to mint a replacement machine secret while disabled when a v:2 envelope exists', async () => {
    const dir = temp.fallbackDir();
    const secretPath = temp.machineSecretPath();
    const secret = fixedMachineSecret();

    // Seed a v:2 envelope sealed under a secret that lives only "in the keychain".
    const writer = new SecureStore(SERVICE, {
      keyringLoader: async () => null,
      fallbackDir: dir,
      machineSecretPath: secretPath,
      machineSecretLoader: async () => secret,
    });
    await writer.set('sealed', 'sealed-value');
    expect(await temp.encExists('sealed')).toBe(true);
    expect(await temp.machineSecretExists()).toBe(false);

    // Now the keyring is opted out and the default loader would happily mint a
    // brand-new secret, orphaning 'sealed'. It must refuse instead.
    setOsKeyringDisabledBySetting(true);
    resetMachineSecretCache();
    const store = new SecureStore(SERVICE, {
      keyringLoader: async () => null,
      fallbackDir: dir,
      machineSecretPath: secretPath,
    });

    let error: unknown = null;
    try {
      await store.set('another', 'another-value');
    } catch (caught) {
      error = caught;
    }

    const e = asSecureStoreError(error);
    expect(e.message.toLowerCase()).toContain('orphan');
    // Critically: no replacement secret was written.
    expect(await temp.machineSecretExists()).toBe(false);
  });

  it('still mints a machine secret while disabled when there is no v:2 envelope to orphan', async () => {
    const dir = temp.fallbackDir();
    const secretPath = temp.machineSecretPath();
    setOsKeyringDisabledBySetting(true);
    resetMachineSecretCache();

    const store = new SecureStore(SERVICE, {
      keyringLoader: async () => null,
      fallbackDir: dir,
      machineSecretPath: secretPath,
    });
    await store.set('fresh', 'fresh-value');

    expect(await store.get('fresh')).toBe('fresh-value');
    expect(await temp.machineSecretExists()).toBe(true);
  });
});
