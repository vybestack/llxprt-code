/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import type {
  AgentRuntimeProviderAdapter,
  ReadonlySettingsSnapshot,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { resetProviderManager } from '../composition/providerManagerInstance.js';
import { assembleCliProviderRuntime } from './assembleCliProviderRuntime.js';
import { setActiveModel } from './providerMutations.js';
import { switchActiveProvider } from './providerSwitch.js';
import { disposeCliRuntime } from './runtimeRegistry.js';

const RUNTIME_ID = 'issue3576-codex-context-limit';

function requireProviderName(config: Config): string {
  const provider = config.getProvider();
  if (provider === undefined) {
    throw new Error('runtime config has no active provider');
  }
  return provider;
}

function liveContextLimitSettings(config: Config): ReadonlySettingsSnapshot {
  return {
    get contextLimit(): number | undefined {
      const value = config.getEphemeralSetting('context-limit');
      return typeof value === 'number' ? value : undefined;
    },
  };
}

describe('Codex effective context limit runtime integration', () => {
  afterEach(async () => {
    await disposeCliRuntime(RUNTIME_ID);
    resetProviderManager();
  });

  it('updates the live effective limit across Astra, Sol, and Spark model selection', async () => {
    const settingsService = new SettingsService();
    const config = new Config({
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

    await switchActiveProvider('codex');

    const state: AgentRuntimeState = {
      runtimeId: RUNTIME_ID,
      sessionId: 'issue3576-session',
      updatedAt: Date.now(),
      get provider(): string {
        return requireProviderName(config);
      },
      get model(): string {
        return config.getModel();
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
      settings: liveContextLimitSettings(config),
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

    await setActiveModel('gpt-6-astra');
    expect(context.ephemerals.contextLimit()).toBe(872000);

    await setActiveModel('gpt-5.6-sol');
    expect(context.ephemerals.contextLimit()).toBe(262144);

    await setActiveModel('gpt-5.3-codex-spark');
    expect(context.ephemerals.contextLimit()).toBe(131072);
  });
});
