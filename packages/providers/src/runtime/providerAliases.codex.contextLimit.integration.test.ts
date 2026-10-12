import { createProviderConfigFixture } from './__tests__/provider-config-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import type { AgentRuntimeProviderAdapter } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { assembleCliProviderRuntime } from './assembleCliProviderRuntime.js';
import { setActiveModel, assembleModelSelection } from './providerMutations.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { switchActiveProvider } from './providerSwitch.js';

const RUNTIME_ID = 'issue3576-codex-context-limit';

describe('Codex effective context limit runtime integration', () => {
  it('updates the live effective limit across Astra, Sol, and Spark model selection', async () => {
    const settingsService = new SettingsService();
    const settingsOwner = new SessionSettingsOwner(settingsService);
    const { config: config } = createProviderConfigFixture({
      sessionId: 'issue3576-session',
      targetDir: process.cwd(),
      debugMode: false,
      cwd: process.cwd(),
      model: 'gpt-5.6-sol',
      settingsService,
    });
    const assembled = assembleCliProviderRuntime({
      settingsService,
      config,
      runtimeId: RUNTIME_ID,
      oauthSettings: null,
    });

    await switchActiveProvider(
      'codex',
      { clientReplacement: 'deferred' },
      config,
      settingsService,
      assembled.providerManager,
      null,
      'agent',
      async () => {},
      settingsOwner,
    );

    const state: AgentRuntimeState = {
      runtimeId: RUNTIME_ID,
      sessionId: 'issue3576-session',
      updatedAt: Date.now(),
      get provider(): string {
        const provider = settingsOwner.readSelectedProvider();
        if (provider === undefined)
          throw new Error('Missing selected provider');
        return provider;
      },
      get model(): string {
        const model = settingsOwner.readSelectedModel();
        if (model === undefined) throw new Error('Missing selected model');
        return model;
      },
    };
    const provider: AgentRuntimeProviderAdapter = {
      getActiveProvider: () => {
        const activeProvider = assembled.providerManager.getActiveProvider();
        if (activeProvider === undefined) {
          throw new Error('provider manager has no active provider');
        }
        return activeProvider;
      },
      setActiveProvider: () => undefined,
    };
    const context = createAgentRuntimeContext({
      state,
      settings: settingsOwner.readRuntimePolicy(),
      readRuntimeSettings: () => settingsOwner.readRuntimePolicy(),
      prepareProviderInvocation: (providerName, parameters, signal) =>
        settingsOwner.prepareProviderInvocation(
          RUNTIME_ID,
          providerName,
          parameters,
          signal,
        ),
      provider,
      telemetry: {
        logApiRequest: () => undefined,
        logApiResponse: () => undefined,
        logApiError: () => undefined,
      },
      tools: {
        listToolNames: () => [],
        getToolMetadata: () => undefined,
      },
      providerRuntime: assembled.runtime,
    });

    await setActiveModel(
      'gpt-6-astra',
      assembleModelSelection(settingsOwner),
      settingsService,
      assembled.providerManager.getActiveProvider(),
    );
    expect(context.ephemerals.contextLimit()).toBe(872000);

    await setActiveModel(
      'gpt-5.6-sol',
      assembleModelSelection(settingsOwner),
      settingsService,
      assembled.providerManager.getActiveProvider(),
    );
    expect(context.ephemerals.contextLimit()).toBe(262144);

    await setActiveModel(
      'gpt-5.3-codex-spark',
      assembleModelSelection(settingsOwner),
      settingsService,
      assembled.providerManager.getActiveProvider(),
    );
    expect(context.ephemerals.contextLimit()).toBe(131072);
  });
});
