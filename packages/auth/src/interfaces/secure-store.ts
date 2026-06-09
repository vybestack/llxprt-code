/**
 * @plan:PLAN-20260608-ISSUE1586.P06
 * @requirement:REQ-INTF-001.1
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Error codes for secure store operations.
 * Derived from core SecureStore error handling evidence (P01 dependency-audit).
 */
export type SecureStoreErrorCode =
  | 'UNAVAILABLE'
  | 'LOCKED'
  | 'DENIED'
  | 'CORRUPT'
  | 'TIMEOUT'
  | 'NOT_FOUND';

/**
 * Error shape thrown/rejected by ISecureStore operations.
 * Matches core's SecureStoreError structure used in keyring-token-store.ts
 * catch blocks (error.code, error.remediation).
 */
export interface ISecureStoreError extends Error {
  code: SecureStoreErrorCode;
  remediation: string;
}

/**
 * Interface for persistent secure token storage.
 *
 * KeyringTokenStore delegates storage operations to an ISecureStore instance
 * injected via DI. Core provides the concrete SecureStore implementation
 * backed by @napi-rs/keyring.
 *
 * Method signatures match core SecureStore's public API:
 * - get (L347 usage in keyring-token-store.ts)
 * - set (L330 usage)
 * - delete (L395 usage)
 * - list (L414, L437 usage)
 * - has (L657 in core SecureStore)
 *
 * @plan:PLAN-20260608-ISSUE1586.P06
 * @requirement:REQ-INTF-001.1
 */
export interface ISecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(): Promise<string[]>;
  has(key: string): Promise<boolean>;
}
