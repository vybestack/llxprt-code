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
import type { KeyringAdapter } from './secure-store.js';

export type FindCredentialsFunction = (
  service: string,
) => Promise<Array<{ account: string; password: string }>>;

const KEYRING_MODULE_ERROR_CODES = new Set([
  'ERR_MODULE_NOT_FOUND',
  'MODULE_NOT_FOUND',
  'ERR_DLOPEN_FAILED',
]);

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
 * Wraps an adapter so that every method re-checks the replaced-runtime state
 * immediately before entering native code. This guarantees R2 even for
 * adapters cached before the transition — the guard fires on every call.
 *
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R2
 */
function createGuardedAdapter(inner: KeyringAdapter): KeyringAdapter {
  const guardedGet = async (
    service: string,
    account: string,
  ): Promise<string | null> => {
    assertRuntimeNotReplaced();
    return inner.getPassword(service, account);
  };
  const guardedSet = async (
    service: string,
    account: string,
    password: string,
  ): Promise<void> => {
    assertRuntimeNotReplaced();
    await inner.setPassword(service, account, password);
  };
  const guardedDelete = async (
    service: string,
    account: string,
  ): Promise<boolean> => {
    assertRuntimeNotReplaced();
    return inner.deletePassword(service, account);
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
      return innerFind(service);
    };
  }
  return adapter;
}

function withFindCredentials(
  adapter: KeyringAdapter,
  findCredentialsFn: FindCredentialsFunction | undefined,
): KeyringAdapter {
  if (findCredentialsFn !== undefined) {
    adapter.findCredentials = async (service: string) => {
      try {
        return await findCredentialsFn(service);
      } catch {
        return [];
      }
    };
  }
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
        return entry.getPassword();
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
        return entry.deleteCredential();
      },
    };
    const withFindCreds = withFindCredentials(adapter, findCredentialsFn);
    return createGuardedAdapter(withFindCreds);
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
