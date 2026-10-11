/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config, MessageBus } from '@vybestack/llxprt-code-core';
import type {
  IOAuthSettingsProvider,
  OAuthUICallback,
} from '@vybestack/llxprt-code-auth';
import type { ProviderManager } from '../ProviderManager.js';
import type { IFileSystem } from './IFileSystem.js';
import type { ProviderContributionRegistry } from './runtimePlugins/types.js';

export interface ProviderManagerFactoryOptions {
  fileSystem: IFileSystem;
  manager?: ProviderManager;
  config?: Config;
  allowBrowserEnvironment?: boolean;
  activateConfiguredProvider?: boolean;
  /**
   * OAuth settings surface injected by the composition root (CLI). Supplies
   * OAuth enablement read/write with full fidelity (comment-preserving writes
   * live in the CLI's settings layer). When omitted, the OAuth manager runs
   * without a settings provider — matching the prior behavior when no user
   * settings file was present.
   */
  oauthSettings?: IOAuthSettingsProvider;
  addItem?: OAuthUICallback;
  runtimeMessageBus?: MessageBus;
  /**
   * The provider contribution registry alias construction dispatches through.
   * The composition root (CLI) loads the configured runtime plugins once at
   * startup and passes the resulting local immutable registry here. When
   * omitted, alias construction uses the built-ins-only registry.
   */
  providerContributions?: ProviderContributionRegistry;
}
