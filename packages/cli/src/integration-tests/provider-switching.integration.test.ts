import type { Agent } from '@vybestack/llxprt-code-agents';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  providerSwitchInputs,
  overrideInputs,
  modelParamInputs,
} from '../../../providers/src/runtime/__tests__/provider-switch-inputs.js';

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P14
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-18
 */
import { restoreGlobals, setGlobal } from '@vybestack/llxprt-code-test-utils';
import { beforeEach, afterEach, describe, expect, it, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IProvider } from '@vybestack/llxprt-code-providers';
import {
  Config,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import {
  createTempDirectory,
  cleanupTempDirectory,
  initializeTestSessionRoot,
  type CliTestSessionRoot,
} from './test-utils.js';
import {
  switchActiveProvider,
  setActiveModelParam,
  getActiveModelParams,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { assembleCliProviderRuntime } from '@vybestack/llxprt-code-providers/runtime/assembleCliProviderRuntime.js';
import type { CliRuntimeRegistrationHandle } from '@vybestack/llxprt-code-providers/runtime/cliForegroundRuntime.js';
import { setProviderApiKey } from '@vybestack/llxprt-code-providers/runtime/providerConfigUtils.js';

/**
 * @plan:PLAN-20250218-STATELESSPROVIDER.P07
 * @requirement:REQ-SP-005
 * Ensures provider switching flows rely on runtime helpers instead of
 * mutating providers directly.
 * @pseudocode:cli-runtime.md lines 9-15
 */
describe('Runtime Provider Switching Integration', () => {
  let tempDir: string;
  let config: Config;
  let sessionRoot: CliTestSessionRoot;
  let providerManager: RuntimeProviderManager;
  let settingsService: SettingsService;
  let registration: CliRuntimeRegistrationHandle;
  let sessionClient: Pick<Agent['sessionClient'], 'refreshAuth'>;

  beforeEach(async () => {
    tempDir = await createTempDirectory();

    config = new Config({
      sessionId: 'switch-session',
      targetDir: tempDir,
      debugMode: false,
      cwd: tempDir,
      model: 'test-model',
    });
    settingsService = new SettingsService();
    const assembled = assembleCliProviderRuntime({
      settingsService,
      config,
      runtimeId: 'provider-switch-test',
      metadata: { source: 'provider-switch-test' },
    });
    providerManager = assembled.providerManager;
    registration = assembled.registration;
    sessionRoot = await initializeTestSessionRoot(
      config,
      providerManager,
      settingsService,
    );
    sessionClient = sessionRoot.agent.sessionClient;
  });

  afterEach(async () => {
    registration.dispose();
    await cleanupTempDirectory(tempDir);
  });

  it('binds a provider-file lifecycle to the exact foreground Config', () => {
    expect(registration.config).toBe(config);
    expect(registration.config).toBe(config);
    expect(
      registration.providerFileLifecycle.retainsScope(
        'session',
        registration.runtimeId,
      ),
    ).toBe(false);
  });

  it('clears previous provider API key and auth state', async () => {
    const providerA = createMockProvider('providerA');
    const providerB = createMockProvider('providerB');
    providerManager.registerProvider(providerA);
    providerManager.registerProvider(providerB);

    await providerManager.setActiveProvider('providerA');
    const setResult = await setProviderApiKey(
      'key-for-provider-a',
      ...(await overrideInputs(sessionRoot)),
      providerManager.getActiveProvider(),
    );
    expect(setResult.success).toBe(true);
    expect(settingsService.getProviderSettings('providerA')['auth-key']).toBe(
      'key-for-provider-a',
    );
    expect(sessionRoot.agent.getEphemeralSetting('auth-key')).toBe(
      'key-for-provider-a',
    );

    await switchActiveProvider(
      'providerB',
      {},
      ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
        sessionClient.refreshAuth(),
      )),
    );
    expect(
      settingsService.getProviderSettings('providerA')['auth-key'],
    ).toBeUndefined();
    expect(sessionRoot.agent.getEphemeralSetting('auth-key')).toBeUndefined();

    const resultB = await setProviderApiKey(
      'key-for-provider-b',
      ...(await overrideInputs(sessionRoot)),
      providerManager.getActiveProvider(),
    );
    expect(resultB.success).toBe(true);
    expect(settingsService.getProviderSettings('providerB')['auth-key']).toBe(
      'key-for-provider-b',
    );

    await switchActiveProvider(
      'providerA',
      {},
      ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
        sessionClient.refreshAuth(),
      )),
    );
    expect(
      settingsService.getProviderSettings('providerB')['auth-key'],
    ).toBeUndefined();
  });

  it('resets provider model parameters when switching', async () => {
    const providerA = createMockProvider('providerA');
    const providerB = createMockProvider('providerB');
    providerManager.registerProvider(providerA);
    providerManager.registerProvider(providerB);

    await providerManager.setActiveProvider('providerA');
    setActiveModelParam(
      'temperature',
      0.7,
      ...modelParamInputs(sessionRoot, providerManager),
    );
    setActiveModelParam(
      'top_p',
      0.9,
      ...modelParamInputs(sessionRoot, providerManager),
    );
    expect(
      getActiveModelParams(...modelParamInputs(sessionRoot, providerManager)),
    ).toStrictEqual({
      temperature: 0.7,
      top_p: 0.9,
    });

    await switchActiveProvider(
      'providerB',
      {},
      ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
        sessionClient.refreshAuth(),
      )),
    );
    expect(
      settingsService.getProviderSettings('providerA').temperature,
    ).toBeUndefined();
    expect(
      getActiveModelParams(...modelParamInputs(sessionRoot, providerManager)),
    ).toStrictEqual({});

    setActiveModelParam(
      'temperature',
      0.3,
      ...modelParamInputs(sessionRoot, providerManager),
    );
    expect(
      getActiveModelParams(...modelParamInputs(sessionRoot, providerManager)),
    ).toStrictEqual({
      temperature: 0.3,
    });

    await switchActiveProvider(
      'providerA',
      {},
      ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
        sessionClient.refreshAuth(),
      )),
    );
    expect(
      settingsService.getProviderSettings('providerB').temperature,
    ).toBeUndefined();
    expect(
      getActiveModelParams(...modelParamInputs(sessionRoot, providerManager)),
    ).toStrictEqual({});
  });

  it('clears gemini provider settings when switching active provider', async () => {
    const geminiProvider = createMockProvider('gemini');
    const otherProvider = createMockProvider('other');

    providerManager.registerProvider(geminiProvider as never);
    providerManager.registerProvider(otherProvider);

    await providerManager.setActiveProvider('gemini');
    settingsService.setProviderSetting(
      'gemini',
      'base-url',
      'https://gemini.server-tools',
    );

    await switchActiveProvider(
      'other',
      {},
      ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
        sessionClient.refreshAuth(),
      )),
    );
    expect(
      settingsService.getProviderSettings('gemini')['base-url'],
    ).toBeUndefined();
  });

  it('is idempotent when switching to the same provider', async () => {
    const providerA = createMockProvider('providerA');
    providerManager.registerProvider(providerA);

    await providerManager.setActiveProvider('providerA');
    providerA.clearState = vi.fn(providerA.clearState);

    const result = await switchActiveProvider(
      'providerA',
      {},
      ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
        sessionClient.refreshAuth(),
      )),
    );
    expect(result.changed).toBe(false);
    expect(providerA.clearState).not.toHaveBeenCalled();
  });

  it('uses alias default model for openai when switching', async () => {
    // The gemini alias default moved to the google-gemini plugin (#2763);
    // openai's alias config is the base-package representative here.
    const openaiProvider = createMockProvider('openai');
    providerManager.registerProvider(openaiProvider as never);
    // The switch source must be a registered provider; 'other' plays that role
    // the same way it does in the gemini-settings-clearing test above.
    const otherProvider = createMockProvider('other');
    providerManager.registerProvider(otherProvider as never);

    await providerManager.setActiveProvider('other');
    await switchActiveProvider(
      'openai',
      {},
      ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
        sessionClient.refreshAuth(),
      )),
    );

    const openaiSettings = settingsService.getProviderSettings('openai');
    expect(openaiSettings.model).toBe('gpt-5.5');
    expect(sessionRoot.settingsOwner.readSelectedModel()).toBe('gpt-5.5');
  });

  it('clears legacy base URL and resets model when switching back to provider', async () => {
    const providerA = createMockProvider('providerA');
    providerA.getDefaultModel = vi.fn(() => 'providerA-default');
    const providerB = createMockProvider('providerB');

    providerManager.registerProvider(providerA);
    providerManager.registerProvider(providerB);

    await providerManager.setActiveProvider('providerA');
    settingsService.setProviderSetting(
      'providerA',
      'base-url',
      'https://legacy.example/v1',
    );
    settingsService.setProviderSetting('providerA', 'model', 'legacy-model');
    sessionRoot.agent.setEphemeralSetting(
      'base-url',
      'https://legacy.example/v1',
    );
    sessionRoot.settingsOwner.chooseModel('legacy-model');

    await switchActiveProvider(
      'providerB',
      {},
      ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
        sessionClient.refreshAuth(),
      )),
    );
    await switchActiveProvider(
      'providerA',
      {},
      ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
        sessionClient.refreshAuth(),
      )),
    );

    const refreshedSettings = settingsService.getProviderSettings('providerA');
    expect(refreshedSettings['base-url']).toBeUndefined();
    expect(refreshedSettings.model).toBe('providerA-default');
    expect(sessionRoot.settingsOwner.readSelectedModel()).toBe(
      'providerA-default',
    );
    expect(sessionRoot.agent.getEphemeralSetting('base-url')).toBeUndefined();
  });

  it('does not call getModels during provider switch', async () => {
    const providerA = createMockProvider('providerA');
    const providerB = createMockProvider('providerB');
    providerB.getModels = vi.fn(providerB.getModels);

    providerManager.registerProvider(providerA);
    providerManager.registerProvider(providerB);
    await providerManager.setActiveProvider('providerA');

    const result = await switchActiveProvider(
      'providerB',
      {},
      ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
        sessionClient.refreshAuth(),
      )),
    );

    expect(result.changed).toBe(true);
    expect(result.nextProvider).toBe('providerB');
    expect(providerB.getModels).not.toHaveBeenCalled();
  });

  it('resolves model from provider default without network call', async () => {
    const providerA = createMockProvider('providerA');
    const providerB = createMockProvider('providerB');
    providerB.getDefaultModel = vi.fn(() => 'custom-default-model');
    providerB.getModels = vi.fn(providerB.getModels);

    providerManager.registerProvider(providerA);
    providerManager.registerProvider(providerB);
    await providerManager.setActiveProvider('providerA');

    await switchActiveProvider(
      'providerB',
      {},
      ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
        sessionClient.refreshAuth(),
      )),
    );

    expect(sessionRoot.settingsOwner.readSelectedModel()).toBe(
      'custom-default-model',
    );
  });
});

describe('First provider selection from no active provider (#2481)', () => {
  let tempDir: string;
  let config: Config;
  let sessionRoot: CliTestSessionRoot;
  let providerManager: RuntimeProviderManager;
  let settingsService: SettingsService;
  let registration: CliRuntimeRegistrationHandle;
  let sessionClient: Pick<Agent['sessionClient'], 'refreshAuth'>;

  beforeEach(async () => {
    tempDir = await createTempDirectory();

    config = new Config({
      sessionId: 'first-select-session',
      targetDir: tempDir,
      debugMode: false,
      cwd: tempDir,
      model: 'test-model',
    });
    settingsService = new SettingsService();
    const assembled = assembleCliProviderRuntime({
      settingsService,
      config,
      runtimeId: 'first-select-test',
      metadata: { source: 'first-select-test' },
    });
    providerManager = assembled.providerManager;
    registration = assembled.registration;
    sessionRoot = await initializeTestSessionRoot(
      config,
      providerManager,
      settingsService,
    );
    sessionClient = sessionRoot.agent.sessionClient;

    providerManager.registerProvider(createMockProvider('openai'));
    providerManager.registerProvider(createMockProvider('anthropic'));
  });

  afterEach(async () => {
    registration.dispose();
    await cleanupTempDirectory(tempDir);
  });

  it('stays closed (no active provider) before any selection', () => {
    expect(providerManager.hasActiveProvider()).toBe(false);
    expect(providerManager.getActiveProviderName()).toBeUndefined();
  });

  it('transitions from no active provider to an explicit selection', async () => {
    expect(providerManager.hasActiveProvider()).toBe(false);

    const result = await switchActiveProvider(
      'openai',
      {},
      ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
        sessionClient.refreshAuth(),
      )),
    );

    expect(result.changed).toBe(true);
    expect(result.previousProvider).toBeNull();
    expect(result.nextProvider).toBe('openai');
    expect(providerManager.hasActiveProvider()).toBe(true);
    expect(providerManager.getActiveProviderName()).toBe('openai');
  });

  it('does not issue network requests during the transition', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    setGlobal('fetch', fetchMock);

    try {
      await switchActiveProvider(
        'anthropic',
        {},
        ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
          sessionClient.refreshAuth(),
        )),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      restoreGlobals();
    }
  });

  it('permits a subsequent switch to another explicit provider', async () => {
    await switchActiveProvider(
      'openai',
      {},
      ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
        sessionClient.refreshAuth(),
      )),
    );
    expect(providerManager.getActiveProviderName()).toBe('openai');

    const result = await switchActiveProvider(
      'anthropic',
      {},
      ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
        sessionClient.refreshAuth(),
      )),
    );
    expect(result.changed).toBe(true);
    expect(result.previousProvider).toBe('openai');
    expect(result.nextProvider).toBe('anthropic');
    expect(providerManager.getActiveProviderName()).toBe('anthropic');
  });
});

function createMockProvider(name: string): IProvider & {
  apiKey?: string;
  baseUrl?: string;
  clearState?: () => void;
} {
  const provider: IProvider & {
    apiKey?: string;
    baseUrl?: string;
    clearState?: () => void;
  } = {
    name,
    async getModels() {
      return [
        {
          id: 'test-model',
          name: 'Test Model',
          provider: name,
          supportedToolFormats: [],
        },
      ];
    },
    async *generateChatCompletion() {
      yield {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: 'test response' }],
      };
    },
    clearState() {
      provider.apiKey = undefined;
      provider.baseUrl = undefined;
    },
    getDefaultModel() {
      return 'test-model';
    },
  };

  return provider;
}
