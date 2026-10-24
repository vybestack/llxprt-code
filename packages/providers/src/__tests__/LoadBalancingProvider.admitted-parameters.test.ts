/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { LoadBalancingProvider } from '../LoadBalancingProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import { normalizeRuntimeInputs } from '../runtimeNormalizer.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';

const requestFetch: NetworkFetch = () =>
  Promise.reject(new Error('This test must not make network requests'));

function setup(): {
  settings: SettingsService;
  provider: LoadBalancingProvider;
  manager: ProviderManager;
} {
  const settings = new SettingsService();
  const config = createRuntimeConfigStub(settings);
  const manager = new ProviderManager(
    undefined,
    undefined,
    undefined,
    undefined,
    settings,
    config,
  );
  const provider = new LoadBalancingProvider(
    {
      profileName: 'routing',
      strategy: 'failover',
      subProfiles: [
        {
          name: 'alpha',
          providerName: 'openai',
          model: 'alpha-model',
          ephemeralSettings: {},
          modelParams: { presence_penalty: 0.2, temperature: 0.1 },
        },
        {
          name: 'beta',
          providerName: 'openai',
          model: 'beta-model',
          ephemeralSettings: {},
          modelParams: { presence_penalty: 0.4, temperature: 0.2 },
        },
      ],
      lbProfileModelParams: { temperature: 0.3 },
    },
    manager,
  );
  manager.registerProvider(provider);
  manager.setActiveProvider('load-balancer');
  return { settings, provider, manager };
}

describe('Load-balancer admission normalization', () => {
  it('keeps per-slot member values distinct and applies LB overrides after member parameters', () => {
    const { settings, provider } = setup();
    const captured = provider.admitModelParameters(settings);
    const members = captured.loadBalancer?.members;
    expect(
      members?.map((member) => member.parameters.modelParams),
    ).toMatchObject([
      { presence_penalty: 0.2, temperature: 0.3 },
      { presence_penalty: 0.4, temperature: 0.3 },
    ]);
    settings.setProviderSetting('load-balancer', 'temperature', 0.8);
    expect(
      members?.map((member) => member.parameters.modelParams.temperature),
    ).toStrictEqual([0.3, 0.3]);
    expect(
      provider
        .admitModelParameters(settings)
        .loadBalancer?.members.map(
          (member) => member.parameters.modelParams.temperature,
        ),
    ).toStrictEqual([0.8, 0.8]);
  });

  it('normalizes an LB invocation without replacing it with a member partition', () => {
    const { settings, provider, manager } = setup();
    const captured = provider.admitModelParameters(settings);
    const normalized = normalizeRuntimeInputs(
      {
        contents: [],
        invocation: captureProviderInvocation(
          {
            fetch: requestFetch,
            runtimeId: 'test-owner',
            globalSettings: settings.getAllGlobalSettings(),
            providerSettings: settings.getProviderSettings('load-balancer'),
          },
          'load-balancer',
          captured,
        ),

        resolved: { model: 'routing' },
        modelParameters: captured,
      },
      {
        admitRequest: (options) => options,
        getActiveProviderName: () => manager.getActiveProviderName(),
        getProvider: (name) => manager.getProviderByName(name),
      },
    );
    expect(normalized.invocation?.modelParams).not.toHaveProperty(
      'presence_penalty',
    );
    expect(normalized.invocation?.getModelParam('temperature')).toBeUndefined();
    expect(normalized.modelParameters?.loadBalancer?.members).toHaveLength(2);
  });
});
