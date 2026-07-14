/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Direct-message characterization tests — pins the OBSERVABLE non-streaming
 * (`generateDirectMessage`) behavior as it exists TODAY (returns
 * `GenerateContentResponse`), BEFORE P13 deletes the two synthetic
 * fabricators. These tests PASS against current code and are the safety
 * net that proves P13's dual-fabricator deletion is behavior-preserving.
 *
 * Reads current output ONLY through the `directMessageObservers.ts`
 * helper (visibleText / committedHistory / usageCounts / eventSequence).
 * NEVER indexes `.candidates`, `.parts`, `.content.parts`, or
 * `.usageMetadata` directly.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P12
 * @requirement:REQ-INT-001.3
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/index.js';
import * as fc from 'fast-check';

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
  AfterModelHookOutput,
  BeforeModelHookOutput,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { createConfigParams } from '../chatSession-runtime-helpers.js';

import {
  visibleText,
  committedHistory,
  usageCounts,
} from './helpers/directMessageObservers.js';

// retry must be a no-op so the real DMP runs the provider call exactly once
vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((fn: () => unknown) => fn()),
}));

// ---------------------------------------------------------------------------
// IContent chunk factory — the ONLY mock boundary (the provider stream)
// ---------------------------------------------------------------------------

function textTerminalIContent(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { stopReason: 'stop' },
  };
}

function textWithUsageIContent(
  text: string,
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  },
): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: {
      stopReason: 'stop',
      usage: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      },
    },
  };
}

function makeProviderStream(chunks: IContent[]): AsyncGenerator<IContent> {
  return (async function* generate(): AsyncGenerator<IContent> {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
}

// ---------------------------------------------------------------------------
// Harness: REAL ChatSession → DirectMessageProcessor → HistoryService
//          with ONLY the provider AsyncIterable<IContent> mocked
// ---------------------------------------------------------------------------

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
    metadata: { source: 'p12.directMessage.characterization' },
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
    runtimeId: 'runtime-p12',
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

/**
 * Builds a Config whose HookSystem is wired to the given before/after-model
 * hook outputs. Uses Object.create(config) + defineProperties so the base
 * Config is not mutated.
 */
function configWithHooks(
  baseConfig: Config,
  hooks: {
    beforeModel?: () => BeforeModelHookOutput | undefined;
    afterModel?: () => AfterModelHookOutput | undefined;
  },
): Config {
  const hookConfig = Object.create(baseConfig) as Config;
  Object.defineProperties(hookConfig, {
    getEnableHooks: { value: () => true },
    getHookSystem: {
      value: () => ({
        initialize: async () => undefined,
        fireBeforeToolSelectionEvent: async () => undefined,
        fireBeforeModelEvent: async () => hooks.beforeModel?.(),
        fireAfterModelEvent: async () => hooks.afterModel?.(),
      }),
    },
  });
  return hookConfig;
}

// ===========================================================================
// REQ-INT-001.3 — Blocking BeforeModel hook path
// ===========================================================================

describe('P12: blocking BeforeModel hook (characterization)', () => {
  it('visible text equals the hook block reason', async () => {
    const blockReason = 'Request denied by policy guard';
    const mock = vi.fn(() =>
      makeProviderStream([textTerminalIContent('should never be seen')]),
    ) as Mock;
    const baseConfig = new Config(createConfigParams(new SettingsService()));
    const harness = createDirectHarness(mock, {
      hookConfig: configWithHooks(baseConfig, {
        beforeModel: () =>
          new BeforeModelHookOutput({
            decision: 'block',
            stopReason: blockReason,
          }),
      }),
    });

    const result = await harness.chat.generateDirectMessage(
      { message: 'do something disallowed' },
      'prompt-p12-block',
    );

    expect(visibleText(result)).toBe(blockReason);
  });

  it('committed history reflects the request was processed', async () => {
    const blockReason = 'Blocked: quota exceeded';
    const mock = vi.fn(() =>
      makeProviderStream([textTerminalIContent('unused')]),
    ) as Mock;
    const baseConfig = new Config(createConfigParams(new SettingsService()));
    const historyService = new HistoryService();
    const harness = createDirectHarness(mock, {
      historyService,
      hookConfig: configWithHooks(baseConfig, {
        beforeModel: () =>
          new BeforeModelHookOutput({
            decision: 'block',
            stopReason: blockReason,
          }),
      }),
    });

    const result = await harness.chat.generateDirectMessage(
      { message: 'blocked request' },
      'prompt-p12-block-history',
    );

    // The blocking path returns the synthetic response; the observable
    // value is the block reason, observable to any downstream consumer.
    expect(visibleText(result)).toBe(blockReason);
    // committedHistory is the neutral HistoryService snapshot (the direct
    // path does not append model turns today; this pins that observable).
    expect(committedHistory(historyService)).toStrictEqual([]);
  });

  // PROPERTY: for any non-empty blocking reason string, visible text === reason
  it('visible text equals any arbitrary blocking reason (property)', async () => {
    const reasonArb = fc
      .string({ minLength: 1 })
      .filter((s) => s.trim().length > 0);
    await fc.assert(
      fc.asyncProperty(reasonArb, async (blockReason: string) => {
        const mock = vi.fn(() =>
          makeProviderStream([textTerminalIContent('should not appear')]),
        ) as Mock;
        const baseConfig = new Config(
          createConfigParams(new SettingsService()),
        );
        const harness = createDirectHarness(mock, {
          hookConfig: configWithHooks(baseConfig, {
            beforeModel: () =>
              new BeforeModelHookOutput({
                decision: 'block',
                stopReason: blockReason,
              }),
          }),
        });
        const result = await harness.chat.generateDirectMessage(
          { message: 'test' },
          'prompt-p12-block-prop',
        );
        expect(visibleText(result)).toBe(blockReason);
      }),
    );
  });
});

// ===========================================================================
// REQ-INT-001.3 — Normal completion path
// ===========================================================================

describe('P12: normal completion path (characterization)', () => {
  it('visible text is the model text and usage is populated', async () => {
    const modelText = 'The answer is forty-two.';
    const mock = vi.fn(() =>
      makeProviderStream([
        textWithUsageIContent(modelText, {
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
        }),
      ]),
    ) as Mock;
    const harness = createDirectHarness(mock);

    const result = await harness.chat.generateDirectMessage(
      { message: 'what is the answer' },
      'prompt-p12-normal',
    );

    expect(visibleText(result)).toBe(modelText);
    const counts = usageCounts(result);
    expect(counts.promptTokens).toBe(12);
    expect(counts.completionTokens).toBe(8);
    expect(counts.totalTokens).toBe(20);
  });

  it('aggregates text across multiple streamed chunks', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([
        textTerminalIContent('Hello'),
        textTerminalIContent(' world'),
        textTerminalIContent('!'),
      ]),
    ) as Mock;
    const harness = createDirectHarness(mock);

    const result = await harness.chat.generateDirectMessage(
      { message: 'greet' },
      'prompt-p12-multi',
    );

    // aggregateTextWithSpacing joins text blocks with a space separator
    expect(visibleText(result)).toBe('Hello world!');
  });

  it('preserves thinking-block position when aggregating multi-chunk text', async () => {
    // The last (terminal) chunk carries a thinking block BEFORE the text
    // block. _ensureResponseText must replace the text in-place (preserving
    // the thinking block) rather than moving all non-text blocks first
    // or stripping the thinking block.
    function thinkingThenTextIContent(thought: string, text: string): IContent {
      return {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought, sourceField: 'thought' },
          { type: 'text', text },
        ],
        metadata: { stopReason: 'stop' },
      };
    }
    const mock = vi.fn(() =>
      makeProviderStream([
        textTerminalIContent('Hello'),
        thinkingThenTextIContent('Let me think', 'world!'),
      ]),
    ) as Mock;
    const harness = createDirectHarness(mock);

    const result = await harness.chat.generateDirectMessage(
      { message: 'think and greet' },
      'prompt-p12-thinking-order',
    );

    // The aggregated text must include all chunks' text.
    expect(visibleText(result)).toBe('Hello world!');
    // The thinking block from the terminal chunk must survive — it must
    // NOT be stripped or reordered by _ensureResponseText.
    const blocks = (result as { content?: { blocks?: unknown[] } }).content
      ?.blocks;
    expect(Array.isArray(blocks)).toBe(true);
    const typedBlocks = blocks as unknown[];
    const thinking = typedBlocks.find(
      (b) =>
        typeof b === 'object' &&
        b !== null &&
        (b as { type: string }).type === 'thinking',
    );
    expect(thinking).toBeDefined();
  });

  it('appends text at end when last chunk has no text blocks (tool-call only)', async () => {
    // The last chunk carries only a tool_call block — no text block.
    // _ensureResponseText must append the aggregated text AFTER the
    // tool_call rather than dropping it.
    function toolCallOnlyIContent(): IContent {
      return {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'read_file',
            parameters: { path: '/test' },
          },
        ],
        metadata: { stopReason: 'tool_call' },
      };
    }
    const mock = vi.fn(() =>
      makeProviderStream([
        textTerminalIContent('Calling tool: '),
        toolCallOnlyIContent(),
      ]),
    ) as Mock;
    const harness = createDirectHarness(mock);

    const result = await harness.chat.generateDirectMessage(
      { message: 'use tool' },
      'prompt-p12-tool-append',
    );

    expect(visibleText(result)).toBe('Calling tool: ');
  });

  // PROPERTY: for any visible model text, it surfaces unchanged
  it('surfaces any arbitrary model text unchanged (property)', async () => {
    const textArb = fc
      .string({ minLength: 1 })
      .filter((s) => s.trim().length > 0 && !s.includes('\x00'));
    await fc.assert(
      fc.asyncProperty(textArb, async (modelText: string) => {
        const mock = vi.fn(() =>
          makeProviderStream([textTerminalIContent(modelText)]),
        ) as Mock;
        const harness = createDirectHarness(mock);
        const result = await harness.chat.generateDirectMessage(
          { message: 'q' },
          'prompt-p12-normal-prop',
        );
        expect(visibleText(result)).toBe(modelText);
      }),
    );
  });

  // PROPERTY: usage token counts round-trip through the neutral observer
  it('neutral usage counts round-trip provider-supplied numbers (property)', async () => {
    const usageArb = fc.record({
      promptTokens: fc.nat({ max: 100000 }),
      completionTokens: fc.nat({ max: 100000 }),
      totalTokens: fc.nat({ max: 100000 }),
    });
    await fc.assert(
      fc.asyncProperty(usageArb, async (usage) => {
        const mock = vi.fn(() =>
          makeProviderStream([
            textWithUsageIContent('ok', {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
            }),
          ]),
        ) as Mock;
        const harness = createDirectHarness(mock);
        const result = await harness.chat.generateDirectMessage(
          { message: 'q' },
          'prompt-p12-usage-prop',
        );
        const counts = usageCounts(result);
        expect(counts.promptTokens).toBe(usage.promptTokens);
        expect(counts.completionTokens).toBe(usage.completionTokens);
        expect(counts.totalTokens).toBe(usage.totalTokens);
      }),
    );
  });
});

// ===========================================================================
// REQ-INT-001.3 — After-model hook filtering path
// ===========================================================================

describe('P12: after-model hook filtering (characterization)', () => {
  it('hook-modified text is reflected in observable visible text', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([textTerminalIContent('original provider text')]),
    ) as Mock;
    const baseConfig = new Config(createConfigParams(new SettingsService()));
    const harness = createDirectHarness(mock, {
      hookConfig: configWithHooks(baseConfig, {
        beforeModel: () => new BeforeModelHookOutput({}),
        afterModel: () =>
          new AfterModelHookOutput({
            hookSpecificOutput: {
              llm_response: {
                candidates: [
                  {
                    content: {
                      role: 'model',
                      parts: ['hook filtered text'],
                    },
                    finishReason: 'STOP',
                  },
                ],
              },
            },
          }),
      }),
    });

    const result = await harness.chat.generateDirectMessage(
      { message: 'trigger after-model' },
      'prompt-p12-after',
    );

    expect(visibleText(result)).toBe('hook filtered text');
    expect(visibleText(result)).not.toContain('original provider text');
  });

  it('preserves provider text when after-model hook does not modify', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([textTerminalIContent('plain provider text')]),
    ) as Mock;
    const baseConfig = new Config(createConfigParams(new SettingsService()));
    const harness = createDirectHarness(mock, {
      hookConfig: configWithHooks(baseConfig, {
        beforeModel: () => new BeforeModelHookOutput({}),
        afterModel: () => new AfterModelHookOutput({}),
      }),
    });

    const result = await harness.chat.generateDirectMessage(
      { message: 'no modification' },
      'prompt-p12-after-noop',
    );

    expect(visibleText(result)).toBe('plain provider text');
  });

  // PROPERTY: for any hook-filtered text, the observable reflects the filter
  it('observable reflects any arbitrary hook-filtered text (property)', async () => {
    const filteredTextArb = fc
      .string({ minLength: 1 })
      .filter((s) => s.trim().length > 0 && !s.includes('\x00'));
    await fc.assert(
      fc.asyncProperty(filteredTextArb, async (filteredText: string) => {
        const mock = vi.fn(() =>
          makeProviderStream([textTerminalIContent('pre-hook provider text')]),
        ) as Mock;
        const baseConfig = new Config(
          createConfigParams(new SettingsService()),
        );
        const harness = createDirectHarness(mock, {
          hookConfig: configWithHooks(baseConfig, {
            beforeModel: () => new BeforeModelHookOutput({}),
            afterModel: () =>
              new AfterModelHookOutput({
                hookSpecificOutput: {
                  llm_response: {
                    candidates: [
                      {
                        content: {
                          role: 'model',
                          parts: [filteredText],
                        },
                        finishReason: 'STOP',
                      },
                    ],
                  },
                },
              }),
          }),
        });
        const result = await harness.chat.generateDirectMessage(
          { message: 'filter me' },
          'prompt-p12-after-prop',
        );
        expect(visibleText(result)).toBe(filteredText);
      }),
    );
  });
});
