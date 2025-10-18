/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  Config,
  ProviderManager,
  SettingsService,
  type IProvider,
} from '@vybestack/llxprt-code-core';
import type { OAuthManager } from '../auth/oauth-manager.js';
import { createMockCommandContext } from '../test-utils/mockCommandContext.js';
import { setCommand } from '../ui/commands/setCommand.js';
import {
  setCliRuntimeContext,
  registerCliProviderInfrastructure,
  resetCliProviderInfrastructure,
  getActiveModelParams,
  buildRuntimeProfileSnapshot,
  clearActiveModelParam,
} from '../runtime/runtimeSettings.js';
import { createTempDirectory, cleanupTempDirectory } from './test-utils.js';

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
    getServerTools() {
      return [];
    },
    async invokeServerTool() {
      return {};
    },
  };
}

describe('CLI model parameter command integration', () => {
  let tempDir: string;
  let config: Config;
  let settingsService: SettingsService;
  let providerManager: ProviderManager;
  let context: ReturnType<typeof createMockCommandContext>;

  const runSetCommand = async (args: string) => {
    if (!setCommand.action) {
      throw new Error('setCommand.action is not defined');
    }
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
    await config.initialize();

    settingsService = config.getSettingsService();
    providerManager = new ProviderManager({ settingsService, config });
    providerManager.registerProvider(createStubProvider('alpha'));
    providerManager.setActiveProvider('alpha');

    registerCliProviderInfrastructure(
      providerManager,
      {} as unknown as OAuthManager,
    );
    setCliRuntimeContext(settingsService, config, {
      metadata: { source: 'modelParams.integration.test.ts' },
    });

    context = createMockCommandContext({
      services: {
        config: config as unknown as typeof context.services.config,
        settings:
          settingsService as unknown as typeof context.services.settings,
      },
    });
  });

  afterEach(async () => {
    resetCliProviderInfrastructure();
    await cleanupTempDirectory(tempDir);
  });

  it('sets provider-scoped model params via /set modelparam', async () => {
    await runSetCommand('modelparam temperature 0.9');
    expect(getActiveModelParams()).toEqual({ temperature: 0.9 });
    expect(settingsService.getProviderSettings('alpha').temperature).toBe(0.9);
  });

  it('clears model params using /set unset modelparam', async () => {
    await runSetCommand('modelparam max_tokens 4096');
    expect(getActiveModelParams()).toEqual({ max_tokens: 4096 });

    await runSetCommand('unset modelparam max_tokens');
    expect(getActiveModelParams()).toEqual({});
    expect(
      settingsService.getProviderSettings('alpha').max_tokens,
    ).toBeUndefined();
  });

  it('produces runtime profile snapshots that include current model params', async () => {
    await runSetCommand('modelparam response_format {"type":"json_object"}');
    await runSetCommand('modelparam top_p 0.92');

    const snapshot = buildRuntimeProfileSnapshot();
    expect(snapshot.provider).toBe('alpha');
    expect(snapshot.modelParams).toEqual({
      response_format: { type: 'json_object' },
      top_p: 0.92,
    });
  });

  it('supports clearing params directly through helper', async () => {
    await runSetCommand('modelparam temperature 0.7');
    expect(getActiveModelParams()).toEqual({ temperature: 0.7 });

    clearActiveModelParam('temperature');
    expect(getActiveModelParams()).toEqual({});
  });
});
