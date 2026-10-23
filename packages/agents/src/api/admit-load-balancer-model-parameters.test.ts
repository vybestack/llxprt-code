/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  LoadBalancingProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { admitLoadBalancerModelParameters } from './admit-load-balancer-model-parameters.js';

function setup(): {
  settings: SettingsService;
  provider: LoadBalancingProvider;
} {
  const settings = new SettingsService();
  const manager = new ProviderManager(
    undefined,
    undefined,
    undefined,
    undefined,
    settings,
    createRuntimeConfigStub(settings),
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
          modelParams: { temperature: 0.1, presence_penalty: 0.2 },
        },
        {
          name: 'beta',
          providerName: 'openai',
          model: 'beta-model',
          ephemeralSettings: {},
          modelParams: { temperature: 0.2, presence_penalty: 0.4 },
        },
      ],
      lbProfileModelParams: { temperature: 0.3 },
    },
    manager,
  );
  return { settings, provider };
}

describe('agent load-balancer parameter admission', () => {
  it.each([0, 1, 2])(
    'captures distinct member partitions through %i wrappers',
    (depth) => {
      const { settings, provider } = setup();
      const wrapped = Array.from({ length: depth }).reduce<unknown>(
        (current) => ({ wrappedProvider: current }),
        provider,
      );
      const captured = admitLoadBalancerModelParameters(wrapped, settings);
      settings.setProviderSetting('load-balancer', 'temperature', 0.8);
      expect(
        captured.loadBalancer?.members.map(
          (member) => member.parameters.modelParams,
        ),
      ).toMatchObject([
        { temperature: 0.3, presence_penalty: 0.2 },
        { temperature: 0.3, presence_penalty: 0.4 },
      ]);
    },
  );

  it('captures fresh settings independently of a previously admitted revision', () => {
    const { settings, provider } = setup();
    admitLoadBalancerModelParameters(provider, settings);
    settings.setProviderSetting('load-balancer', 'temperature', 0.8);
    expect(
      admitLoadBalancerModelParameters(
        provider,
        settings,
      ).loadBalancer?.members.map(
        (member) => member.parameters.modelParams.temperature,
      ),
    ).toStrictEqual([0.8, 0.8]);
  });

  it.each([null, undefined, {}, { wrappedProvider: {} }])(
    'rejects an unavailable load-balancer binding: %j',
    (provider) => {
      expect(() =>
        admitLoadBalancerModelParameters(provider, new SettingsService()),
      ).toThrow('Active load balancer has no selectable provider binding');
    },
  );
});
