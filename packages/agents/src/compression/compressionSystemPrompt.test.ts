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

import { describe, it, expect, vi, type Mock } from 'bun:test';
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
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import { OneShotStrategy } from './OneShotStrategy.js';
import { buildCompressionSystemInstruction } from './compressionSystemPrompt.js';
import { MiddleOutStrategy } from './MiddleOutStrategy.js';
import { runVerificationPass } from './utils.js';
import {
  CompressionLoadBalancingProvider,
  type CompressionLoadBalancerCandidate,
} from '../core/CompressionLoadBalancingProvider.js';

const COMPRESSION_SYSTEM_PROMPT = 'COMPRESSION_CORE_PROMPT';

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  // Echo interactionMode and provider into the returned prompt so tests can
  // assert on OBSERVABLE PROMPT CONTENT (per dev-docs/RULES.md — no mock
  // theater). When these args are absent the echo surfaces a sentinel,
  // which is exactly the regression these tests guard against (issue #3176).
  getCoreSystemPromptAsync: vi.fn(async (args: Record<string, unknown>) => {
    const mode = args.interactionMode ?? 'NO_MODE';
    const provider = args.provider ?? 'NO_PROVIDER';
    const model = args.model ?? 'NO_MODEL';
    return `${COMPRESSION_SYSTEM_PROMPT} mode=${mode} provider=${provider} model=${model}`;
  }),
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
    subagentName: string;
    config: Config;
  }> = {},
): CompressionContext {
  const contextProviderRuntime = {
    settingsService: {
      get: () => undefined,
      set: () => {},
      getProviderSettings: () => ({}),
    },
    config: overrides.config,
    runtimeId: 'test-provider-runtime',
    metadata: { source: 'test' },
  };

  const resolveProvider = (): CompressionProviderResult => ({
    provider,
    runtime: contextProviderRuntime,
    config: overrides.config,
  });

  const runtimeState: AgentRuntimeState = {
    runtimeId: 'test-runtime',
    provider: 'test-provider',
    model: 'test-model',
    sessionId: 'test-session',
    updatedAt: Date.now(),
    ...(overrides.subagentName !== undefined
      ? { subagentName: overrides.subagentName }
      : {}),
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
    config: overrides.config,
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
    expect(sysInstr).toContain(COMPRESSION_SYSTEM_PROMPT);
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
    expect(sysInstr).toContain(COMPRESSION_SYSTEM_PROMPT);
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
    expect(sysInstr).toContain(COMPRESSION_SYSTEM_PROMPT);
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
      expect(opts.systemInstruction).toContain(COMPRESSION_SYSTEM_PROMPT);
    }
  });
});

/**
 * Issue #3176, findings D5 + D8 — compression prompt assembly must use the
 * request-scoped provider and the compressed session's interaction mode.
 *
 * Each assertion is on the system instruction CONTENT delivered to the
 * provider (the mock echoes mode= and provider= into the string).
 */
describe('Compression request-scoped provider and interactionMode (issue #3176, D5+D8)', () => {
  function makeInteractiveConfig(interactive: boolean): Config {
    return {
      isInteractive: () => interactive,
      getMcpClientManager: () => undefined,
    } as unknown as Config;
  }

  // T8
  it('renders interactionMode=subagent when compressing a subagent runtime (D8)', async () => {
    const captured: RuntimeGenerateChatOptions[] = [];
    const provider = createCapturingProvider(captured);
    const history = generateHistory(20);
    const context = buildContext(provider, {
      history,
      subagentName: 'typescript-expert',
    });

    const strategy = new OneShotStrategy();
    await strategy.compress(context);

    expect(captured.length).toBeGreaterThanOrEqual(1);
    expect(captured[0].systemInstruction).toContain('mode=subagent');
  });

  // T9
  it('keeps interactive mode for a main-agent runtime (D8 regression)', async () => {
    const captured: RuntimeGenerateChatOptions[] = [];
    const provider = createCapturingProvider(captured);
    const history = generateHistory(20);
    const context = buildContext(provider, {
      history,
      config: makeInteractiveConfig(true),
    });

    const strategy = new OneShotStrategy();
    await strategy.compress(context);

    expect(captured.length).toBeGreaterThanOrEqual(1);
    const sysInstr = captured[0].systemInstruction as string;
    expect(sysInstr).toContain('mode=interactive');
    expect(sysInstr).not.toContain('mode=subagent');
  });

  it('keeps non-interactive mode for a non-interactive main-agent runtime', async () => {
    const captured: RuntimeGenerateChatOptions[] = [];
    const provider = createCapturingProvider(captured);
    const history = generateHistory(20);
    const context = buildContext(provider, {
      history,
      config: makeInteractiveConfig(false),
    });

    const strategy = new OneShotStrategy();
    await strategy.compress(context);

    expect(captured.length).toBeGreaterThanOrEqual(1);
    const sysInstr = captured[0].systemInstruction as string;
    expect(sysInstr).toContain('mode=non-interactive');
    expect(sysInstr).not.toContain('mode=subagent');
  });

  // T10
  it('resolves the compression provider name, not the foreground one (D5)', async () => {
    const captured: RuntimeGenerateChatOptions[] = [];
    const provider = createCapturingProvider(captured);
    // Override the name to a distinct compression provider identity.
    (provider as { name: string }).name = 'compression-provider-beta';
    const history = generateHistory(20);
    const context = buildContext(provider, { history });

    const strategy = new OneShotStrategy();
    await strategy.compress(context);

    expect(captured.length).toBeGreaterThanOrEqual(1);
    const sysInstr = captured[0].systemInstruction as string;
    expect(sysInstr).toContain('provider=compression-provider-beta');
    expect(sysInstr).not.toContain('provider=NO_PROVIDER');
  });

  it('assembles for a concrete provider named like the load-balancer wrapper', async () => {
    const captured: RuntimeGenerateChatOptions[] = [];
    const provider = createCapturingProvider(captured);
    (provider as { name: string }).name = 'load-balancer';
    const context = buildContext(provider, { history: generateHistory(20) });

    const strategy = new OneShotStrategy();
    await strategy.compress(context);

    expect(captured.length).toBeGreaterThanOrEqual(1);
    expect(captured[0].systemInstruction).toContain('provider=load-balancer');
  });

  it('rejects a blank compression provider identity', async () => {
    await expect(
      buildCompressionSystemInstruction('model-a', {
        provider: '   ',
        interactionMode: 'non-interactive',
      }),
    ).rejects.toThrow('Compression provider identity is required');
  });
});

function createLoadBalancerCandidate(
  providerName: string,
  model: string,
  captured: RuntimeGenerateChatOptions[],
  failure?: Error,
): CompressionLoadBalancerCandidate {
  const provider = createCapturingProvider(captured);
  (provider as { name: string }).name = providerName;
  if (failure) {
    provider.generateChatCompletion = (options) => {
      captured.push(options);
      throw failure;
    };
  }
  return {
    profileName: `${providerName}-profile`,
    provider,
    runtime: {
      settingsService:
        {} as CompressionLoadBalancerCandidate['runtime']['settingsService'],
    },
    config: undefined,
    resolved: { model },
    invocation: {} as CompressionLoadBalancerCandidate['invocation'],
  };
}

describe('Load-balanced compression prompt assembly (issue #3176, D5+D8)', () => {
  it('renders the selected round-robin candidate provider and model', async () => {
    const firstCalls: RuntimeGenerateChatOptions[] = [];
    const secondCalls: RuntimeGenerateChatOptions[] = [];
    const provider = new CompressionLoadBalancingProvider(
      'round-robin',
      [
        createLoadBalancerCandidate('provider-a', 'model-a', firstCalls),
        createLoadBalancerCandidate('provider-b', 'model-b', secondCalls),
      ],
      1,
      'subagent',
    );

    for await (const _chunk of provider.generateChatCompletion({
      contents: [],
    })) {
      // Drain the selected provider response.
    }

    expect(firstCalls).toHaveLength(0);
    expect(secondCalls).toHaveLength(1);
    expect(secondCalls[0].systemInstruction).toContain(
      'mode=subagent provider=provider-b model=model-b',
    );
  });

  it('re-renders provider and model for every failover candidate', async () => {
    const firstCalls: RuntimeGenerateChatOptions[] = [];
    const secondCalls: RuntimeGenerateChatOptions[] = [];
    const provider = new CompressionLoadBalancingProvider(
      'failover',
      [
        createLoadBalancerCandidate(
          'provider-a',
          'model-a',
          firstCalls,
          new Error('primary unavailable'),
        ),
        createLoadBalancerCandidate('provider-b', 'model-b', secondCalls),
      ],
      0,
      'interactive',
    );

    for await (const _chunk of provider.generateChatCompletion({
      contents: [],
    })) {
      // Drain the successful failover response.
    }

    expect(firstCalls[0].systemInstruction).toContain(
      'mode=interactive provider=provider-a model=model-a',
    );
    expect(secondCalls[0].systemInstruction).toContain(
      'mode=interactive provider=provider-b model=model-b',
    );
  });

  it('defers assembly until OneShotStrategy selects a concrete candidate', async () => {
    (
      getCoreSystemPromptAsync as Mock<typeof getCoreSystemPromptAsync>
    ).mockClear();
    const calls: RuntimeGenerateChatOptions[] = [];
    const provider = new CompressionLoadBalancingProvider(
      'round-robin',
      [createLoadBalancerCandidate('provider-a', 'model-a', calls)],
      0,
      'subagent',
    );
    const context = buildContext(provider, {
      history: generateHistory(20),
      subagentName: 'worker',
    });

    await new OneShotStrategy().compress(context);

    expect(getCoreSystemPromptAsync).toHaveBeenCalledTimes(1);
    expect(calls[0].systemInstruction).toContain(
      'mode=subagent provider=provider-a model=model-a',
    );
  });
});
