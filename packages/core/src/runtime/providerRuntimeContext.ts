/**
 * @license
 * Copyright 2025 Vybestack LLC
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

export interface ProviderRuntimeContext {
  settingsService: SettingsService;
  config?: Config;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
}

let activeContext: ProviderRuntimeContext | null = null;
let fallbackFactory: (() => ProviderRuntimeContext) | null = null;

export interface ProviderRuntimeContextInit {
  settingsService?: SettingsService;
  config?: Config;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
}

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

  if (fallbackFactory) {
    const fallbackContext = fallbackFactory();
    if (!fallbackContext?.settingsService) {
      throw new MissingProviderRuntimeError({
        providerKey: 'provider-runtime',
        missingFields: ['settings'],
        requirement: 'REQ-SP4-004',
        stage: 'fallbackFactory',
        metadata: {
          hint: 'Fallback context must supply SettingsService.',
        },
        message:
          'MissingProviderRuntimeError(provider-runtime): fallback context is missing SettingsService (REQ-SP4-004).',
      });
    }
    activeContext = fallbackContext;
    return fallbackContext;
  }

  throw new MissingProviderRuntimeError({
    providerKey: 'provider-runtime',
    missingFields: ['runtime registration'],
    requirement: 'REQ-SP4-004',
    stage: 'getActiveProviderRuntimeContext',
    metadata: {
      hint: 'Call activateIsolatedRuntimeContext() + registerCliProviderInfrastructure() before invoking providers or CLI helpers.',
    },
    message:
      'MissingProviderRuntimeError(provider-runtime): runtime registration missing. Run activateIsolatedRuntimeContext() before invoking providers (REQ-SP4-004).',
  });
}

export function setProviderRuntimeContextFallback(
  factory: (() => ProviderRuntimeContext) | null,
): void {
  fallbackFactory = factory;
  if (!activeContext && fallbackFactory) {
    activeContext = fallbackFactory();
  }
}
