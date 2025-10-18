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
    activeContext = fallbackContext;
    return fallbackContext;
  }

  const fallbackContext = createProviderRuntimeContext({
    runtimeId: 'legacy-singleton',
    metadata: { source: 'statelessprovider-runtime', mode: 'fallback' },
  });
  activeContext = fallbackContext;
  return fallbackContext;
}

export function setProviderRuntimeContextFallback(
  factory: (() => ProviderRuntimeContext) | null,
): void {
  fallbackFactory = factory;
  if (!activeContext && fallbackFactory) {
    activeContext = fallbackFactory();
  }
}
