import { useRuntimeTestOwners as installRuntimeTestOwners } from '../runtime/__tests__/runtime-owner-test-helpers.js';
const fixtureOwners = installRuntimeTestOwners();
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { BaseProvider } from '../BaseProvider.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';

class HarnessProvider extends BaseProvider {
  lastNormalizedOptions?: NormalizedGenerateChatOptions;

  constructor(config: Config, settingsService: SettingsService) {
    super({ name: 'stub-provider' }, undefined, config, settingsService);
  }

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'stub-default-model';
  }

  protected supportsOAuth(): boolean {
    return false;
  }

  protected generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<never> {
    this.lastNormalizedOptions = options;
    return (async function* () {})();
  }
}

const prompt: IContent = { speaker: 'human', blocks: [] };

async function collect(
  iterator: AsyncIterableIterator<unknown>,
): Promise<void> {
  for await (const _chunk of iterator) {
    // consume iterator
  }
}

interface Harness {
  provider: HarnessProvider;
  manager: ProviderManager;
  settingsService: SettingsService;
  runtimeContext: ReturnType<
    typeof createHarnessRuntimeContext
  >['runtimeContext'];
}

function createHarnessRuntimeContext(settingsService: SettingsService) {
  const config = createRuntimeConfigStub(settingsService);
  const runtimeContext = {
    settingsService,
    config,
    runtimeId: 'ephemeral-harness',
  };
  return { config, runtimeContext };
}

function createHarnessWithDumpContext(): Harness {
  const settingsService = new SettingsService();
  settingsService.set('dumpcontext', 'on');
  const { config, runtimeContext } =
    createHarnessRuntimeContext(settingsService);
  const manager = new ProviderManager({
    sessionSettings: fixtureOwners.adopt(config, settingsService).settingsOwner,
    settingsService,
    config,
    runtime: runtimeContext,
  });
  const provider = new HarnessProvider(config, settingsService);
  manager.registerProvider(provider);
  settingsService.set('activeProvider', provider.name);
  settingsService.setProviderSetting(provider.name, 'model', 'stub-model');
  settingsService.setProviderSetting(provider.name, 'auth-key', 'stub-key');
  settingsService.setProviderSetting(
    provider.name,
    'base-url',
    'https://stub.example.com',
  );
  manager.setActiveProvider(provider.name);
  return { provider, manager, settingsService, runtimeContext };
}

describe('BaseProvider ephemeral snapshot propagation into invocation', () => {
  it('includes current settings ephemerals in the invocation when no invocation is provided', async () => {
    const { provider, manager, settingsService, runtimeContext } =
      createHarnessWithDumpContext();

    await collect(
      manager.getActiveProvider().generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [prompt],
          settings: settingsService,
          config: runtimeContext.config,
          runtime: runtimeContext,
        }),
      ),
    );

    expect(provider.lastNormalizedOptions?.invocation).toBeDefined();
    expect(
      provider.lastNormalizedOptions?.invocation.ephemerals.dumpcontext,
    ).toBe('on');
  });

  it('retains the admitted snapshot without importing later settings ephemerals', async () => {
    const { provider, manager, settingsService, runtimeContext } =
      createHarnessWithDumpContext();

    const staleInvocation = createRuntimeInvocationContext({
      runtimeId: 'ephemeral-provided-invocation',

      providerName: provider.name,
      ephemeralsSnapshot: {},
      fallbackRuntimeId: 'ephemeral-provided-invocation',
    });

    await collect(
      manager.getActiveProvider().generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [prompt],
          settings: settingsService,
          config: runtimeContext.config,
          runtime: runtimeContext,
          invocation: staleInvocation,
        }),
      ),
    );

    const invocation = provider.lastNormalizedOptions?.invocation;
    expect(invocation).toBeDefined();
    expect(invocation?.ephemerals.dumpcontext).toBeUndefined();
    expect(invocation?.getEphemeral('dumpcontext')).toBeUndefined();
    expect(invocation?.getCliSetting('dumpcontext')).toBeUndefined();
  });

  it('preserves explicit ephemerals on the provided invocation over snapshot values', async () => {
    const { provider, manager, settingsService, runtimeContext } =
      createHarnessWithDumpContext();

    const explicitInvocation = createRuntimeInvocationContext({
      runtimeId: 'ephemeral-precedence',

      providerName: provider.name,
      ephemeralsSnapshot: { dumpcontext: 'error' },
      fallbackRuntimeId: 'ephemeral-precedence',
    });

    await collect(
      manager.getActiveProvider().generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [prompt],
          settings: settingsService,
          config: runtimeContext.config,
          runtime: runtimeContext,
          invocation: explicitInvocation,
        }),
      ),
    );

    const invocation = provider.lastNormalizedOptions?.invocation;
    expect(invocation).toBeDefined();
    expect(invocation?.ephemerals.dumpcontext).toBe('error');
    expect(invocation?.getEphemeral('dumpcontext')).toBe('error');
  });

  it('preserves the provided invocation runtimeId over the normalized runtime id', async () => {
    const { provider, manager, settingsService, runtimeContext } =
      createHarnessWithDumpContext();

    expect(runtimeContext.runtimeId).toBe('ephemeral-harness');

    const providedInvocation = createRuntimeInvocationContext({
      runtimeId: 'ephemeral-provided-runtimeId',

      providerName: provider.name,
      ephemeralsSnapshot: {},
      fallbackRuntimeId: 'ephemeral-provided-runtimeId',
    });

    await collect(
      manager.getActiveProvider().generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [prompt],
          settings: settingsService,
          config: runtimeContext.config,
          runtime: runtimeContext,
          invocation: providedInvocation,
        }),
      ),
    );

    const invocation = provider.lastNormalizedOptions?.invocation;
    expect(invocation).toBeDefined();
    // The provided invocation's runtimeId must win, not the normalized
    // runtime's runtimeId ('ephemeral-harness').
    expect(invocation?.runtimeId).toBe('ephemeral-provided-runtimeId');
    expect(invocation?.runtimeId).not.toBe(runtimeContext.runtimeId);
  });

  it('preserves provided invocation metadata, userMemory, redaction, and telemetry', async () => {
    const { provider, manager, settingsService, runtimeContext } =
      createHarnessWithDumpContext();

    const providedMetadata = { correlationId: 'corr-123', source: 'unit-test' };
    const providedUserMemory = 'remember: user prefers concise answers';
    const providedRedaction = {
      redactApiKeys: true,
      redactCredentials: true,
      redactFilePaths: false,
      redactUrls: false,
      redactEmails: true,
      redactPersonalInfo: true,
    };
    const providedTelemetry = {
      providerName: provider.name,
      modelId: 'stub-model',
      tokenUsage: { input: 10, output: 20, total: 30 },
    };

    const providedInvocation = createRuntimeInvocationContext({
      runtimeId: 'ephemeral-preserve-all',

      providerName: provider.name,
      ephemeralsSnapshot: {},
      metadata: providedMetadata,
      userMemory: providedUserMemory,
      redaction: providedRedaction,
      telemetry: providedTelemetry,
      fallbackRuntimeId: 'ephemeral-preserve-all',
    });

    await collect(
      manager.getActiveProvider().generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [prompt],
          settings: settingsService,
          config: runtimeContext.config,
          runtime: runtimeContext,
          invocation: providedInvocation,
        }),
      ),
    );

    const invocation = provider.lastNormalizedOptions?.invocation;
    expect(invocation).toBeDefined();
    expect(invocation?.runtimeId).toBe('ephemeral-preserve-all');
    expect(invocation?.metadata).toMatchObject(providedMetadata);
    expect(invocation?.userMemory).toBe(providedUserMemory);
    expect(invocation?.redaction).toMatchObject(providedRedaction);
    expect(invocation?.telemetry).toBe(providedTelemetry);
  });
});
