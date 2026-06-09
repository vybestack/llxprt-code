/**
 * @plan PLAN-20260608-ISSUE1588.P06
 * @requirement REQ-SVC-001
 *
 * Core-owned adapter bridging settings-package lifecycle with core
 * provider-runtime context helpers. This is the sole production file that
 * imports/constructs settings-package SettingsService while mutating the
 * active provider runtime context.
 */

import {
  SettingsService,
  getSettingsService,
  registerSettingsService,
  resetSettingsService,
} from '@vybestack/llxprt-code-settings';
import type { Config } from '../config/config.js';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
  peekActiveProviderRuntimeContext,
  setProviderRuntimeStateFactory,
  type ProviderRuntimeContext,
  type ProviderRuntimeContextInit,
} from './providerRuntimeContext.js';

setProviderRuntimeStateFactory(() => new SettingsService());

export function createRuntimeSettingsService(): SettingsService {
  return new SettingsService();
}

export interface SettingsProviderRuntimeContextInit
  extends Omit<ProviderRuntimeContextInit, 'settingsService' | 'config'> {
  settingsService?: SettingsService | null;
  config?: Config;
}

export function resolveRuntimeSettingsService(
  settingsService?: SettingsService | null,
): SettingsService {
  if (settingsService) {
    return settingsService;
  }

  const activeContext = peekActiveProviderRuntimeContext();
  if (activeContext?.settingsService) {
    return activeContext.settingsService as SettingsService;
  }

  try {
    return getSettingsService();
  } catch {
    // No singleton has been registered yet; create an isolated runtime service.
  }

  return createRuntimeSettingsService();
}

export function getRuntimeSettingsService(): SettingsService {
  const activeContext = peekActiveProviderRuntimeContext();
  if (activeContext?.settingsService) {
    return activeContext.settingsService as SettingsService;
  }

  return getSettingsService();
}

export function maybeGetRuntimeSettingsService(): SettingsService | undefined {
  try {
    return getRuntimeSettingsService();
  } catch {
    return undefined;
  }
}

export function createSettingsProviderRuntimeContext(
  init: SettingsProviderRuntimeContextInit = {},
): ProviderRuntimeContext {
  return createProviderRuntimeContext({
    ...init,
    settingsService: resolveRuntimeSettingsService(init.settingsService),
  });
}

export function setSettingsProviderRuntimeContext(
  context: ProviderRuntimeContext | null,
): void {
  setActiveProviderRuntimeContext(context);
  if (context?.settingsService) {
    registerSettingsService(context.settingsService as SettingsService);
  }
}

export function clearSettingsProviderRuntimeContext(): void {
  clearActiveProviderRuntimeContext();
}

/**
 * Activate a runtime context with the given settings service.
 * Creates a ProviderRuntimeContext, sets it as the active context,
 * and registers the settings service with the settings-package singleton.
 */
export function activateSettingsRuntimeContext(
  settingsService: SettingsService,
  runtimeId?: string,
  options: { config?: Config; metadata?: Record<string, unknown> } = {},
): void {
  const context = createSettingsProviderRuntimeContext({
    settingsService,
    config: options.config,
    runtimeId,
    metadata: options.metadata,
  });
  setSettingsProviderRuntimeContext(context);
}

/**
 * Deactivate the current runtime context and reset settings state.
 * Clears the active provider runtime context and resets the
 * settings-package singleton.
 */
export function deactivateSettingsRuntimeContext(): void {
  clearSettingsProviderRuntimeContext();
  resetSettingsService();
}
