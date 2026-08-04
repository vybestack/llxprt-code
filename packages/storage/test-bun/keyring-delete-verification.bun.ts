/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for keyring delete verification (issue #3011).
 *
 * `@napi-rs/keyring`'s `deleteCredential()` erases backend errors into a
 * boolean: on Linux/Windows failures collapse to `false`, and on macOS the
 * OSStatus is discarded below the binding so failures collapse to `true`. A
 * read-back probe after every delete checks whether the credential is actually
 * gone. These tests assert the observable contract of that probe and of the
 * adapter that uses it — not internal call wiring.
 *
 * @plan PLAN-20260804-ISSUE3011
 * @requirement R1
 */

import { beforeEach, afterEach, describe, expect, it, mock } from 'bun:test';
import type { KeyringAdapter } from '../src/secure-store/secure-store.js';
import {
  verifyKeyringDelete,
  type KeyringDeleteOutcome,
} from '../src/secure-store/keyring-delete-verification.js';
import { createDefaultKeyringAdapter } from '../src/secure-store/default-keyring-adapter.js';
import { SecureStoreError } from '../src/secure-store/secure-store-errors.js';
import {
  resetRuntimeIdentityForTesting,
  forceRuntimeReplacedForTesting,
} from '../src/secure-store/runtime-identity.js';
import { resetRuntimeReplacedWarningForTesting } from '../src/secure-store/runtime-replaced-errors.js';

// ─── Fake @napi-rs/keyring (boundary double) ────────────────────────────────
//
// The factory dynamic-imports @napi-rs/keyring; bun's mock.module intercepts
// that import for this isolated process (see scripts/run_bun_tests.ts: one
// process per file). The native return value and whether the entry is
// actually removed are independently controllable, so the macOS silent-failure
// case (native true + credential survives) can be staged.

interface FakeKeyringController {
  readonly entries: Map<string, string>;
  /** What deleteCredential() returns — the native boolean. */
  deleteResult: boolean;
  /**
   * Whether deleteCredential() actually removes the entry from the store.
   * false simulates a refused delete (macOS: the OS rejected it but the
   * binding still reported true).
   */
  actuallyRemoves: boolean;
  /** When set, getPassword() rejects with this error (probe-rejection case). */
  probeError: Error | null;
}

function createFreshController(): FakeKeyringController {
  return {
    entries: new Map(),
    deleteResult: false,
    actuallyRemoves: true,
    probeError: null,
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
      if (controller.probeError !== null) {
        throw controller.probeError;
      }
      return (
        controller.entries.get(compositeKey(this.service, this.account)) ?? null
      );
    }

    async deleteCredential(): Promise<boolean> {
      if (controller.actuallyRemoves) {
        controller.entries.delete(compositeKey(this.service, this.account));
      }
      return controller.deleteResult;
    }
  },
}));

// ─── verifyKeyringDelete (cases 1-4) ─────────────────────────────────

/**
 * @plan PLAN-20260804-ISSUE3011
 * @requirement R1
 */
describe('verifyKeyringDelete', () => {
  it('classifies a null read-back as absent (case 1)', async () => {
    const outcome: KeyringDeleteOutcome = await verifyKeyringDelete(
      async () => null,
    );
    expect(outcome).toBe('absent');
  });

  it('classifies a non-null read-back as still-present (case 2)', async () => {
    const outcome: KeyringDeleteOutcome = await verifyKeyringDelete(
      async () => 'a-real-secret',
    );
    expect(outcome).toBe('still-present');
  });

  it('classifies an empty-string read-back as still-present, not absent (case 3)', async () => {
    // An empty credential is still a credential; a falsy check would silently
    // treat it as absent, defeating the verification.
    const outcome: KeyringDeleteOutcome = await verifyKeyringDelete(
      async () => '',
    );
    expect(outcome).toBe('still-present');
  });

  it('propagates a read-back rejection instead of degrading to absent (case 4)', async () => {
    const readBack = async (): Promise<string | null> => {
      throw new Error('probe failed');
    };
    await expect(verifyKeyringDelete(readBack)).rejects.toThrow('probe failed');
  });
});

// ─── createDefaultKeyringAdapter deletePassword (cases 5-11) ────────────────

async function loadAdapter(): Promise<KeyringAdapter> {
  const adapter = await createDefaultKeyringAdapter();
  if (adapter === null) {
    throw new Error(
      'createDefaultKeyringAdapter returned null — fake @napi-rs/keyring mock did not load',
    );
  }
  return adapter;
}

/**
 * @plan PLAN-20260804-ISSUE3011
 * @requirement R1
 */
describe('createDefaultKeyringAdapter deletePassword — delete verification (issue #3011)', () => {
  beforeEach(() => {
    resetRuntimeIdentityForTesting();
    resetRuntimeReplacedWarningForTesting();
    controller = createFreshController();
  });
  afterEach(() => {
    resetRuntimeIdentityForTesting();
    resetRuntimeReplacedWarningForTesting();
  });

  // The trigger substrings classifyError() scans the message for; the fixed
  // message must contain none of them.
  const TRIGGERS = [
    'not found',
    'locked',
    'denied',
    'permission',
    'timeout',
    'timed out',
  ];

  it('returns true when native delete succeeds and the credential is gone (case 5)', async () => {
    controller.deleteResult = true;
    controller.actuallyRemoves = true;
    const adapter = await loadAdapter();

    const result = await adapter.deletePassword('svc', 'acct');

    expect(result).toBe(true);
  });

  it('returns false when native delete reports false and the credential is absent (case 6)', async () => {
    controller.deleteResult = false;
    controller.actuallyRemoves = true;
    const adapter = await loadAdapter();

    const result = await adapter.deletePassword('svc', 'acct');

    expect(result).toBe(false);
  });

  it('rejects when native delete reports false but the credential survives (case 7)', async () => {
    const secret = 'super-secret-value-xyz';
    controller.deleteResult = false;
    controller.actuallyRemoves = false;
    controller.entries.set(compositeKey('svc', 'acct'), secret);
    const adapter = await loadAdapter();

    let caught: unknown = null;
    try {
      await adapter.deletePassword('svc', 'acct');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SecureStoreError);
    if (caught instanceof SecureStoreError) {
      expect(caught.code).toBe('UNAVAILABLE');
      expect(caught.message).toBe('Credential remains after keyring deletion');
      // Never the secret value.
      expect(caught.message).not.toContain(secret);
      // Never a classifyError trigger substring.
      const lower = caught.message.toLowerCase();
      for (const trigger of TRIGGERS) {
        expect(lower).not.toContain(trigger);
      }
    }
  });

  it('rejects when native delete reports true but the credential survives — the macOS silent-failure case (case 8)', async () => {
    // This is the single most important test in the file: on macOS the native
    // delete reports true even when the OS refused, so without a read-back the
    // failure is invisible. The old `if (deleted) return true` fast path would
    // pass this credential through as deleted.
    const secret = 'survives-despite-true';
    controller.deleteResult = true;
    controller.actuallyRemoves = false;
    controller.entries.set(compositeKey('svc', 'acct'), secret);
    const adapter = await loadAdapter();

    let caught: unknown = null;
    try {
      await adapter.deletePassword('svc', 'acct');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SecureStoreError);
    if (caught instanceof SecureStoreError) {
      expect(caught.code).toBe('UNAVAILABLE');
      expect(caught.message).toBe('Credential remains after keyring deletion');
      expect(caught.message).not.toContain(secret);
      const lower = caught.message.toLowerCase();
      for (const trigger of TRIGGERS) {
        expect(lower).not.toContain(trigger);
      }
    }
  });

  it('propagates a read-back probe rejection out of deletePassword (case 9)', async () => {
    controller.probeError = new Error('probe unreadable');
    const adapter = await loadAdapter();

    await expect(adapter.deletePassword('svc', 'acct')).rejects.toThrow(
      'probe unreadable',
    );
  });

  it('uses the fixed message even when service/account contain classifyError triggers (case 10)', async () => {
    // validateKey() allows a key literally named "not found". The message must
    // not interpolate it, or classifyError() would re-classify the error as
    // NOT_FOUND and deleteLocked would swallow it.
    controller.deleteResult = false;
    controller.actuallyRemoves = false;
    controller.entries.set(
      compositeKey('svc not found', 'acct not found'),
      'value',
    );
    const adapter = await loadAdapter();

    let caught: unknown = null;
    try {
      await adapter.deletePassword('svc not found', 'acct not found');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SecureStoreError);
    if (caught instanceof SecureStoreError) {
      expect(caught.message).toBe('Credential remains after keyring deletion');
      // The trigger-bearing service/account names must not leak into the message.
      expect(caught.message).not.toContain('not found');
      expect(caught.message).not.toContain('svc not found');
      expect(caught.message).not.toContain('acct not found');
      const lower = caught.message.toLowerCase();
      for (const trigger of TRIGGERS) {
        expect(lower).not.toContain(trigger);
      }
    }
  });

  it('fires the runtime-replaced guard before any native call (case 11)', async () => {
    const adapter = await loadAdapter();
    // Force the terminal state on an already-cached adapter.
    forceRuntimeReplacedForTesting();

    await expect(adapter.deletePassword('svc', 'acct')).rejects.toBeInstanceOf(
      SecureStoreError,
    );
  });
});
