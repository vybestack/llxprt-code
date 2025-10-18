/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Centralized SettingsService singleton instance
 */

import { SettingsService } from './SettingsService.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  peekActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  setProviderRuntimeContextFallback,
} from '../runtime/providerRuntimeContext.js';

let settingsServiceInstance: SettingsService | null = null;

function ensureSingletonSettingsService(): SettingsService {
  if (!settingsServiceInstance) {
    settingsServiceInstance = new SettingsService();
  }

  return settingsServiceInstance;
}

setProviderRuntimeContextFallback(() =>
  createProviderRuntimeContext({
    settingsService: ensureSingletonSettingsService(),
    runtimeId: 'legacy-singleton',
    metadata: { source: 'singleton-fallback' },
  }),
);

/**
 * Get or create the global SettingsService singleton instance.
 * Resolves through the currently active ProviderRuntimeContext when present.
 */
export function getSettingsService(): SettingsService {
  const activeContext = peekActiveProviderRuntimeContext();
  if (activeContext?.settingsService) {
    settingsServiceInstance = activeContext.settingsService;
    return activeContext.settingsService;
  }

  return ensureSingletonSettingsService();
}

/**
 * Register an externally created SettingsService with the active runtime context.
 */
export function registerSettingsService(
  settingsService: SettingsService,
): void {
  settingsServiceInstance = settingsService;

  const existingContext = peekActiveProviderRuntimeContext();
  if (existingContext) {
    setActiveProviderRuntimeContext({
      ...existingContext,
      settingsService,
    });
    return;
  }

  setActiveProviderRuntimeContext(
    createProviderRuntimeContext({
      settingsService,
      runtimeId: 'registered-singleton',
      metadata: { source: 'registerSettingsService' },
    }),
  );
}

/**
 * Reset the settings service instance (for testing)
 */
export function resetSettingsService(): void {
  if (settingsServiceInstance) {
    settingsServiceInstance.clear();
  }
  settingsServiceInstance = null;
  clearActiveProviderRuntimeContext();
}
