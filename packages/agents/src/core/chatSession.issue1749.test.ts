import { createSessionSettingsFixture } from '../api/__tests__/helpers/session-settings-fixture.js';
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { afterEach } from 'bun:test';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { ChatSession } from './chatSession.js';
import type { TextBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapter,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { AfterModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';

/**
 * Extracts visible (non-thinking) text from a neutral ModelOutput — the
 * post-P13 replacement for the deleted GenerateContentResponse `.text`
 * getter.
 */
function extractText(output: ModelOutput): string {
  return output.content.blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

void vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((fn: () => unknown) => fn()),
}));

function createConfigParams(
  settingsService: SettingsService,
): ConfigParameters {
  return {
    cwd: '/tmp',
    targetDir: '/tmp/project',
    debugMode: false,
    question: undefined,
    userMemory: '',
    embeddingModel: 'gemini-embedding',
    sandbox: undefined,
    sessionId: 'test-session',
    model: 'gemini-1.5-pro',
    initialSettings: settingsService.getAllGlobalSettings(),
  };
}

/**
 * Issue #1749: AfterModel hook modified-response text must not be overwritten
 * (or left stale) by the pre-hook aggregatedText in
 * DirectMessageProcessor._processDirectResponse().
 *
 * When the AfterModel hook returns a modified response via getModifiedResponse(),
 * the resulting response.text must reflect the hook's intended text, not the
 * original provider text aggregated before the hook fired.
 */
describe('Issue 1749: AfterModel hook modified-response text', () => {
  let settingsService: SettingsService;
  let config: Config;
  let manager: TestRuntimeProviderManager;
  let providerRuntime: ProviderRuntimeContext;
  let settingsOwner: SessionSettingsOwner;
  afterEach(async () => {
    await settingsOwner.dispose();
    await config.dispose();
  });

  beforeEach(() => {
    settingsService = new SettingsService();
    settingsOwner = new SessionSettingsOwner(settingsService);
    config = new Config(createConfigParams(settingsService));

    settingsService.set('providers.stub.base-url', 'https://stub.example.com');
    settingsService.set('providers.stub.auth-key', 'stub-api-key');
    settingsService.set('providers.stub.model', 'stub-model');

    providerRuntime = createProviderRuntimeContext({
      settingsService,
      config,
      runtimeId: 'test.runtime',
      metadata: { source: 'chatSession.issue1749.test' },
    });

    manager = new TestRuntimeProviderManager(providerRuntime);
    manager.setConfig(config);
    configureProviderRuntimeFactories(config, manager);
  });

  function buildChatSession(
    hookOwner: HookExecutionOwner,
  ): Pick<ChatSession, 'generateDirectMessage'> {
    const runtimeState = createAgentRuntimeState({
      runtimeId: 'runtime-test',
      provider: 'stub',
      model: config.getModel(),
      sessionId: config.getSessionId(),
    });
    const view = createAgentRuntimeContext({
      prepareProviderInvocation: (name, parameters, signal) =>
        settingsOwner.prepareProviderInvocation(
          runtimeState.runtimeId,
          name,
          parameters,
          signal,
        ),
      state: runtimeState,
      history: new HistoryService(),
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 128000,
        preserveThreshold: 0.2,
        telemetry: {
          enabled: true,
          target: null,
        },
        'reasoning.includeInContext': true,
      },
      provider: createProviderAdapterFromManager(manager),
      telemetry: createTelemetryAdapter(
        config,
        createSessionSettingsFixture(config).settingsOwner.telemetry,
      ),
      tools: createToolRegistryViewFromRegistry(undefined),
      providerRuntime: { ...providerRuntime, config },
    });

    const chat = new ChatSession(
      view,
      {} as unknown as ContentGenerator,
      {},
      [],
    );
    return {
      generateDirectMessage: (params, promptId) =>
        chat.generateDirectMessage({ ...params, hookOwner }, promptId),
    };
  }

  function registerStubProvider(text: string): void {
    const generateChatCompletionMock = vi.fn(async function* () {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text }],
      };
    });
    const provider: IProvider = {
      name: 'stub',
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'stub-model',
      generateChatCompletion: generateChatCompletionMock,
      getAuthToken: vi.fn(async () => 'stub-auth-token'),
    } as unknown as IProvider;
    manager.registerProvider(provider);
  }

  it('reflects hook-modified text in response.text instead of stale provider text', async () => {
    registerStubProvider('original provider text');

    const hookOwner: HookExecutionOwner = {
      sessionId: () => config.getSessionId(),
      transcriptPath: () => undefined,
      beforeToolSelection: async () => undefined,
      beforeModel: async () => undefined,
      afterModel: async () =>
        new AfterModelHookOutput({
          hookSpecificOutput: {
            llm_response: {
              version: 2,
              content: {
                speaker: 'ai',
                blocks: [{ type: 'text', text: 'hook modified text' }],
              },
              finishReason: 'stop',
            },
          },
        }),
    };

    const chat = buildChatSession(hookOwner);

    const response = await chat.generateDirectMessage(
      { message: 'Trigger AfterModel modification' },
      'prompt-issue-1749',
    );

    expect(extractText(response)).toBe('hook modified text');
    expect(extractText(response)).not.toContain('original provider text');
    expect(JSON.stringify(response)).not.toContain('original provider text');
  });

  it('preserves provider text when AfterModel hook does not modify the response', async () => {
    registerStubProvider('plain provider text');

    const hookOwner: HookExecutionOwner = {
      sessionId: () => config.getSessionId(),
      transcriptPath: () => undefined,
      beforeToolSelection: async () => undefined,
      beforeModel: async () => undefined,
      afterModel: async () => new AfterModelHookOutput({}),
    };

    const chat = buildChatSession(hookOwner);

    const response = await chat.generateDirectMessage(
      { message: 'No modification' },
      'prompt-issue-1749-noop',
    );

    expect(extractText(response)).toBe('plain provider text');
  });

  it('excludes thought parts from hook-modified response text', async () => {
    registerStubProvider('original provider text');

    const afterModelResult = new AfterModelHookOutput({});
    vi.spyOn(afterModelResult, 'getModifiedResponse').mockReturnValue({
      version: 2,
      content: {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'internal reasoning' },
          { type: 'text', text: 'visible answer' },
        ],
      },
      finishReason: 'stop',
    } as unknown as ReturnType<AfterModelHookOutput['getModifiedResponse']>);

    const hookOwner: HookExecutionOwner = {
      sessionId: () => config.getSessionId(),
      transcriptPath: () => undefined,
      beforeToolSelection: async () => undefined,
      beforeModel: async () => undefined,
      afterModel: async () => afterModelResult,
    };

    const chat = buildChatSession(hookOwner);

    const response = await chat.generateDirectMessage(
      { message: 'Trigger thought filtering' },
      'prompt-issue-1749-thought',
    );

    expect(extractText(response)).toBe('visible answer');
    expect(extractText(response)).not.toContain('internal reasoning');
  });
});
