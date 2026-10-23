import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { buildRuntimeProfileSnapshot } from '../../../agents/src/api/profileSnapshot.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IProvider } from '@vybestack/llxprt-code-providers';
import { createMockCommandContext } from '../__tests__/mockCommandContext.js';
import { createSetCommand } from '../ui/commands/setCommand.js';
import type { SlashCommand } from '../ui/commands/types.js';
import {
  setActiveModelParam,
  clearActiveModelParam,
} from '../../../agents/src/api/model-parameters.js';
import { prepareIntegrationPreflight } from './__tests__/prepare-preflight.js';
import type { AgentProfilePreflight } from '@vybestack/llxprt-code-agents';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { assertDefined } from '../__tests__/assertions.js';
import {
  createTempDirectory,
  cleanupTempDirectory,
  initializeTestAgent,
} from './test-utils.js';

function createStubProvider(name: string): IProvider {
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
  };
}

describe('CLI model parameter command integration', () => {
  const credentials = useOwnedCredentials();
  let tempDir: string;
  let config: Config;
  let settingsOwner: SessionSettingsOwner;
  let sessionRoot: Awaited<ReturnType<typeof initializeTestAgent>>;
  let settingsService: SettingsService;
  let preflight: AgentProfilePreflight;
  let providerManager: RuntimeProviderManager;
  let context: ReturnType<typeof createMockCommandContext>;
  let setCommand: SlashCommand;

  const runSetCommand = async (args: string) => {
    assertDefined(setCommand.action);
    return setCommand.action(context, args);
  };

  beforeEach(async () => {
    tempDir = await createTempDirectory();
    config = new Config({
      sessionId: 'model-params-integration',
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
      'modelparams-test',
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
    providerManager.registerProvider(createStubProvider('alpha'));
    await providerManager.setActiveProvider('alpha');

    context = createMockCommandContext({
      runtimeApi: {
        setActiveModelParam: (key: string, value: unknown) =>
          setActiveModelParam(
            key,
            value,
            settingsService,
            providerManager.getActiveProviderName(),
          ),
        clearActiveModelParam: (key: string) =>
          clearActiveModelParam(
            key,
            settingsService,
            providerManager.getActiveProviderName(),
          ),
        setEphemeralSetting: (key: string, value: unknown) =>
          sessionRoot.setEphemeralSetting(key, value),
      },
      services: {
        config: config as unknown as typeof context.services.config,
        settings:
          settingsService as unknown as typeof context.services.settings,
      },
    });
    const agent = sessionRoot;
    setCommand = createSetCommand({
      getEphemeralSettings: () => agent.getEphemeralSettings(),
      setEphemeralSetting: (key, value) =>
        agent.setEphemeralSetting(key, value),
      getActiveModelParams: () => agent.providerReads.getActiveModelParams(),
      setActiveModelParam: (key, value) =>
        agent.modelParameters.set(key, value),
      clearActiveModelParam: (key) => agent.modelParameters.clear(key),
      isFuzzyFilteringEnabled: () => true,
    });
  });

  afterEach(async () => {
    await preflight.dispose();
    await cleanupTempDirectory(tempDir);
  });

  it('sets provider-scoped model params via /set modelparam', async () => {
    await runSetCommand('modelparam temperature 0.9');
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({
      temperature: 0.9,
    });
    expect(settingsService.getProviderSettings('alpha').temperature).toBe(0.9);
  });

  it('clears model params using /set unset modelparam', async () => {
    await runSetCommand('modelparam max_tokens 4096');
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({
      max_tokens: 4096,
    });

    await runSetCommand('unset modelparam max_tokens');
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({});
    expect(
      settingsService.getProviderSettings('alpha').max_tokens,
    ).toBeUndefined();
  });

  it('produces runtime profile snapshots that include current model params', async () => {
    await runSetCommand('modelparam response_format {"type":"json_object"}');
    await runSetCommand('modelparam top_p 0.92');

    const snapshot = buildRuntimeProfileSnapshot({
      providerName: providerManager.getActiveProviderName() ?? '',
      modelName: sessionRoot.getModel(),
      providerSettings: settingsService.getProviderSettings(
        providerManager.getActiveProviderName() ?? '',
      ),
      ephemeralSettings: sessionRoot.getEphemeralSettings(),
    });
    expect(snapshot.provider).toBe('alpha');
    expect(snapshot.modelParams).toStrictEqual({
      response_format: { type: 'json_object' },
      top_p: 0.92,
    });
  });

  it('supports clearing params directly through helper', async () => {
    await runSetCommand('modelparam temperature 0.7');
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({
      temperature: 0.7,
    });

    clearActiveModelParam(
      'temperature',
      settingsService,
      providerManager.getActiveProviderName(),
    );
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({});
  });
});
