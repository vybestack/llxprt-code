/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  CoreEvent,
  coreEvents,
  type Config,
  type RuntimeModel,
} from '@vybestack/llxprt-code-core';
import {
  applyZedConfigOption,
  buildZedConfigOptions,
  dispatchZedConfigOption,
  observeZedConfigOptions,
  setZedConfigOption,
  zedConfigOptionsForClient,
  zedSessionConfigOptions,
} from './zed-config-options.js';

function configFixture(values: Record<string, unknown> = {}): Config {
  const models: RuntimeModel[] = [
    { id: 'alpha', name: 'Alpha', provider: 'test' },
    { id: 'beta', name: 'Beta', provider: 'test' },
  ];
  return {
    getModel: () => 'alpha',
    getEphemeralSetting: (key: string) => values[key],
    setEphemeralSetting: (key: string, value: unknown) => {
      values[key] = value;
    },
    getProviderManager: () => ({ getAvailableModels: async () => models }),
  } as Config;
}

describe('Zed config options', () => {
  it('maps active-provider models and current settings to strict ACP selects', async () => {
    const options = await buildZedConfigOptions(
      {
        getModel: () => 'alpha',
        getProviderStatus: () => ({
          provider: 'test',
          model: 'alpha',
          authStatus: 'authenticated' as const,
        }),
      },
      configFixture({ 'reasoning.effort': 'high', emojifilter: 'warn' }),
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
    const options = await buildZedConfigOptions(
      {
        getModel: () => '',
        getProviderStatus: () => ({
          provider: 'test',
          model: '',
          authStatus: 'authenticated' as const,
        }),
      },
      configFixture(),
    );

    expect(options.map(({ id }) => id)).toStrictEqual([
      'reasoning.effort',
      'emojifilter',
    ]);
  });

  it('applies validated settings and returns the updated snapshot', async () => {
    const values: Record<string, unknown> = {};
    const options = await applyZedConfigOption(
      {
        getModel: () => 'alpha',
        getProviderStatus: () => ({
          provider: 'test',
          model: 'alpha',
          authStatus: 'authenticated' as const,
        }),
      } as unknown as Agent,
      configFixture(values),
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
        {
          getModel: () => 'alpha',
          getProviderStatus: () => ({
            provider: 'test',
            model: 'alpha',
            authStatus: 'authenticated' as const,
          }),
        },
        config,
      ),
    ).resolves.toStrictEqual({});
    const supported = await zedConfigOptionsForClient(
      { session: { configOptions: true } },
      {
        getModel: () => 'alpha',
        getProviderStatus: () => ({
          provider: 'test',
          model: 'alpha',
          authStatus: 'authenticated' as const,
        }),
      },
      config,
    );
    expect(supported.configOptions?.map(({ id }) => id)).toStrictEqual([
      'model',
      'reasoning.effort',
      'emojifilter',
    ]);
    await expect(
      zedConfigOptionsForClient(
        { session: { configOptions: false } },
        {
          getModel: () => 'alpha',
          getProviderStatus: () => ({
            provider: 'test',
            model: 'alpha',
            authStatus: 'authenticated' as const,
          }),
        },
        config,
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
      {
        setModel: async (model: string) => {
          currentModel = model;
        },
        getModel: () => currentModel,
        getProviderStatus: () => ({
          provider: 'test',
          model: 'alpha',
          authStatus: 'authenticated' as const,
        }),
      } as unknown as Agent,
      config,
      'model',
      'beta',
    );

    expect(currentModel).toBe('beta');
    expect(result.configOptions.find(({ id }) => id === 'model')).toMatchObject(
      { currentValue: 'beta' },
    );
  });

  it('wraps model switch failures without exposing provider details', async () => {
    const failure = applyZedConfigOption(
      {
        setModel: async () => {
          throw new Error('secret provider diagnostic');
        },
        getModel: () => 'alpha',
        getProviderStatus: () => ({
          provider: 'test',
          model: 'alpha',
          authStatus: 'authenticated' as const,
        }),
      } as unknown as Agent,
      configFixture(),
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
    const sendUpdate = vi.fn(async () => undefined);
    const stop = observeZedConfigOptions(
      {
        getModel: () => 'alpha',
        getProviderStatus: () => ({
          provider: 'test',
          model: 'alpha',
          authStatus: 'authenticated' as const,
        }),
      },
      configFixture(),
      sendUpdate,
      vi.fn(),
    );

    try {
      coreEvents.emitSettingsChanged();
      await vi.waitFor(() => expect(sendUpdate).toHaveBeenCalledOnce());
      coreEvents.emit(CoreEvent.ModelProfileChanged, {
        model: 'alpha',
        providerName: 'test',
        displayLabel: 'test:alpha',
      });
      await vi.waitFor(() => expect(sendUpdate).toHaveBeenCalledTimes(2));
      stop();
      coreEvents.emitSettingsChanged();
      expect(sendUpdate).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });
});
