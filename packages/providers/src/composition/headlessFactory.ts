/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Headless provider-manager construction.
 *
 * {@link createHeadlessProviderManager} builds a fully functional
 * {@link ProviderManager} (with alias providers + OAuth infrastructure) from a
 * minimal {@link ProviderRuntimeContext} backed only by a fresh
 * {@link SettingsService}. It deliberately imports nothing from the CLI package,
 * proving (issue #1594) that a working provider can be constructed headlessly.
 */

import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { ProviderManager } from '../ProviderManager.js';
import type { OAuthManager } from '../auth/index.js';
import { createProviderManager } from './providerManagerInstance.js';

/**
 * Options for constructing a headless provider manager.
 */
export interface HeadlessProviderManagerOptions {
  /** Provider name to activate (e.g. 'openai', 'anthropic', 'gemini'). */
  provider: string;
  /** API key to apply to the active provider's scoped settings. */
  apiKey?: string;
  /** Base URL to apply to the active provider's scoped settings. */
  baseUrl?: string;
  /** Model to apply to the active provider's scoped settings. */
  model?: string;
}

/**
 * Construct a {@link ProviderManager} without importing anything from the CLI.
 *
 * 1. Builds a minimal {@link ProviderRuntimeContext} from a fresh
 *    {@link SettingsService} (plus a headless runtime id/metadata so it is
 *    treated as a runtime context by {@link ProviderManager}).
 * 2. Delegates to {@link createProviderManager} for alias/OAuth registration.
 * 3. Writes apiKey/baseUrl/model into the provider-scoped settings BEFORE
 *    activation. Concrete providers (via BaseProvider) resolve their effective
 *    auth-key/base-url/model from `SettingsService.getProviderSettings(name)`,
 *    so writing through the shared settings service is the supported,
 *    UI-agnostic way to configure them — the same seam the CLI runtime uses.
 * 4. Activates the requested provider.
 *
 * @returns the constructed manager and its OAuth manager.
 */
export function createHeadlessProviderManager(
  options: HeadlessProviderManagerOptions,
): { manager: ProviderManager; oauthManager: OAuthManager } {
  const settingsService = new SettingsService();
  const context: ProviderRuntimeContext = {
    settingsService,
    runtimeId: 'headless',
    metadata: { stage: 'headless' },
  };

  const { manager, oauthManager } = createProviderManager(context, {});

  if (options.apiKey !== undefined) {
    settingsService.setProviderSetting(
      options.provider,
      'auth-key',
      options.apiKey,
    );
  }
  if (options.baseUrl !== undefined) {
    settingsService.setProviderSetting(
      options.provider,
      'base-url',
      options.baseUrl,
    );
  }
  if (options.model !== undefined) {
    settingsService.setProviderSetting(
      options.provider,
      'model',
      options.model,
    );
  }

  manager.setActiveProvider(options.provider);

  return { manager, oauthManager };
}
