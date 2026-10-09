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
 * lets the caller hand over whatever context it already owns explicitly;
 * core exports no ambient accessor for this (issue #2616 deleted it).
 *
 * @plan:PLAN-20260608-ISSUE1586.P06
 * @requirement:REQ-INTF-001.5
 */
export interface IProviderRuntimeContext {
  settingsService: ISettingsService;
  config?: unknown;
  runtimeId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Factory type for obtaining the active runtime context.
 * Injected into AuthPrecedenceResolver via DI so the caller decides which
 * context applies — there is no module-level accessor to import (issue #2616).
 *
 * @plan:PLAN-20260608-ISSUE1586.P06
 * @requirement:REQ-INTF-001.5
 */
export type GetActiveRuntimeContext =
  | (() => IProviderRuntimeContext | null)
  | undefined;
