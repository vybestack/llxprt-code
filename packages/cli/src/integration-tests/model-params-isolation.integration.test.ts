import {
  modelSelectionInputs,
  providerSwitchInputs,
  modelParamInputs,
} from '../../../providers/src/runtime/__tests__/provider-switch-inputs.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { installDefinitionRuntimeFixture } from '../__tests__/definition-runtime-fixture.js';
const definitionFixture = installDefinitionRuntimeFixture();

import {
  assembleProfileApplication,
  assembleProviderSwitch,
} from '@vybestack/llxprt-code-agents';

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import { beforeEach, afterEach, describe, expect, it } from 'bun:test';
import {
  Config,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import { Profile, SettingsService } from '@vybestack/llxprt-code-settings';
import type { IProvider } from '@vybestack/llxprt-code-providers';
import {
  setActiveModelParam,
  clearActiveModelParam,
  getActiveModelParams,
  switchActiveProvider,
  buildRuntimeProfileSnapshot,
  setActiveModel,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { assembleCliProviderRuntime } from '@vybestack/llxprt-code-providers/runtime/assembleCliProviderRuntime.js';
import type { CliRuntimeRegistrationHandle } from '@vybestack/llxprt-code-providers/runtime/cliForegroundRuntime.js';
import {
  createTempDirectory,
  cleanupTempDirectory,
  initializeTestSessionRoot,
  type CliTestSessionRoot,
} from './test-utils.js';

function createStubProvider(name: string): IProvider & { clearState(): void } {
  return {
    name,
    async getModels() {
      return [
        {
          id: `${name}-model`,
          name: `${name}-model`,
          provider: name,
          supportedToolFormats: [],
        },
      ];
    },
    getDefaultModel() {
      return `${name}-model`;
    },
    async *generateChatCompletion() {
      yield {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: `response-from-${name}` }],
      };
    },
    clearState() {
      // Intentionally blank; runtime helpers now manage state in SettingsService.
    },
  };
}

describe('Runtime model parameter isolation', () => {
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
      sessionId: 'model-params-isolation',
      targetDir: tempDir,
      debugMode: false,
      cwd: tempDir,
      model: 'alpha-model',
    });
    settingsService = new SettingsService();
    const assembled = assembleCliProviderRuntime({
      settingsService,
      config,
      runtimeId: 'model-params-isolation-test',
      metadata: { source: 'model-params-isolation.integration.test.ts' },
    });
    providerManager = assembled.providerManager;
    registration = assembled.registration;
    sessionRoot = await initializeTestSessionRoot(
      config,
      providerManager,
      settingsService,
    );
    sessionClient = sessionRoot.agent.sessionClient;
    providerManager.registerProvider(createStubProvider('alpha'));
    providerManager.registerProvider(createStubProvider('beta'));
    providerManager.registerProvider(createStubProvider('gamma'));

    await providerManager.setActiveProvider('alpha');
    await setActiveModel(
      'alpha-model',
      ...(await modelSelectionInputs(sessionRoot)),
      providerManager.getActiveProvider(),
    );
  });

  afterEach(async () => {
    registration.dispose();
    await cleanupTempDirectory(tempDir);
  });

  it('keeps model parameters scoped to the active provider', async () => {
    expect(
      getActiveModelParams(...modelParamInputs(sessionRoot, providerManager)),
    ).toStrictEqual({});

    setActiveModelParam(
      'temperature',
      0.8,
      ...modelParamInputs(sessionRoot, providerManager),
    );
    setActiveModelParam(
      'max_tokens',
      2048,
      ...modelParamInputs(sessionRoot, providerManager),
    );

    expect(
      getActiveModelParams(...modelParamInputs(sessionRoot, providerManager)),
    ).toStrictEqual({
      temperature: 0.8,
      max_tokens: 2048,
    });
    expect(settingsService.getProviderSettings('alpha').temperature).toBe(0.8);

    await switchActiveProvider(
      'beta',
      {},
      ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
        sessionClient.refreshAuth(),
      )),
    );
    expect(
      getActiveModelParams(...modelParamInputs(sessionRoot, providerManager)),
    ).toStrictEqual({});
    // Switching providers clears the previous provider's settings by design
    // (clearPreviousProviderSettings, PLAN-20260603-ISSUE1584.P14), so alpha no
    // longer retains its temperature.
    expect(
      settingsService.getProviderSettings('alpha').temperature,
    ).toBeUndefined();

    setActiveModelParam(
      'temperature',
      0.35,
      ...modelParamInputs(sessionRoot, providerManager),
    );
    expect(
      getActiveModelParams(...modelParamInputs(sessionRoot, providerManager)),
    ).toStrictEqual({
      temperature: 0.35,
    });

    await switchActiveProvider(
      'alpha',
      {},
      ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
        sessionClient.refreshAuth(),
      )),
    );
    expect(
      getActiveModelParams(...modelParamInputs(sessionRoot, providerManager)),
    ).toStrictEqual({});
    expect(
      settingsService.getProviderSettings('alpha').temperature,
    ).toBeUndefined();
    // beta's settings are cleared in turn when switching away from it.
    expect(
      settingsService.getProviderSettings('beta').temperature,
    ).toBeUndefined();
  });

  it('builds runtime profile snapshots with provider-scoped params', () => {
    setActiveModelParam(
      'top_p',
      0.91,
      ...modelParamInputs(sessionRoot, providerManager),
    );
    setActiveModelParam(
      'response_format',
      { type: 'json_object' },
      ...modelParamInputs(sessionRoot, providerManager),
    );

    const snapshot = buildRuntimeProfileSnapshot({
      providerName: providerManager.getActiveProviderName() ?? '',
      modelName: sessionRoot.agent.getModel(),
      providerSettings: settingsService.getProviderSettings(
        providerManager.getActiveProviderName() ?? '',
      ),
      ephemeralSettings: sessionRoot.agent.getEphemeralSettings(),
    });
    expect(snapshot.provider).toBe('alpha');
    expect(snapshot.model).toBe('alpha-model');
    expect(snapshot.modelParams).toStrictEqual({
      top_p: 0.91,
      response_format: { type: 'json_object' },
    });
  });

  it('applies profile snapshots and refreshes runtime state', async () => {
    const profile: Profile = {
      version: 1,
      provider: 'beta',
      model: 'beta-model',
      modelParams: {
        temperature: 0.55,
        top_p: 0.88,
      },
      ephemeralSettings: {
        'context-limit': 64000,
      },
    };

    await assembleProfileApplication(
      config,
      settingsService,
      providerManager,
      null,
      assembleProviderSwitch(
        config,
        settingsService,
        providerManager,
        null,
        () => undefined,
        () => sessionClient.refreshAuth(),
        sessionRoot.settingsOwner,
      ),
      sessionRoot.settingsOwner,
      definitionFixture().profileDefinitions,
    ).applySnapshot(profile, { profileName: 'beta-profile' });

    expect(settingsService.get('activeProvider')).toBe('beta');
    expect(sessionRoot.settingsOwner.readSelectedModel()).toBe('beta-model');
    expect(settingsService.getProviderSettings('beta').temperature).toBe(0.55);
    expect(settingsService.getProviderSettings('beta').top_p).toBe(0.88);
    expect(sessionRoot.agent.getEphemeralSetting('context-limit')).toBe(64000);
  });

  it('clears individual model params via helper', () => {
    setActiveModelParam(
      'temperature',
      0.42,
      ...modelParamInputs(sessionRoot, providerManager),
    );
    expect(
      getActiveModelParams(...modelParamInputs(sessionRoot, providerManager)),
    ).toStrictEqual({
      temperature: 0.42,
    });

    clearActiveModelParam(
      'temperature',
      ...modelParamInputs(sessionRoot, providerManager),
    );
    expect(
      getActiveModelParams(...modelParamInputs(sessionRoot, providerManager)),
    ).toStrictEqual({});
  });
});
