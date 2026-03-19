/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20250218-STATELESSPROVIDER.P03
 * @requirement:REQ-SP-002.1
 * Derived from pseudocode/provider-invocation.md:2 and pseudocode/cli-runtime.md:5.
 */

import { SettingsService } from '../settings/SettingsService.js';
import type { Config } from '../config/config.js';
import { MissingProviderRuntimeError } from '../providers/errors.js';

/**
 * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
 * @requirement REQ-D01-002
 * @requirement REQ-D01-003
 * @pseudocode lines 122-133
 */
export interface ProviderRuntimeContext {
  settingsService: SettingsService;
  config?: Config;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
}

let activeContext: ProviderRuntimeContext | null = null;

/**
 * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
 * @requirement REQ-D01-002
 * @requirement REQ-D01-003
 * @pseudocode lines 122-133
 */
export interface ProviderRuntimeContextInit {
  settingsService?: SettingsService;
  config?: Config;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
 * @requirement REQ-D01-002
 * @requirement REQ-D01-003
 * @pseudocode lines 122-133
 */
export function createProviderRuntimeContext(
  init: ProviderRuntimeContextInit = {},
): ProviderRuntimeContext {
  return {
    settingsService: init.settingsService ?? new SettingsService(),
    config: init.config,
    runtimeId: init.runtimeId,
    metadata: init.metadata,
  };
}

export function setActiveProviderRuntimeContext(
  context: ProviderRuntimeContext | null,
): void {
  activeContext = context;
}

export function clearActiveProviderRuntimeContext(): void {
  activeContext = null;
}

export function peekActiveProviderRuntimeContext(): ProviderRuntimeContext | null {
  return activeContext;
}

export function getActiveProviderRuntimeContext(): ProviderRuntimeContext {
  if (activeContext) {
    return activeContext;
  }

  throw new MissingProviderRuntimeError({
    providerKey: 'provider-runtime',
    missingFields: ['settings'],
    requirement: 'REQ-SP4-004',
    stage: 'getActiveProviderRuntimeContext',
    metadata: {
      hint: 'Call setActiveProviderRuntimeContext() before provider operations.',
    },
    message:
      'MissingProviderRuntimeError(provider-runtime): active provider runtime context is missing SettingsService (REQ-SP4-004).',
  });
}
