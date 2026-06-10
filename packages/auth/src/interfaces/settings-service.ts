/**
 * @plan:PLAN-20260608-ISSUE1586.P06
 * @requirement:REQ-INTF-001.2
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Interface for settings access, replacing direct SettingsService imports.
 *
 * AuthPrecedenceResolver uses ISettingsService to look up provider settings
 * and listen for settings change events. Core's SettingsService structurally
 * satisfies this interface — no adapter needed.
 *
 * @plan:PLAN-20260608-ISSUE1586.P06
 * @requirement:REQ-INTF-001.2
 */
export interface ISettingsService {
  get(key: string): unknown;
  getProviderSettings(providerName: string): Record<string, unknown>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
}
