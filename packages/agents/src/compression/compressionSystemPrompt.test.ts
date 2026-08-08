/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests asserting each of the three compression call sites
 * supplies a non-empty `systemInstruction` to the provider (issue #3136,
 * Step 3).
 *
 * OneShotStrategy.callProvider, MiddleOutStrategy.callProvider, and
 * runVerificationPass previously omitted `systemInstruction`, relying on
 * the provider's own `getCoreSystemPromptAsync` rebuild. Once that rebuild
 * is removed they would send NO prompt. These tests prove the agent-layer
 * helper now fills the gap.
 */

import { describe, it, expect, vi } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  CompressionContext,
  CompressionProviderResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { Logger } from '@vybestack/llxprt-code-core/core/logger.js';
import type { PromptResolver } from '@vybestack/llxprt-code-core/prompt-config/prompt-resolver.js';
import { OneShotStrategy } from './OneShotStrategy.js';
import { MiddleOutStrategy } from './MiddleOutStrategy.js';
import { runVerificationPass } from './utils.js';

const COMPRESSION_SYSTEM_PROMPT = 'COMPRESSION_CORE_PROMPT';

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => COMPRESSION_SYSTEM_PROMPT),
  getCompressionPrompt: vi.fn(() => 'COMPRESS_PROMPT'),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanMsg(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function aiTextMsg(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

function generateHistory(count: number): IContent[] {
  const messages: IContent[] = [];
  for (let i = 0; i < count; i++) {
    if (i % 2 === 0) {
      messages.push(humanMsg(`user message ${i}`));
    } else {
      messages.push(aiTextMsg(`ai response ${i}`));
    }
  }
  return messages;
}

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  log: () => {},
} as unknown as Logger;

/**
 * Fake provider that captures every `generateChatCompletion` call's options
 * so tests can assert on the `systemInstruction` field.
 */
function createCapturingProvider(
  captured: RuntimeGenerateChatOptions[],
  summaryText = '<state_snapshot>summary</state_snapshot>',
): IProvider {
  return {
    name: 'capturing-provider',
    getModels: async () => [],
    getDefaultModel: () => 'test-model',
    getServerTools: () => [],
    invokeServerTool: async () => ({}),
    async *generateChatCompletion(opts: RuntimeGenerateChatOptions) {
      captured.push(opts);
      yield {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: summaryText }],
      };
    },
  } as unknown as IProvider;
}

function buildContext(
  provider: IProvider,
  overrides: Partial<{
    history: IContent[];
    preserveThreshold: number;
    compressionVerification: boolean;
  }> = {},
): CompressionContext {
  const contextProviderRuntime = {
    settingsService: {
      get: () => undefined,
      set: () => {},
      getProviderSettings: () => ({}),
    },
    config: undefined,
    runtimeId: 'test-provider-runtime',
    metadata: { source: 'test' },
  };

  const resolveProvider = (): CompressionProviderResult => ({
    provider,
    runtime: contextProviderRuntime,
  });

  const runtimeState: AgentRuntimeState = {
    runtimeId: 'test-runtime',
    provider: 'test-provider',
    model: 'test-model',
    sessionId: 'test-session',
    updatedAt: Date.now(),
  };

  const runtimeContext = {
    state: runtimeState,
    ephemerals: {
      compressionThreshold: () => 0.8,
      contextLimit: () => 100000,
      preserveThreshold: () => overrides.preserveThreshold ?? 0.2,
      topPreserveThreshold: () => 0.2,
      compressionProfile: () => undefined,
      toolFormatOverride: () => undefined,
      reasoning: {
        enabled: () => false,
        includeInContext: () => false,
        includeInResponse: () => false,
        format: () => 'native' as const,
        stripFromContext: () => 'none' as const,
        effort: () => undefined,
        maxTokens: () => undefined,
        adaptiveThinking: () => undefined,
      },
    },
    providerRuntime: contextProviderRuntime,
  } as unknown as AgentRuntimeContext;

  const promptResolver = {
    resolveFile: () => ({ found: false, path: null, source: null }),
  } as unknown as PromptResolver;

  return {
    history: overrides.history ?? [],
    runtimeContext,
    runtimeState,
    estimateTokens: async (contents: readonly IContent[]) =>
      contents.length * 100,
    currentTokenCount: 5000,
    logger: noopLogger,
    resolveProvider,
    promptResolver,
    promptBaseDir: '/tmp/test-prompts',
    promptContext: {
      provider: 'test-provider',
      model: 'test-model',
    },
    promptId: 'test-prompt',
    compressionVerification: overrides.compressionVerification,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Compression system instruction (issue #3136, Step 3)', () => {
  it('OneShotStrategy.callProvider sends a non-empty systemInstruction', async () => {
    const captured: RuntimeGenerateChatOptions[] = [];
    const provider = createCapturingProvider(captured);
    const history = generateHistory(20);
    const context = buildContext(provider, { history });

    const strategy = new OneShotStrategy();
    const result = await strategy.compress(context);

    expect(result.kind).toBe('applied');
    expect(captured.length).toBeGreaterThanOrEqual(1);
    const sysInstr = captured[0].systemInstruction;
    expect(typeof sysInstr).toBe('string');
    expect((sysInstr as string).length).toBeGreaterThan(0);
    expect(sysInstr).toBe(COMPRESSION_SYSTEM_PROMPT);
  });

  it('MiddleOutStrategy.callProvider sends a non-empty systemInstruction', async () => {
    const captured: RuntimeGenerateChatOptions[] = [];
    const provider = createCapturingProvider(captured);
    const history = generateHistory(20);
    const context = buildContext(provider, {
      history,
      preserveThreshold: 0.2,
    });

    const strategy = new MiddleOutStrategy();
    const result = await strategy.compress(context);

    expect(result.kind).toBe('applied');
    expect(captured.length).toBeGreaterThanOrEqual(1);
    const sysInstr = captured[0].systemInstruction;
    expect(typeof sysInstr).toBe('string');
    expect((sysInstr as string).length).toBeGreaterThan(0);
    expect(sysInstr).toBe(COMPRESSION_SYSTEM_PROMPT);
  });

  it('runVerificationPass sends a non-empty systemInstruction', async () => {
    const captured: RuntimeGenerateChatOptions[] = [];
    const provider = createCapturingProvider(captured, 'VERIFIED');
    const context = buildContext(provider);

    await runVerificationPass(provider, 'initial summary', context);

    expect(captured.length).toBe(1);
    const sysInstr = captured[0].systemInstruction;
    expect(typeof sysInstr).toBe('string');
    expect((sysInstr as string).length).toBeGreaterThan(0);
    expect(sysInstr).toBe(COMPRESSION_SYSTEM_PROMPT);
  });

  it('OneShotStrategy with verification sends systemInstruction on BOTH calls', async () => {
    const captured: RuntimeGenerateChatOptions[] = [];
    const provider = createCapturingProvider(captured, 'VERIFIED');
    const history = generateHistory(20);
    const context = buildContext(provider, {
      history,
      compressionVerification: true,
    });

    const strategy = new OneShotStrategy();
    await strategy.compress(context);

    // First call = initial compression, second = verification pass
    expect(captured.length).toBe(2);
    for (const opts of captured) {
      const sysInstr = opts.systemInstruction;
      expect(typeof sysInstr).toBe('string');
      expect((sysInstr as string).length).toBeGreaterThan(0);
    }
  });
});
