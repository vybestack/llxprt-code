/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type {
  Config,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import { OAuthManager } from '../../auth/oauth-manager.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { switchActiveProvider, ProviderSwitcher } from '../index.js';
import {
  assembleModelSelection,
  type setActiveModel,
} from '../providerMutations.js';
import type { setProviderApiKey } from '../providerConfigUtils.js';

interface ProviderFixtureRoot {
  readonly oauthManager?: OAuthManager;
  readonly config: Config;
  readonly settingsService: SettingsService;
  readonly settingsOwner: SessionSettingsOwner;
}

export function modelParamInputs(
  root: ProviderFixtureRoot,
  providerManager: RuntimeProviderManager,
): [SettingsService, string | undefined] {
  return [root.settingsService, providerManager.getActiveProviderName()];
}

export async function providerSwitchInputs(
  root: ProviderFixtureRoot,
  providerManager: RuntimeProviderManager,
  initializeClient: () => Promise<void>,
): Promise<
  [
    Parameters<typeof switchActiveProvider>[2],
    Parameters<typeof switchActiveProvider>[3],
    Parameters<typeof switchActiveProvider>[4],
    Parameters<typeof switchActiveProvider>[5],
    Parameters<typeof switchActiveProvider>[6],
    Parameters<typeof switchActiveProvider>[7],
    Parameters<typeof switchActiveProvider>[8],
  ]
> {
  const oauthManager = root.oauthManager;
  root.settingsOwner.assertSettingsIdentity(root.settingsService);
  return [
    root.config,
    root.settingsService,
    providerManager,
    oauthManager instanceof OAuthManager ? oauthManager : null,
    undefined,
    initializeClient,
    root.settingsOwner,
  ];
}

export async function providerSwitchForTest(
  root: ProviderFixtureRoot,
  providerManager: RuntimeProviderManager,
  initializeClient: () => Promise<void>,
): Promise<ProviderSwitcher> {
  const { switchActiveProvider } = await import('../index.js');
  const inputs = await providerSwitchInputs(
    root,
    providerManager,
    initializeClient,
  );
  return (name, options = {}) => switchActiveProvider(name, options, ...inputs);
}

export async function baseUrlInputs(
  root: ProviderFixtureRoot,
  providerManager: RuntimeProviderManager,
): Promise<[Parameters<typeof setProviderApiKey>[1], SettingsService, string]> {
  const provider = providerManager.getActiveProvider();
  if (!provider) throw new Error('Test requires an active provider');
  const [operations, settingsService] = await overrideInputs(root);
  return [operations, settingsService, provider.name];
}

export async function overrideInputs(
  root: ProviderFixtureRoot,
): Promise<[Parameters<typeof setProviderApiKey>[1], SettingsService]> {
  return [
    {
      setEphemeralSetting: (key, value) =>
        root.settingsOwner.writeUserParameter(key, value),
    },
    root.settingsService,
  ];
}

export async function modelSelectionInputs(
  root: ProviderFixtureRoot,
): Promise<[Parameters<typeof setActiveModel>[1], SettingsService]> {
  return [assembleModelSelection(root.settingsOwner), root.settingsService];
}

export async function switchProviderForTest(
  name: string,
  options: Parameters<ProviderSwitcher>[1],
  root: ProviderFixtureRoot,
  providerManager: RuntimeProviderManager,
  initializeClient: () => Promise<void>,
): ReturnType<ProviderSwitcher> {
  return (await providerSwitchForTest(root, providerManager, initializeClient))(
    name,
    options,
  );
}
