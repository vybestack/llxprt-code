/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  Config,
  RuntimeProviderManager,
  ProviderSwitcher,
} from '@vybestack/llxprt-code-core';
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { switchActiveProvider } from './provider-switch/provider-switch.js';
import { checkpointProviderTransition } from './providerTransitionCheckpoint.js';

export function assembleProviderSwitch(
  config: Config,
  settings: SettingsService,
  manager: RuntimeProviderManager,
  oauth: OAuthManager | null,
  readKind: () => RuntimeKind | undefined,
  initializeClient: () => Promise<void>,
  settingsOwner: SessionSettingsOwner,
): ProviderSwitcher {
  return async (name, options = {}) => {
    const restore = checkpointProviderTransition(
      settingsOwner,
      settings,
      manager,
      oauth?.checkpointRetryHandlers() ?? (() => {}),
    );
    const publish = options.publication !== 'deferred';
    const publication = publish
      ? settingsOwner.beginModelPublication()
      : undefined;
    let result;
    try {
      result = await switchActiveProvider(
        name,
        { ...options, publication: 'deferred' },
        config,
        settings,
        manager,
        oauth,
        readKind(),
        initializeClient,
        settingsOwner,
      );
    } catch (error) {
      try {
        restore();
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Provider switch rollback failed',
        );
      } finally {
        publication?.rollback();
      }
      throw error;
    }
    publication?.commit();
    if (publish && result.changed) {
      const model = settingsOwner.readSelectedModel() ?? result.nextProvider;
      const profileName = settings.getCurrentProfileName();
      settingsOwner.publishModelProfile({
        model,
        providerName: result.nextProvider,
        profileName,
        displayLabel: profileName ?? model,
      });
    }
    return result;
  };
}
