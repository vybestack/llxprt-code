/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for DirectMessageProcessor AFC sanitization.
 *
 * Finding #1 (fresh review): DirectMessageProcessor must sanitize
 * automaticFunctionCallingHistory from BOTH incoming content metadata
 * (metadata.providerMetadata) and top-level providerMetadata ALWAYS,
 * re-adding only validated + restriction-filtered AFC.
 *
 * Tests use the real ChatSession.generateDirectMessage path with a stub
 * provider that yields IContent chunks carrying AFC in provider metadata.
 * The only mock boundary is the provider's generateChatCompletion stream.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-004.1
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/index.js';

import { ChatSession } from '../chatSession.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { TestRuntimeProviderManager } from '../../test-utils/runtimeProviderManager.js';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import {
  BeforeModelHookOutput,
  AfterModelHookOutput,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { createConfigParams } from '../chatSession-runtime-helpers.js';

vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((fn: () => unknown) => fn()),
}));

function makeProviderStream(chunks: IContent[]): AsyncGenerator<IContent> {
  return (async function* generate(): AsyncGenerator<IContent> {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
}

interface DirectHarness {
  chat: ChatSession;
  historyService: HistoryService;
  generateChatCompletionMock: Mock;
}

function createDirectHarness(
  generateChatCompletionMock: Mock,
  options?: {
    tools?: ToolDeclaration[];
    hookConfig?: Config;
    historyService?: HistoryService;
  },
): DirectHarness {
  const settingsService = new SettingsService();
  const config = new Config(createConfigParams(settingsService));

  settingsService.set('providers.stub.base-url', 'https://stub.example.com');
  settingsService.set('providers.stub.auth-key', 'stub-api-key');
  settingsService.set('providers.stub.model', 'stub-model');

  const providerRuntime: ProviderRuntimeContext = createProviderRuntimeContext({
    settingsService,
    config,
    runtimeId: 'test.runtime',
    metadata: { source: 'afc-sanitization.test' },
  });

  const manager = new TestRuntimeProviderManager(providerRuntime);
  manager.setConfig(config);
  config.setProviderManager(manager);

  const provider: IProvider = {
    name: 'stub',
    isDefault: true,
    getModels: vi.fn(async () => []),
    getDefaultModel: () => 'stub-model',
    generateChatCompletion: generateChatCompletionMock,
    getServerTools: () => [],
    invokeServerTool: vi.fn(),
  };
  manager.registerProvider(provider);

  const runtimeState = createAgentRuntimeState({
    runtimeId: 'runtime-afc-test',
    provider: provider.name,
    model: config.getModel(),
    sessionId: config.getSessionId(),
  });
  const historyService = options?.historyService ?? new HistoryService();
  const effectiveConfig = options?.hookConfig ?? config;
  const view = createAgentRuntimeContext({
    state: runtimeState,
    history: historyService,
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 128000,
      preserveThreshold: 0.2,
      telemetry: { enabled: true, target: null },
      'reasoning.includeInContext': true,
    },
    provider: createProviderAdapterFromManager(config.getProviderManager()),
    telemetry: createTelemetryAdapterFromConfig(config),
    tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
    providerRuntime: { ...providerRuntime, config: effectiveConfig },
  });

  const generationConfig: Record<string, unknown> = {};
  if (options?.tools) {
    generationConfig['tools'] = options.tools;
  }

  const chat = new ChatSession(
    view,
    {} as unknown as ContentGenerator,
    generationConfig,
    [],
  );

  return { chat, historyService, generateChatCompletionMock };
}

function configWithHooks(
  baseConfig: Config,
  allowedFunctionNames: string[],
): Config {
  const hookConfig = Object.create(baseConfig) as Config;
  Object.defineProperties(hookConfig, {
    getEnableHooks: { value: () => true },
    getHookSystem: {
      value: () => ({
        initialize: async () => undefined,
        fireBeforeToolSelectionEvent: async () => ({
          applyToolConfigModifications: () => ({
            toolConfig: { allowedFunctionNames },
          }),
        }),
        fireBeforeModelEvent: async () => new BeforeModelHookOutput({}),
        fireAfterModelEvent: async () => new AfterModelHookOutput({}),
      }),
    },
  });
  return hookConfig;
}

function textIContent(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { stopReason: 'stop' },
  };
}

const tools = [
  {
    functionDeclarations: [
      { name: 'read_file' } as Record<string, unknown>,
      { name: 'run_shell_command' } as Record<string, unknown>,
    ],
  },
] as unknown as ToolDeclaration[];

describe('DirectMessageProcessor AFC sanitization — allowed/disallowed paired', () => {
  it('re-adds only allowed tool calls from well-formed AFC history', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'done' }],
          metadata: {
            stopReason: 'stop',
            providerMetadata: {
              automaticFunctionCallingHistory: [
                {
                  speaker: 'ai',
                  blocks: [
                    {
                      type: 'tool_call',
                      id: 'call-1',
                      name: 'read_file',
                      parameters: {},
                    },
                  ],
                },
                {
                  speaker: 'tool',
                  blocks: [
                    {
                      type: 'tool_response',
                      callId: 'call-1',
                      toolName: 'read_file',
                      result: 'ok',
                    },
                  ],
                },
                {
                  speaker: 'ai',
                  blocks: [
                    {
                      type: 'tool_call',
                      id: 'call-2',
                      name: 'run_shell_command',
                      parameters: {},
                    },
                  ],
                },
                {
                  speaker: 'tool',
                  blocks: [
                    {
                      type: 'tool_response',
                      callId: 'call-2',
                      toolName: 'run_shell_command',
                      result: 'blocked',
                    },
                  ],
                },
              ],
            },
          },
        },
      ]),
    ) as Mock;
    const baseConfig = new Config(createConfigParams(new SettingsService()));
    const harness = createDirectHarness(mock, {
      tools,
      hookConfig: configWithHooks(baseConfig, ['read_file']),
    });

    const result = (await harness.chat.generateDirectMessage(
      { message: 'use tools', config: { tools } },
      'prompt-afc-allowed',
    )) as Record<string, unknown>;

    const json = JSON.stringify(result);
    // The blocked tool must not appear in the serialized response.
    expect(json).not.toContain('run_shell_command');
    // The allowed tool must survive in the filtered AFC history.
    expect(json).toContain('read_file');
    // The top-level providerMetadata must NOT carry automaticFunctionCallingHistory.
    const topMeta = (result as { providerMetadata?: Record<string, unknown> })
      .providerMetadata;
    expect(topMeta?.automaticFunctionCallingHistory).toBeUndefined();
    // The content metadata must NOT carry automaticFunctionCallingHistory.
    const contentMeta = (
      result as {
        content?: { metadata?: { providerMetadata?: Record<string, unknown> } };
      }
    ).content?.metadata?.providerMetadata;
    expect(contentMeta?.automaticFunctionCallingHistory).toBeUndefined();
  });

  it('strips ALL AFC from both metadata locations when no tools are allowed', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'no tools' }],
          metadata: {
            stopReason: 'stop',
            providerMetadata: {
              automaticFunctionCallingHistory: [
                {
                  speaker: 'ai',
                  blocks: [
                    {
                      type: 'tool_call',
                      id: 'call-x',
                      name: 'read_file',
                      parameters: {},
                    },
                  ],
                },
                {
                  speaker: 'tool',
                  blocks: [
                    {
                      type: 'tool_response',
                      callId: 'call-x',
                      toolName: 'read_file',
                      result: 'ok',
                    },
                  ],
                },
              ],
            },
          },
        },
      ]),
    ) as Mock;
    const baseConfig = new Config(createConfigParams(new SettingsService()));
    // Empty allowed list → all tools disallowed
    const harness = createDirectHarness(mock, {
      tools,
      hookConfig: configWithHooks(baseConfig, []),
    });

    const result = (await harness.chat.generateDirectMessage(
      { message: 'use tools', config: { tools } },
      'prompt-afc-none-allowed',
    )) as Record<string, unknown>;

    const json = JSON.stringify(result);
    expect(json).not.toContain('automaticFunctionCallingHistory');
    expect(json).not.toContain('read_file');
  });
});

describe('DirectMessageProcessor AFC sanitization — malformed/orphan', () => {
  it('strips malformed AFC (not an array) from both metadata locations', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'text' }],
          metadata: {
            stopReason: 'stop',
            providerMetadata: {
              automaticFunctionCallingHistory: 'not-an-array',
            },
          },
        },
      ]),
    ) as Mock;
    const baseConfig = new Config(createConfigParams(new SettingsService()));
    const harness = createDirectHarness(mock, {
      tools,
      hookConfig: configWithHooks(baseConfig, ['read_file']),
    });

    const result = (await harness.chat.generateDirectMessage(
      { message: 'q', config: { tools } },
      'prompt-afc-malformed',
    )) as Record<string, unknown>;

    const json = JSON.stringify(result);
    expect(json).not.toContain('automaticFunctionCallingHistory');
  });

  it('preserves a structurally-valid orphaned tool_call in neutral afcHistory while stripping provider wire metadata', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'orphan' }],
          metadata: {
            stopReason: 'stop',
            providerMetadata: {
              automaticFunctionCallingHistory: [
                {
                  speaker: 'ai',
                  blocks: [
                    {
                      type: 'tool_call',
                      id: 'orphan-call',
                      name: 'read_file',
                      parameters: {},
                    },
                  ],
                },
              ],
            },
          },
        },
      ]),
    ) as Mock;
    const baseConfig = new Config(createConfigParams(new SettingsService()));
    const harness = createDirectHarness(mock, {
      tools,
      hookConfig: configWithHooks(baseConfig, ['read_file']),
    });

    const result = (await harness.chat.generateDirectMessage(
      { message: 'q', config: { tools } },
      'prompt-afc-orphan',
    )) as Record<string, unknown>;

    const json = JSON.stringify(result);
    // Provider wire metadata is stripped from BOTH metadata locations —
    // agents never see the raw automaticFunctionCallingHistory key.
    expect(json).not.toContain('automaticFunctionCallingHistory');
    const topMeta = (result as { providerMetadata?: Record<string, unknown> })
      .providerMetadata;
    expect(topMeta?.automaticFunctionCallingHistory).toBeUndefined();
    const contentMeta = (
      result as {
        content?: { metadata?: { providerMetadata?: Record<string, unknown> } };
      }
    ).content?.metadata?.providerMetadata;
    expect(contentMeta?.automaticFunctionCallingHistory).toBeUndefined();

    // Structural preservation (neutral contract): the structurally-valid
    // orphaned tool_call (an allowed tool) survives into the first-class
    // neutral afcHistory field. Call/response pairing is NOT enforced at
    // this boundary — only per-entry structural validity plus hook
    // restriction filtering.
    const afcHistory = (result as { afcHistory?: IContent[] }).afcHistory;
    expect(afcHistory).toBeDefined();
    expect(afcHistory).toHaveLength(1);
    expect(afcHistory?.[0].blocks[0]).toMatchObject({
      type: 'tool_call',
      id: 'orphan-call',
      name: 'read_file',
    });
  });

  it('strips null/undefined/garbage AFC entries from both metadata locations', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'garbage' }],
          metadata: {
            stopReason: 'stop',
            providerMetadata: {
              automaticFunctionCallingHistory: [null, undefined, 42, 'bad'],
            },
          },
        },
      ]),
    ) as Mock;
    const baseConfig = new Config(createConfigParams(new SettingsService()));
    const harness = createDirectHarness(mock, {
      tools,
      hookConfig: configWithHooks(baseConfig, ['read_file']),
    });

    const result = (await harness.chat.generateDirectMessage(
      { message: 'q', config: { tools } },
      'prompt-afc-garbage',
    )) as Record<string, unknown>;

    const json = JSON.stringify(result);
    expect(json).not.toContain('automaticFunctionCallingHistory');
  });

  it('preserves response text when AFC is malformed', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([
        textIContent('visible text survives'),
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: ' continuation' }],
          metadata: {
            stopReason: 'stop',
            providerMetadata: {
              automaticFunctionCallingHistory: [
                { speaker: 'INVALID', blocks: [] },
              ],
            },
          },
        },
      ]),
    ) as Mock;
    const baseConfig = new Config(createConfigParams(new SettingsService()));
    const harness = createDirectHarness(mock, {
      tools,
      hookConfig: configWithHooks(baseConfig, ['read_file']),
    });

    const result = (await harness.chat.generateDirectMessage(
      { message: 'q', config: { tools } },
      'prompt-afc-text-survives',
    )) as { content?: { blocks?: Array<{ type: string; text?: string }> } };

    const text = (result.content?.blocks ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    expect(text).toContain('visible text survives');
  });
});
