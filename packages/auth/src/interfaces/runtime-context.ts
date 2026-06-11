/**
 * @plan:PLAN-20260608-ISSUE1586.P06
 * @requirement:REQ-INTF-001.5
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISettingsService } from './settings-service.js';

/**
 * Interface for provider runtime context, replacing direct ProviderRuntimeContext imports.
 *
 * Used by precedence.ts (type-only) and auth-precedence-resolver.ts (type + function call).
 * Includes metadata field per P02b remediation (C-CB-06 alignment).
 *
 * The injected function `getActiveRuntimeContext?: () => IProviderRuntimeContext | null`
 * replaces the static `getActiveProviderRuntimeContext()` import from core.
 *
 * @plan:PLAN-20260608-ISSUE1586.P06
 * @requirement:REQ-INTF-001.5
 */
export interface IProviderRuntimeContext {
  settingsService: ISettingsService;
  config?: unknown;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Factory type for obtaining the active runtime context.
 * Injected into AuthPrecedenceResolver via DI to decouple from
 * core's getActiveProviderRuntimeContext static import.
 *
 * @plan:PLAN-20260608-ISSUE1586.P06
 * @requirement:REQ-INTF-001.5
 */
export type GetActiveRuntimeContext =
  | (() => IProviderRuntimeContext | null)
  | undefined;
