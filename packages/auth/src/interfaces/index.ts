/**
 * @plan:PLAN-20260608-ISSUE1586.P06
 * @requirement:REQ-INTF-001.1
 * @requirement:REQ-INTF-001.2
 * @requirement:REQ-INTF-001.3
 * @requirement:REQ-INTF-001.4
 * @requirement:REQ-INTF-001.5
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Interface barrel re-exports for auth package DI contracts.
// Core implements these interfaces; auth defines and consumes them.

export type {
  ISecureStore,
  ISecureStoreError,
  SecureStoreErrorCode,
} from './secure-store.js';

export type { ISettingsService } from './settings-service.js';

export type { IProviderKeyStorage } from './provider-key-storage.js';

export type { IDebugLogger } from './debug-logger.js';

export type {
  IProviderRuntimeContext,
  GetActiveRuntimeContext,
} from './runtime-context.js';
