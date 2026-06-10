/**
 * @plan:PLAN-20260608-ISSUE1586.P06
 * @requirement:REQ-INTF-001.3
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Instance contract for provider key storage.
 *
 * This interface defines the shape of a provider key storage object.
 * AuthPrecedenceResolver accepts an IProviderKeyStorage instance via
 * DI injection. Core's getProviderKeyStorage() factory produces an
 * object satisfying this interface — the factory is a core concern,
 * not an auth interface.
 *
 * @plan:PLAN-20260608-ISSUE1586.P06
 * @requirement:REQ-INTF-001.3
 */
export interface IProviderKeyStorage {
  getKey(provider: string): Promise<string | null>;
  listKeys(): Promise<string[]>;
  hasKey(provider: string): Promise<boolean>;
}
