/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the non-destructive keyring write verification.
 *
 * The module must return a discriminated outcome ('verified' | 'conflict' |
 * 'unverified') and must NOT export any delete/clear helper. A read-back
 * mismatch is reported as 'conflict' — the foreign value is never deleted or
 * returned.
 *
 * @plan PLAN-20260801-ISSUE2927
 * @requirement R1, R2
 */

import { describe, it, expect } from 'bun:test';
import {
  verifyKeyringWrite,
  type KeyringWriteOutcome,
} from '../src/secure-store/keyring-write-verification.js';
import type { KeyringAdapter } from '../src/secure-store/secure-store.js';

function createInMemoryKeyring(
  store: Map<string, string>,
  overrides: Partial<KeyringAdapter> = {},
): KeyringAdapter & { readonly deleteCount: number } {
  let deleteCount = 0;
  return {
    get deleteCount(): number {
      return deleteCount;
    },
    getPassword: async (_service: string, account: string) =>
      store.get(account) ?? null,
    setPassword: async (_service: string, account: string, value: string) => {
      store.set(account, value);
    },
    deletePassword: async (_service: string, account: string) => {
      deleteCount += 1;
      return store.delete(account);
    },
    ...overrides,
  };
}

describe('verifyKeyringWrite', () => {
  it('returns verified when read-back equals the expected value', async () => {
    const store = new Map<string, string>([['my-key', 'my-value']]);
    const adapter = createInMemoryKeyring(store);

    const outcome = await verifyKeyringWrite(
      adapter,
      'svc',
      'my-key',
      'my-value',
    );

    expect(outcome).toStrictEqual<KeyringWriteOutcome>({
      outcome: 'verified',
    });
  });

  it('returns conflict and does NOT delete when read-back is a different non-null value', async () => {
    const store = new Map<string, string>([['my-key', 'foreign-value']]);
    const adapter = createInMemoryKeyring(store);

    const outcome = await verifyKeyringWrite(
      adapter,
      'svc',
      'my-key',
      'my-value',
    );

    expect(outcome).toStrictEqual<KeyringWriteOutcome>({
      outcome: 'conflict',
    });
    // The foreign value is untouched.
    expect(store.get('my-key')).toBe('foreign-value');
    // No deletion occurred.
    expect(adapter.deleteCount).toBe(0);
  });

  it('returns unverified when read-back is null', async () => {
    const store = new Map<string, string>();
    const adapter = createInMemoryKeyring(store);

    const outcome = await verifyKeyringWrite(
      adapter,
      'svc',
      'my-key',
      'my-value',
    );

    expect(outcome).toStrictEqual<KeyringWriteOutcome>({
      outcome: 'unverified',
    });
  });

  it('returns unverified when the read-back throws', async () => {
    const adapter = createInMemoryKeyring(new Map(), {
      getPassword: async () => {
        throw new Error('keyring read error');
      },
    });

    const outcome = await verifyKeyringWrite(
      adapter,
      'svc',
      'my-key',
      'my-value',
    );

    expect(outcome).toStrictEqual<KeyringWriteOutcome>({
      outcome: 'unverified',
    });
  });
});

describe('keyring-write-verification module surface (R1 regression guard)', () => {
  it('does not export a delete/clear helper', async () => {
    const mod = await import(
      '../src/secure-store/keyring-write-verification.js'
    );
    const exportedNames = Object.keys(mod);
    expect(exportedNames).not.toContain('clearMismatchedKeyringValue');
    expect(exportedNames).not.toContain('clearMismatchedValue');
    for (const name of exportedNames) {
      expect(name.toLowerCase()).not.toContain('clear');
      expect(name.toLowerCase()).not.toContain('delete');
    }
  });
});
