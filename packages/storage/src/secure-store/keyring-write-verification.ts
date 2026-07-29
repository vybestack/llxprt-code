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
    return (await adapter.getPassword(serviceName, key)) === null;
  } catch {
    return false;
  }
}
