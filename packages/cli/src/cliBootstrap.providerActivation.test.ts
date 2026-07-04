/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core';
import type { CliProviderManager, ParsedCliArgs } from './cliBootstrap.js';

const {
  applyCliArgumentOverridesMock,
  clearActiveModelParamMock,
  getActiveModelParamsMock,
  setActiveModelMock,
  setActiveModelParamMock,
  switchActiveProviderMock,
} = vi.hoisted(() => ({
  applyCliArgumentOverridesMock: vi.fn(async () => {}),
  clearActiveModelParamMock: vi.fn(),
  getActiveModelParamsMock: vi.fn(() => ({})),
  setActiveModelMock: vi.fn(async () => undefined),
  setActiveModelParamMock: vi.fn(),
  switchActiveProviderMock: vi.fn(async () => undefined),
}));

vi.mock(
  '@vybestack/llxprt-code-providers/runtime.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@vybestack/llxprt-code-providers/runtime.js')
      >();
    return {
      ...actual,
      applyCliArgumentOverrides: applyCliArgumentOverridesMock,
      clearActiveModelParam: clearActiveModelParamMock,
      getActiveModelParams: getActiveModelParamsMock,
      setActiveModel: setActiveModelMock,
      setActiveModelParam: setActiveModelParamMock,
      switchActiveProvider: switchActiveProviderMock,
    };
  },
);

import { activateConfiguredProvider } from './cliBootstrap.js';

function makeConfig(
  provider: string,
  initialEphemerals: Record<string, unknown> = {},
  model = 'glm-5.2',
): Config {
  const ephemerals = { ...initialEphemerals };
  return {
    getProvider: () => provider,
    getModel: () => model,
    getEphemeralSetting: (key: string) => ephemerals[key],
    setEphemeralSetting: (key: string, value: unknown) => {
      ephemerals[key] = value;
    },
    refreshAuth: vi.fn(async () => undefined),
  } as unknown as Config;
}

function makeProviderManager(
  activeProviderName: string,
  defaultModel?: string,
): CliProviderManager {
  return {
    getActiveProviderName: () => activeProviderName,
    getActiveProvider: () => ({
      name: activeProviderName,
      getDefaultModel:
        defaultModel === undefined ? undefined : () => defaultModel,
    }),
  } as unknown as CliProviderManager;
}

function makeArgs(): ParsedCliArgs {
  return {
    provider: undefined,
  } as unknown as ParsedCliArgs;
}

describe('activateConfiguredProvider', () => {
  beforeEach(() => {
    applyCliArgumentOverridesMock.mockClear();
    clearActiveModelParamMock.mockClear();
    getActiveModelParamsMock.mockClear();
    getActiveModelParamsMock.mockReturnValue({});
    setActiveModelMock.mockClear();
    setActiveModelParamMock.mockClear();
    switchActiveProviderMock.mockClear();
  });

  it('refreshes auth without switching when the configured provider is already active', async () => {
    const config = makeConfig('anthropic');
    const providerManager = makeProviderManager('anthropic');

    const failed = await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
    );

    expect(failed).toBe(false);
    expect(switchActiveProviderMock).not.toHaveBeenCalled();
    expect(config.refreshAuth).toHaveBeenCalledTimes(1);
    expect(setActiveModelMock).toHaveBeenCalledWith('glm-5.2');
  });

  it('does not refresh auth when a profile keyfile provider is already active', async () => {
    const config = makeConfig('anthropic', {
      'auth-keyfile': '/Users/example/.keys/glm.key',
    });
    const providerManager = makeProviderManager('anthropic');

    const failed = await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
    );

    expect(failed).toBe(false);
    expect(switchActiveProviderMock).not.toHaveBeenCalled();
    expect(config.refreshAuth).not.toHaveBeenCalled();
    expect(setActiveModelMock).toHaveBeenCalledWith('glm-5.2');
  });

  it('switches and refreshes auth when the configured provider is not active', async () => {
    const config = makeConfig('anthropic');
    const providerManager = makeProviderManager('gemini');

    const failed = await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
    );

    expect(failed).toBe(false);
    expect(switchActiveProviderMock).toHaveBeenCalledWith('anthropic');
    expect(config.refreshAuth).toHaveBeenCalledTimes(1);
    expect(setActiveModelMock).toHaveBeenCalledWith('glm-5.2');
  });

  it('reapplies profile auth ephemerals before refreshing auth after a real switch', async () => {
    const config = makeConfig('anthropic', {
      'auth-keyfile': '/Users/example/.keys/glm.key',
      'base-url': 'https://api.z.ai/api/anthropic',
    });
    const providerManager = makeProviderManager('gemini');
    switchActiveProviderMock.mockImplementationOnce(async () => {
      config.setEphemeralSetting('auth-keyfile', undefined);
      config.setEphemeralSetting('base-url', undefined);
    });

    const failed = await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
    );

    expect(failed).toBe(false);
    expect(switchActiveProviderMock).toHaveBeenCalledWith('anthropic');
    expect(config.getEphemeralSetting('auth-keyfile')).toBe(
      '/Users/example/.keys/glm.key',
    );
    expect(config.getEphemeralSetting('base-url')).toBe(
      'https://api.z.ai/api/anthropic',
    );
    expect(config.refreshAuth).toHaveBeenCalledTimes(1);
    expect(setActiveModelMock).toHaveBeenCalledWith('glm-5.2');
  });

  it('defaults to active provider when config has no provider set', async () => {
    const config = makeConfig('');
    const providerManager = makeProviderManager('gemini');

    const failed = await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
    );

    expect(failed).toBe(false);
    expect(switchActiveProviderMock).toHaveBeenCalledWith('gemini');
    expect(config.refreshAuth).toHaveBeenCalledTimes(1);
  });

  it('returns false and swallows errors in the no-provider path', async () => {
    const config = makeConfig('');
    const providerManager = makeProviderManager('gemini');
    switchActiveProviderMock.mockRejectedValueOnce(
      new Error('default switch failed'),
    );

    const failed = await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
    );

    expect(failed).toBe(false);
    expect(config.refreshAuth).not.toHaveBeenCalled();
    expect(setActiveModelMock).not.toHaveBeenCalled();
  });

  it('returns true when provider switch fails', async () => {
    const config = makeConfig('anthropic');
    const providerManager = makeProviderManager('gemini');
    switchActiveProviderMock.mockRejectedValueOnce(new Error('switch failed'));

    const failed = await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
    );

    expect(failed).toBe(true);
  });

  it('returns true when auth refresh fails after provider switch', async () => {
    const config = makeConfig('anthropic');
    const providerManager = makeProviderManager('gemini');
    vi.mocked(config.refreshAuth).mockRejectedValueOnce(
      new Error('refresh failed'),
    );

    const failed = await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
    );

    expect(failed).toBe(true);
    expect(switchActiveProviderMock).toHaveBeenCalledWith('anthropic');
  });

  it('applies CLI overrides before activation and clears stale model params', async () => {
    const args = makeArgs();
    const config = makeConfig('anthropic');
    (
      config as Config & { _profileModelParams?: Record<string, unknown> }
    )._profileModelParams = {
      temperature: 0.2,
    };
    const providerManager = makeProviderManager('anthropic');
    getActiveModelParamsMock.mockReturnValue({ staleParam: 'old' });

    const failed = await activateConfiguredProvider(
      config,
      providerManager,
      args,
    );

    expect(failed).toBe(false);
    expect(setActiveModelParamMock).toHaveBeenCalledWith('temperature', 0.2);
    expect(applyCliArgumentOverridesMock).toHaveBeenCalledWith(args, undefined);
    expect(clearActiveModelParamMock).toHaveBeenCalledWith('staleParam');
  });

  it('uses provider default model when config model is placeholder-model', async () => {
    const config = makeConfig('anthropic', {}, 'placeholder-model');
    const providerManager = makeProviderManager('anthropic', 'claude-default');

    const failed = await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
    );

    expect(failed).toBe(false);
    expect(setActiveModelMock).toHaveBeenCalledWith('claude-default');
  });

  it('does not set active model when resolved model remains placeholder-model', async () => {
    const config = makeConfig('anthropic', {}, 'placeholder-model');
    const providerManager = makeProviderManager('anthropic');

    const failed = await activateConfiguredProvider(
      config,
      providerManager,
      makeArgs(),
    );

    expect(failed).toBe(false);
    expect(setActiveModelMock).not.toHaveBeenCalled();
  });
});
