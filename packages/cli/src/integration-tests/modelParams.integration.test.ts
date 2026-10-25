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
import type { Config } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { createMockCommandContext } from '../__tests__/mockCommandContext.js';
import { createSetCommand } from '../ui/commands/setCommand.js';
import type { SlashCommand } from '../ui/commands/types.js';
import { buildRuntimeProfileSnapshot } from '../../../agents/src/api/profileSnapshot.js';
import {
  setActiveModelParam,
  clearActiveModelParam,
} from '../../../agents/src/api/model-parameters.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import type { RouteBPreflight } from '../../../agents/src/api/__tests__/helpers/route-b-preflight.js';
import { assertDefined } from '../__tests__/assertions.js';
import {
  createModelParamsStubProvider,
  openModelParamsRoot,
  type ModelParamsRoot,
} from './__tests__/model-params-route.js';

describe('CLI model parameter command integration', () => {
  const credentials = useOwnedCredentials();
  let root: ModelParamsRoot;
  let config: Config;
  let sessionRoot: Agent;
  let settingsService: SettingsService;
  let preflight: RouteBPreflight['preflight'];
  let context: ReturnType<typeof createMockCommandContext>;
  let setCommand: SlashCommand;

  const runSetCommand = async (args: string) => {
    assertDefined(setCommand.action);
    return setCommand.action(context, args);
  };

  beforeEach(async () => {
    root = await openModelParamsRoot(
      credentials().authority,
      'model-params-integration',
      'modelparams-test',
      [createModelParamsStubProvider('alpha')],
    );
    config = root.route.config;
    settingsService = root.route.settings;
    preflight = root.route.preflight;
    sessionRoot = root.agent;
    await preflight.setActiveProvider('alpha');

    context = createMockCommandContext({
      runtimeApi: {
        setActiveModelParam: (key: string, value: unknown) =>
          setActiveModelParam(
            key,
            value,
            settingsService,
            preflight.getActiveProviderName(),
          ),
        clearActiveModelParam: (key: string) =>
          clearActiveModelParam(
            key,
            settingsService,
            preflight.getActiveProviderName(),
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
    await root.close();
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
      providerName: preflight.getActiveProviderName() ?? '',
      modelName: sessionRoot.getModel(),
      providerSettings: settingsService.getProviderSettings(
        preflight.getActiveProviderName() ?? '',
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
      preflight.getActiveProviderName(),
    );
    expect(sessionRoot.providerReads.getActiveModelParams()).toStrictEqual({});
  });
});
