/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { KeyringAdapter } from './secure-store.js';

export interface KeyringWriteVerification {
  verified: boolean;
  hasStaleValue: boolean;
}

export async function verifyKeyringWrite(
  adapter: KeyringAdapter,
  serviceName: string,
  key: string,
  expected: string,
): Promise<KeyringWriteVerification> {
  try {
    const readBack = await adapter.getPassword(serviceName, key);
    return {
      verified: readBack === expected,
      hasStaleValue: readBack !== null && readBack !== expected,
    };
  } catch {
    return { verified: false, hasStaleValue: false };
  }
}

export async function clearMismatchedKeyringValue(
  adapter: KeyringAdapter,
  serviceName: string,
  key: string,
): Promise<boolean> {
  try {
    await adapter.deletePassword(serviceName, key);
  } catch {
    return false;
  }
  // Some keyring backends have delayed read-after-delete visibility where a
  // successful deletePassword is not immediately reflected by getPassword.
  // Retry a few times with a small delay before concluding the stale value
  // still persists, so transient inconsistency does not become durable
  // credential loss.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const readBack = await adapter.getPassword(serviceName, key);
      if (readBack === null) {
        return true;
      }
    } catch {
      // A throw on read-back after delete is inconclusive — the backend may
      // not have propagated the deletion yet. Continue retrying instead of
      // treating this as a durable failure.
    }
    await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
  }
  return false;
}
