import { assembleModelSelection } from '../../../agents/src/api/model-selection.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { buildRuntimeProfileSnapshot } from '../../../agents/src/api/profileSnapshot.js';
import type {
  Agent,
  AgentProfilePreflight,
} from '@vybestack/llxprt-code-agents';
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
  switchActiveProvider,
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
} from '../../../agents/src/api/model-parameters.js';
import { setActiveModel } from '../../../agents/src/api/providerMutations.js';
import { prepareIntegrationPreflight } from './__tests__/prepare-preflight.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  createTempDirectory,
  cleanupTempDirectory,
  initializeTestAgent,
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
  const credentials = useOwnedCredentials();
  let tempDir: string;
  let config: Config;
  let settingsOwner: SessionSettingsOwner;
  let sessionRoot: Awaited<ReturnType<typeof initializeTestAgent>>;
  let providerManager: RuntimeProviderManager;
  let settingsService: SettingsService;
  let preflight: AgentProfilePreflight;
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
    preflight = await prepareIntegrationPreflight(
      config,
      settingsService,
      credentials().authority,
      'model-params-isolation-test',
      (manager) => {
        providerManager = manager;
      },
    );
    settingsOwner = new SessionSettingsOwner(settingsService);
    sessionRoot = await initializeTestAgent(
      config,
      providerManager,
      settingsService,
      settingsOwner,
    );
    sessionClient = sessionRoot.sessionClient;
    providerManager.registerProvider(createStubProvider('alpha'));
    providerManager.registerProvider(createStubProvider('beta'));
    providerManager.registerProvider(createStubProvider('gamma'));

    await providerManager.setActiveProvider('alpha');
    await setActiveModel(
      'alpha-model',
      assembleModelSelection(settingsOwner),
      settingsService,
      providerManager.getActiveProvider(),
    );
  });

  afterEach(async () => {
    await preflight.dispose();
    await cleanupTempDirectory(tempDir);
  });

  it('keeps model parameters scoped to the active provider', async () => {
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({});

    setActiveModelParam(
      'temperature',
      0.8,
      settingsService,
      providerManager.getActiveProviderName(),
    );
    setActiveModelParam(
      'max_tokens',
      2048,
      settingsService,
      providerManager.getActiveProviderName(),
    );

    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({
      temperature: 0.8,
      max_tokens: 2048,
    });
    expect(settingsService.getProviderSettings('alpha').temperature).toBe(0.8);

    await switchActiveProvider(
      'beta',
      {},
      config,
      settingsService,
      providerManager,
      null,
      undefined,
      () => sessionClient.refreshAuth(),
      settingsOwner,
    );
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({});
    // Switching providers clears the previous provider's settings by design
    // (clearPreviousProviderSettings, PLAN-20260603-ISSUE1584.P14), so alpha no
    // longer retains its temperature.
    expect(
      settingsService.getProviderSettings('alpha').temperature,
    ).toBeUndefined();

    setActiveModelParam(
      'temperature',
      0.35,
      settingsService,
      providerManager.getActiveProviderName(),
    );
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({
      temperature: 0.35,
    });

    await switchActiveProvider(
      'alpha',
      {},
      config,
      settingsService,
      providerManager,
      null,
      undefined,
      () => sessionClient.refreshAuth(),
      settingsOwner,
    );
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({});
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
      settingsService,
      providerManager.getActiveProviderName(),
    );
    setActiveModelParam(
      'response_format',
      { type: 'json_object' },
      settingsService,
      providerManager.getActiveProviderName(),
    );

    const snapshot = buildRuntimeProfileSnapshot({
      providerName: providerManager.getActiveProviderName() ?? '',
      modelName: sessionRoot.getModel(),
      providerSettings: settingsService.getProviderSettings(
        providerManager.getActiveProviderName() ?? '',
      ),
      ephemeralSettings: sessionRoot.getEphemeralSettings(),
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
        settingsOwner,
      ),
      settingsOwner,
      definitionFixture().profileDefinitions,
    ).applySnapshot(profile, { profileName: 'beta-profile' });

    expect(settingsService.get('activeProvider')).toBe('beta');
    expect(settingsOwner.readSelectedModel()).toBe('beta-model');
    expect(settingsService.getProviderSettings('beta').temperature).toBe(0.55);
    expect(settingsService.getProviderSettings('beta').top_p).toBe(0.88);
    expect(sessionRoot.getEphemeralSetting('context-limit')).toBe(64000);
  });

  it('clears individual model params via helper', () => {
    setActiveModelParam(
      'temperature',
      0.42,
      settingsService,
      providerManager.getActiveProviderName(),
    );
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({
      temperature: 0.42,
    });

    clearActiveModelParam(
      'temperature',
      settingsService,
      providerManager.getActiveProviderName(),
    );
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({});
  });
});
