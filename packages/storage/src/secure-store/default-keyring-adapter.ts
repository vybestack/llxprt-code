/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Default keyring adapter factory — loads @napi-rs/keyring and wraps it in a
 * KeyringAdapter. Extracted from secure-store.ts for clarity and to respect
 * the max-lines lint threshold.
 *
 * The adapter returned by this factory is **guarded**: every method
 * re-checks the terminal replaced-runtime state immediately before entering
 * native code and throws RUNTIME_REPLACED if detected. This covers
 * SecureStore (which caches its adapter), MCP KeychainTokenStorage (which
 * caches the module and a positive availability flag), and machine-secret —
 * all obtain their adapter from this factory.
 *
 * The factory also returns null before importing @napi-rs/keyring when the
 * runtime is already replaced at creation time, so no dynamic import occurs.
 *
 * @plan PLAN-20260211-SECURESTORE.P08
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R2
 */

import type { StorageLogger } from '../types/logger.js';
import { NullStorageLoggerImpl } from '../types/logger.js';
import { isRuntimeReplaced } from './runtime-identity.js';
import { assertRuntimeNotReplaced } from './runtime-replaced-errors.js';
import {
  isOsKeyringSessionDisabled,
  noteKeyringError,
} from './keyring-session-state.js';
import { verifyKeyringDelete } from './keyring-delete-verification.js';
import { recordAuthorizedKeyringRead } from './keychain-grant-persistence.js';
import { SecureStoreError } from './secure-store-errors.js';
import type { KeyringAdapter } from './secure-store.js';

export type FindCredentialsFunction = (
  service: string,
) => Promise<Array<{ account: string; password: string }>>;

const KEYRING_MODULE_ERROR_CODES = new Set([
  'ERR_MODULE_NOT_FOUND',
  'MODULE_NOT_FOUND',
  'ERR_DLOPEN_FAILED',
]);

/**
 * Environment marker that suppresses use of the real OS credential store.
 *
 * Test suites must not read or write the developer's actual keyring. Storage
 * roots are already redirected for tests (see `isolateStorageRoots`), but the
 * OS credential store sits outside those roots and was never covered, so any
 * suite that touched a SecureStore reached the real keychain. Setting this
 * marker makes the factory return null, and SecureStore then uses its
 * encrypted-file fallback inside the isolated storage root.
 *
 * Deliberately distinct from `LLXPRT_TEST_STORAGE_ISOLATED`: the storage
 * workspace's own suites isolate their roots while still needing the genuine
 * keyring, so the two concerns cannot share one flag.
 */
const DISABLE_OS_KEYRING_ENV = 'LLXPRT_TEST_DISABLE_OS_KEYRING';

function isOsKeyringDisabledForTests(): boolean {
  return process.env[DISABLE_OS_KEYRING_ENV] === '1';
}

// The production opt-out (`LLXPRT_DISABLE_OS_KEYRING=1`, the user-facing
// recovery lever for the discarded Keychain grant in issue #3020) now lives in
// keyring-session-state.ts, which owns that env var alongside the
// security.disableOsKeyring setting and the runtime latch. Reading it here too
// would give the same variable two sources of truth.

function isErrorWithCode(value: unknown): value is { code: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string'
  );
}

function isErrorWithMessage(value: unknown): value is { message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

function isKeyringModuleMissingError(error: unknown): boolean {
  return (
    (isErrorWithCode(error) && KEYRING_MODULE_ERROR_CODES.has(error.code)) ||
    (isErrorWithMessage(error) && error.message.includes('@napi-rs/keyring'))
  );
}

interface KeyringEntry {
  getPassword(): Promise<string | null>;
  setPassword(password: string): Promise<void>;
  deleteCredential(): Promise<boolean>;
}

interface KeyringModuleShape {
  AsyncEntry: new (service: string, account: string) => KeyringEntry;
  findCredentials?: FindCredentialsFunction;
  findCredentialsAsync?: FindCredentialsFunction;
}

/**
 * Type predicate for the shape of the @napi-rs/keyring dynamic import.
 * Avoids `as` casts by narrowing with runtime checks. Validates that every
 * present callable member is actually a function, not just present.
 *
 * @plan PLAN-20260801-ISSUE2926
 */
function isKeyringModuleShape(value: unknown): value is KeyringModuleShape {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('AsyncEntry' in value) || typeof value.AsyncEntry !== 'function') {
    return false;
  }
  if (
    'findCredentials' in value &&
    typeof value.findCredentials !== 'function'
  ) {
    return false;
  }
  if (
    'findCredentialsAsync' in value &&
    typeof value.findCredentialsAsync !== 'function'
  ) {
    return false;
  }
  return true;
}

/**
 * Selects the keyring module from a dynamic import, robust to CJS/ESM
 * interop differences. Under some module systems the useful export is the
 * namespace object; under others it is on `.default`. Preferring the
 * namespace first and falling back to `.default` is strictly more robust
 * than either version alone.
 *
 * Uses type-predicate narrowing — no type assertions.
 *
 * @plan PLAN-20260801-ISSUE2926
 */
function resolveKeyringModule(namespace: unknown): KeyringModuleShape | null {
  if (isKeyringModuleShape(namespace)) {
    return namespace;
  }
  if (
    typeof namespace === 'object' &&
    namespace !== null &&
    'default' in namespace &&
    isKeyringModuleShape(namespace.default)
  ) {
    return namespace.default;
  }
  return null;
}

/**
 * Throws a SecureStoreError (UNAVAILABLE) when the OS keyring has been latched
 * unusable or opted out for this session. Called inside the guarded adapter
 * BEFORE entering native code, so zero OS keychain operations occur after the
 * transition — including for an adapter a consumer cached before the latch
 * (R2.3).
 *
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R2.3
 */
function assertKeyringSessionEnabled(): void {
  if (isOsKeyringSessionDisabled()) {
    throw new SecureStoreError(
      'The OS keyring is disabled for this session (denied/locked earlier, or opted out). No OS keychain operations are permitted.',
      'UNAVAILABLE',
      'Restart LLxprt after unlocking your keyring / granting access, or clear the OS keyring opt-out (security.disableOsKeyring / LLXPRT_DISABLE_OS_KEYRING), to retry.',
    );
  }
}

/**
 * Wraps an adapter so that every method:
 *   1. re-checks the terminal replaced-runtime state (RUNTIME_REPLACED);
 *   2. re-checks the session latch/opt-out (R2.3 — zero native entry after the
 *      transition, even for adapters cached before the latch);
 *   3. routes any thrown native error through {@link noteKeyringError} (the
 *      single classification + latch chokepoint, R2.1/R2.5) and rethrows it
 *      unchanged — never swallowed, never altered.
 *
 * This is the ONE real chokepoint: every consumer's adapter comes from
 * {@link createDefaultKeyringAdapter}, so SecureStore, MCP KeychainTokenStorage
 * and machine-secret all route through here and cannot bypass the latch.
 *
 * Exported so tests can wrap an injected counting/raw adapter with the exact
 * guard used in production and assert the boundary behavior (zero native entry
 * after a latch; errors latch even when the caller swallows them).
 *
 * @plan PLAN-20260801-ISSUE2926
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R2
 */
export function createGuardedAdapter(inner: KeyringAdapter): KeyringAdapter {
  const guardedGet = async (
    service: string,
    account: string,
  ): Promise<string | null> => {
    assertRuntimeNotReplaced();
    assertKeyringSessionEnabled();
    try {
      return await inner.getPassword(service, account);
    } catch (error) {
      noteKeyringError(error);
      throw error;
    }
  };
  const guardedSet = async (
    service: string,
    account: string,
    password: string,
  ): Promise<void> => {
    assertRuntimeNotReplaced();
    assertKeyringSessionEnabled();
    try {
      await inner.setPassword(service, account, password);
    } catch (error) {
      noteKeyringError(error);
      throw error;
    }
  };
  const guardedDelete = async (
    service: string,
    account: string,
  ): Promise<boolean> => {
    assertRuntimeNotReplaced();
    assertKeyringSessionEnabled();
    try {
      return await inner.deletePassword(service, account);
    } catch (error) {
      noteKeyringError(error);
      throw error;
    }
  };
  const adapter: KeyringAdapter = {
    getPassword: guardedGet,
    setPassword: guardedSet,
    deletePassword: guardedDelete,
  };
  if (inner.findCredentials !== undefined) {
    const innerFind = inner.findCredentials;
    adapter.findCredentials = async (service: string) => {
      assertRuntimeNotReplaced();
      assertKeyringSessionEnabled();
      try {
        return await innerFind(service);
      } catch (error) {
        noteKeyringError(error);
        throw error;
      }
    };
  }
  return adapter;
}

/**
 * Degrades a guarded adapter's findCredentials to return [] on error. Applied
 * OUTSIDE the guard so the guard (and therefore {@link noteKeyringError}) sees
 * and classifies + latches the error first (R2.1), while SecureStore.list()
 * still observes [] and never throws. Without this layer list()'s own
 * try/catch would also prevent the throw; kept for observable parity with the
 * prior behavior and any other findCredentials caller.
 *
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R2.1
 */
function degradeFindCredentialsToEmpty(
  adapter: KeyringAdapter,
): KeyringAdapter {
  if (adapter.findCredentials === undefined) {
    return adapter;
  }
  const inner = adapter.findCredentials;
  adapter.findCredentials = async (service: string) => {
    try {
      return await inner(service);
    } catch {
      return [];
    }
  };
  return adapter;
}

let _keyringLogger: StorageLogger = new NullStorageLoggerImpl();

/** Sets the logger used by createDefaultKeyringAdapter for diagnostic output. */
export function setKeyringLogger(logger: StorageLogger): void {
  _keyringLogger = logger;
}

/**
 * Creates a default KeyringAdapter by loading @napi-rs/keyring.
 *
 * Returns null before importing @napi-rs/keyring when the runtime has been
 * replaced on disk (issue #2926), so zero native keyring calls are issued.
 *
 * The returned adapter is guarded: every method re-checks the terminal state
 * before entering native code. This covers SecureStore, MCP, and
 * machine-secret, which all obtain their adapter from this factory.
 *
 * @plan PLAN-20260211-SECURESTORE.P08
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R2
 */
export async function createDefaultKeyringAdapter(): Promise<KeyringAdapter | null> {
  if (isRuntimeReplaced()) {
    return null;
  }
  if (isOsKeyringDisabledForTests()) {
    return null;
  }
  // Checked BEFORE importing @napi-rs/keyring so zero Keychain operations
  // occur — including for llxprt-code-machine-secret and MCP token storage,
  // which both route through this factory. Deliberately distinct from
  // isOsKeyringDisabledForTests(): test suites isolate their storage roots but
  // may still need the genuine keyring.
  //
  // isOsKeyringSessionDisabled() covers three independent reasons, ORed:
  // the LLXPRT_DISABLE_OS_KEYRING=1 escape hatch (issue #3020), the
  // security.disableOsKeyring setting, and the runtime DENIED/LOCKED latch
  // (issue #2928).
  //
  // The latch must be part of this check, not just the env/setting flags.
  // Returning a guarded adapter after a latch would hand callers an object
  // whose every method throws; machine-secret's readFromKeyring catches that
  // and reports 'unusable', which aborts its resolve WITHOUT trying the file
  // fallback. Returning null instead routes it straight to the file.
  if (isOsKeyringSessionDisabled()) {
    return null;
  }
  try {
    const module = await import('@napi-rs/keyring');
    const keyring = resolveKeyringModule(module);
    if (keyring === null) {
      return null;
    }
    const kr = keyring;
    const findCredentialsFn = kr.findCredentials ?? kr.findCredentialsAsync;
    const adapter: KeyringAdapter = {
      getPassword: async (service: string, account: string) => {
        const entry = new kr.AsyncEntry(service, account);
        // Issue #3020: time the native read with a monotonic clock
        // (performance.now) so a repeatedly slow successful read of the
        // SAME credential surfaces the discarded "Always Allow" grant.
        // Only non-null reads are recorded; a rejection propagates
        // untouched because the await throws before this record call is
        // reached. The correlation key is an opaque Map key only — never
        // logged or interpolated into any message.
        const startedAt = performance.now();
        const value = await entry.getPassword();
        if (value !== null) {
          recordAuthorizedKeyringRead({
            credentialKey: `${service}\u0000${account}`,
            startedAt,
            endedAt: performance.now(),
          });
        }
        return value;
      },
      setPassword: async (
        service: string,
        account: string,
        password: string,
      ) => {
        const entry = new kr.AsyncEntry(service, account);
        await entry.setPassword(password);
      },
      deletePassword: async (service: string, account: string) => {
        const entry = new kr.AsyncEntry(service, account);
        const deleted = await entry.deleteCredential();
        // Always probe, regardless of the native boolean. On macOS the delete
        // status is destroyed below the binding (security-framework discards
        // the OSStatus, apple-native-keyring-store returns Ok unconditionally,
        // and the binding maps that to true), so a true result is no guarantee
        // the credential is gone. Only the read-back can confirm absence.
        const outcome = await verifyKeyringDelete(() => entry.getPassword());
        if (outcome === 'still-present') {
          // Diagnostics only — service/account names, never the read-back value.
          _keyringLogger.debug(
            () =>
              `[keyring] credential remains after deletion: service='${service}' account='${account}'`,
          );
          // Where this rejection currently surfaces:
          //   - MCP KeychainTokenStorage.deleteCredentials() calls this
          //     adapter directly and propagates it. Observable today.
          //   - SecureStore.deleteLocked() still wraps this call in a bare
          //     `catch {}` and discards it. NOT observable through
          //     SecureStore.delete() yet; the in-flight PR for issue #1985
          //     replaces that catch with classification and a rethrow of
          //     anything that is not NOT_FOUND. secure-store.ts is owned by
          //     that PR, so it is deliberately not modified here.
          //
          // The message is fixed and interpolation-free for when that lands:
          // classifyError() re-derives the code from message text and ignores
          // SecureStoreError.code, so the message must avoid every trigger
          // substring ("not found", "locked", "denied", "permission",
          // "timeout", "timed out"). validateKey() permits a key literally
          // named "not found" — interpolating one would re-classify this as
          // NOT_FOUND and get it swallowed, silently defeating the throw.
          throw new SecureStoreError(
            'Credential remains after keyring deletion',
            'UNAVAILABLE',
            'Retry the delete; if it persists, inspect the OS keyring entry for this service and account and remove it manually.',
          );
        }
        // Absent: return the original native boolean unchanged. true means "a
        // credential was deleted"; false means "there was nothing to delete".
        return deleted;
      },
    };
    // Attach the raw findCredentials (which can throw) BEFORE guarding, so the
    // guard's findCredentials wrapper sees the error, classifies it via
    // noteKeyringError, and latches the session if it is DENIED/LOCKED.
    if (findCredentialsFn !== undefined) {
      adapter.findCredentials = findCredentialsFn;
    }
    const guarded = createGuardedAdapter(adapter);
    // Apply the [] degradation OUTSIDE the guard: SecureStore.list() must still
    // observe [] (never throw), but the guard has already classified + latched
    // the underlying error. Ordering is critical — the [] layer must NOT sit
    // between the native call and the guard, or noteKeyringError never fires.
    return degradeFindCredentialsToEmpty(guarded);
  } catch (error) {
    if (!isKeyringModuleMissingError(error) && process.env.DEBUG) {
      const message = isErrorWithMessage(error) ? error.message : String(error);
      _keyringLogger.warn(
        `[SecureStore] Unexpected error loading @napi-rs/keyring: ${message}`,
      );
    }
    return null;
  }
}
