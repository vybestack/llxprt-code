/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export {
  MemoryTokenStore,
  makeExpiredToken,
  makeToken,
  createTestProvider,
} from '../../../../../providers/src/auth/__tests__/behavioral/test-utils.js';

import {
  ProviderManager,
  FakeProvider,
} from '@vybestack/llxprt-code-providers';
import { SettingsService } from '@vybestack/llxprt-code-settings';
interface FakeOauthProbe {
  oauthCalled: boolean;
  providerCalled: boolean;
  refreshMethod: string | undefined;
  contentProviderManager: unknown;
}

export function makeFakeConfigForOauth(
  hasActiveProvider: boolean,
  fixturePath: string,
): {
  config: unknown;
  probe: FakeOauthProbe;
  manager: ProviderManager;
  refreshClient: (method?: string) => Promise<void>;
} {
  const probe: FakeOauthProbe = {
    oauthCalled: false,
    providerCalled: false,
    refreshMethod: undefined,
    contentProviderManager: undefined,
  };
  const manager = new ProviderManager({
    settingsService: new SettingsService(),
  });
  if (hasActiveProvider) {
    manager.registerProvider(new FakeProvider(fixturePath, process.cwd()));
    manager.setActiveProvider('fake');
  }
  const contentGenConfig: { providerManager?: unknown } = {};
  const refreshClient = async (method?: string) => {
    probe.refreshMethod = method;
    probe.oauthCalled = method === 'oauth';
    probe.providerCalled = method === 'provider';
  };

  const config = {
    onEphemeralSettingChange: () => () => {},
    onTelemetrySettingsChange: () => () => {},
    getEphemeralSetting: () => undefined,
    setEphemeralSetting: () => {},
    getContentGeneratorConfig: () => {
      probe.contentProviderManager = contentGenConfig.providerManager;
      return contentGenConfig;
    },
    getProvider: () => undefined,
    getModel: () => 'placeholder-model',
    getSettingsService: () => ({ getValue: () => undefined }),
  };
  return { config, probe, manager, refreshClient };
}
