import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from '@vybestack/llxprt-code-agents';

import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { describe, expect, it, vi } from 'bun:test';
import { coreEvents } from '@vybestack/llxprt-code-core';
import {
  applyZedConfigOption,
  buildZedConfigOptions,
  dispatchZedConfigOption,
  observeZedConfigOptions,
  setZedConfigOption,
  zedConfigOptionsForClient,
  zedSessionConfigOptions,
} from './zed-config-options.js';

function configFixture(
  values: Record<string, unknown> = {},
): Pick<Agent, 'getEphemeralSetting' | 'setEphemeralSetting'> {
  return {
    getEphemeralSetting: (key: string) => values[key],
    setEphemeralSetting: (key: string, value: unknown) => {
      values[key] = value;
    },
  };
}

const modelCatalogue = {
  listAvailableModels: async () => [
    { id: 'alpha', name: 'Alpha', provider: 'test' },
    { id: 'beta', name: 'Beta', provider: 'test' },
  ],
};

describe('Zed config options', () => {
  it('maps active-provider models and current settings to strict ACP selects', async () => {
    const config = configFixture({
      'reasoning.effort': 'high',
      emojifilter: 'warn',
    });
    const options = await buildZedConfigOptions(
      () => 'alpha',
      modelCatalogue.listAvailableModels,
      config.getEphemeralSetting.bind(config),
    );

    expect(
      options.map(({ id, currentValue }) => ({ id, currentValue })),
    ).toStrictEqual([
      { id: 'model', currentValue: 'alpha' },
      { id: 'reasoning.effort', currentValue: 'high' },
      { id: 'emojifilter', currentValue: 'warn' },
    ]);
    expect(options.find(({ id }) => id === 'model')).toMatchObject({
      category: 'model',
      options: [
        { value: 'alpha', name: 'Alpha' },
        { value: 'beta', name: 'Beta' },
      ],
    });
  });

  it('omits the model selector when the agent has no current model', async () => {
    const config = configFixture();
    const options = await buildZedConfigOptions(
      () => '',
      modelCatalogue.listAvailableModels,
      config.getEphemeralSetting.bind(config),
    );

    expect(options.map(({ id }) => id)).toStrictEqual([
      'reasoning.effort',
      'emojifilter',
    ]);
  });

  it('applies validated settings and returns the updated snapshot', async () => {
    const values: Record<string, unknown> = {};
    const config = configFixture(values);
    const options = await applyZedConfigOption(
      () => 'alpha',
      modelCatalogue.listAvailableModels,
      async () => undefined,
      config.getEphemeralSetting.bind(config),
      config.setEphemeralSetting.bind(config),
      'emojifilter',
      'error',
    );

    expect(values.emojifilter).toBe('error');
    expect(options.find(({ id }) => id === 'emojifilter')).toMatchObject({
      currentValue: 'error',
    });
  });

  it('omits initial options unless the client advertises config support', async () => {
    const config = configFixture();
    await expect(
      zedConfigOptionsForClient(
        undefined,
        () => 'alpha',
        modelCatalogue.listAvailableModels,
        config.getEphemeralSetting.bind(config),
      ),
    ).resolves.toStrictEqual({});
    const supported = await zedConfigOptionsForClient(
      { session: { configOptions: true } },
      () => 'alpha',
      modelCatalogue.listAvailableModels,
      config.getEphemeralSetting.bind(config),
    );
    expect(supported.configOptions?.map(({ id }) => id)).toStrictEqual([
      'model',
      'reasoning.effort',
      'emojifilter',
    ]);
    await expect(
      zedConfigOptionsForClient(
        { session: { configOptions: false } },
        () => 'alpha',
        modelCatalogue.listAvailableModels,
        config.getEphemeralSetting.bind(config),
      ),
    ).resolves.toStrictEqual({});
  });

  it('gates loaded snapshots and mutations on explicit client support', async () => {
    const getConfigOptions = vi.fn(async () => []);
    await expect(
      zedSessionConfigOptions(
        { session: { configOptions: false } },
        { getConfigOptions },
      ),
    ).resolves.toStrictEqual({});
    expect(getConfigOptions).not.toHaveBeenCalled();

    const setConfigOption = vi.fn(async () => ({ configOptions: [] }));
    expect(() =>
      dispatchZedConfigOption(
        { session: { configOptions: false } },
        new Map([['session-1', { setConfigOption }]]),
        {
          sessionId: 'session-1',
          configId: 'emojifilter',
          value: 'warn',
        },
      ),
    ).toThrow('Config options not supported by client');
    expect(setConfigOption).not.toHaveBeenCalled();
  });

  it('switches models and strictly publishes the updated full snapshot', async () => {
    const config = configFixture();
    let currentModel = 'alpha';
    const result = await setZedConfigOption(
      () => currentModel,
      modelCatalogue.listAvailableModels,
      async (model: string) => {
        currentModel = model;
      },
      config.getEphemeralSetting.bind(config),
      config.setEphemeralSetting.bind(config),
      'model',
      'beta',
    );

    expect(currentModel).toBe('beta');
    expect(result.configOptions.find(({ id }) => id === 'model')).toMatchObject(
      { currentValue: 'beta' },
    );
  });

  it('wraps model switch failures without exposing provider details', async () => {
    const config = configFixture();
    const failure = applyZedConfigOption(
      () => 'alpha',
      modelCatalogue.listAvailableModels,
      async () => {
        throw new Error('secret provider diagnostic');
      },
      config.getEphemeralSetting.bind(config),
      config.setEphemeralSetting.bind(config),
      'model',
      'beta',
    );

    const error = await failure.catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: -32603,
      data: { configId: 'model' },
    });
    expect(JSON.stringify(error)).not.toContain('secret provider diagnostic');
  });

  it('publishes agent-side setting changes and removes listeners on teardown', async () => {
    const owner = new SessionSettingsOwner(new SettingsService());
    const sendUpdate = vi.fn(async () => undefined);
    const config = configFixture();
    const stop = observeZedConfigOptions(
      () => 'alpha',
      modelCatalogue.listAvailableModels,
      config.getEphemeralSetting.bind(config),
      sendUpdate,
      vi.fn(),
      (listener) => owner.subscribeModelChanges(listener),
    );

    try {
      coreEvents.emitSettingsChanged();
      await waitFor(() => expect(sendUpdate).toHaveBeenCalledOnce());
      owner.publishModelProfile({
        model: 'alpha',
        providerName: 'test',
        displayLabel: 'test:alpha',
      });
      await waitFor(() => expect(sendUpdate).toHaveBeenCalledTimes(2));
      stop();
      coreEvents.emitSettingsChanged();
      expect(sendUpdate).toHaveBeenCalledTimes(2);
    } finally {
      stop();
      await owner.dispose();
    }
  });
});
