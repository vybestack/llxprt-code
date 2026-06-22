/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P05
 *
 * Shared helpers for MiddleOutStrategy test files. Extracted from the
 * original monolithic MiddleOutStrategy.test.ts so no file-level max-lines
 * disable is needed.
 */

import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  CompressionContext,
  CompressionProviderResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { PromptResolver } from '@vybestack/llxprt-code-core/prompt-config/prompt-resolver.js';

// ---------------------------------------------------------------------------
// IContent factories
// ---------------------------------------------------------------------------

export function humanMsg(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

export function aiTextMsg(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

export function aiToolCallMsg(
  ...calls: Array<{ id: string; name: string }>
): IContent {
  return {
    speaker: 'ai',
    blocks: calls.map((c) => ({
      type: 'tool_call' as const,
      id: c.id,
      name: c.name,
      parameters: {},
    })),
  };
}

export function toolResponseMsg(
  callId: string,
  toolName: string,
  result: string,
): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response' as const,
        callId,
        toolName,
        result,
      },
    ],
  };
}

export function humanMsgWithMedia(
  text: string,
  ...mediaBlocks: MediaBlock[]
): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }, ...mediaBlocks],
  };
}

// ---------------------------------------------------------------------------
// Fake providers
// ---------------------------------------------------------------------------

export const KNOWN_SUMMARY =
  '<state_snapshot>Compressed summary of the middle section</state_snapshot>';

export function createFakeProvider(
  name: string,
  summaryText: string = KNOWN_SUMMARY,
): IProvider {
  return {
    name,
    getModels: async () => [],
    getDefaultModel: () => 'fake-model',
    getServerTools: () => [],
    invokeServerTool: async () => ({}),
    async *generateChatCompletion() {
      yield {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: summaryText }],
      };
    },
  } as unknown as IProvider;
}

class CaptureProvider implements IProvider {
  readonly name = 'capture-provider';

  constructor(
    private readonly capturedRequests: IContent[],
    private readonly summaryText: string = KNOWN_SUMMARY,
  ) {}

  getModels(): Promise<[]> {
    return Promise.resolve([]);
  }

  getDefaultModel(): string {
    return 'capture-model';
  }

  getServerTools(): string[] {
    return [];
  }

  invokeServerTool(): Promise<Record<string, never>> {
    return Promise.resolve({});
  }

  generateChatCompletion(
    options: RuntimeGenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  generateChatCompletion(content: IContent[]): AsyncIterableIterator<IContent>;
  async *generateChatCompletion(
    optionsOrContent: RuntimeGenerateChatOptions | IContent[],
  ): AsyncIterableIterator<IContent> {
    const contents = Array.isArray(optionsOrContent)
      ? optionsOrContent
      : optionsOrContent.contents;
    this.capturedRequests.push(...contents);
    yield {
      speaker: 'ai' as const,
      blocks: [{ type: 'text' as const, text: this.summaryText }],
    };
  }
}

export function createCaptureProvider(
  capturedRequests: IContent[],
  summaryText: string = KNOWN_SUMMARY,
): IProvider {
  return new CaptureProvider(capturedRequests, summaryText);
}

// ---------------------------------------------------------------------------
// Stub logger and runtime
// ---------------------------------------------------------------------------

export const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  log: () => {},
} as unknown as DebugLogger;

export const testProviderRuntime = {
  settingsService: {
    get: () => undefined,
    set: () => {},
    getProviderSettings: () => ({}),
  },
  config: undefined,
  runtimeId: 'test-provider-runtime',
  metadata: { source: 'test' },
};

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

function createStubProviderRuntime(): ProviderRuntimeContext {
  return {
    settingsService: {
      get: () => undefined,
      set: () => {},
      getProviderSettings: () => ({}),
    },
    config: undefined,
    runtimeId: 'test-provider-runtime',
    metadata: { source: 'test' },
  } as unknown as ProviderRuntimeContext;
}

function createStubPromptResolver(): PromptResolver {
  return {
    resolveFile: () => ({ found: false, path: null, source: null }),
  } as unknown as PromptResolver;
}

function createRuntimeContext(
  overrides: {
    compressionThreshold?: number;
    preserveThreshold?: number;
    topPreserveThreshold?: number;
    compressionProfile?: string;
  },
  runtimeState: AgentRuntimeState,
): AgentRuntimeContext {
  return {
    state: runtimeState,
    ephemerals: {
      compressionThreshold: () => overrides.compressionThreshold ?? 0.8,
      contextLimit: () => 100000,
      preserveThreshold: () => overrides.preserveThreshold ?? 0.2,
      topPreserveThreshold: () => overrides.topPreserveThreshold ?? 0.2,
      compressionProfile: () => overrides.compressionProfile,
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
    providerRuntime: createStubProviderRuntime(),
  } as unknown as AgentRuntimeContext;
}

export function buildContext(
  overrides: Partial<{
    history: IContent[];
    preserveThreshold: number;
    topPreserveThreshold: number;
    compressionThreshold: number;
    compressionProfile: string;
    resolveProvider: (profileName?: string) => CompressionProviderResult;
    model: string;
    provider: string;
    currentTokenCount: number;
  }> = {},
): CompressionContext {
  const resolveProvider =
    overrides.resolveProvider ??
    (() => ({
      provider: createFakeProvider('default-provider'),
      runtime: createStubProviderRuntime(),
    }));

  const runtimeState: AgentRuntimeState = {
    runtimeId: 'test-runtime',
    provider: overrides.provider ?? 'test-provider',
    model: overrides.model ?? 'test-model',
    sessionId: 'test-session',
    updatedAt: Date.now(),
  };

  const runtimeContext = createRuntimeContext(overrides, runtimeState);

  return {
    history: overrides.history ?? [],
    runtimeContext,
    runtimeState,
    estimateTokens: async (contents: readonly IContent[]) =>
      contents.length * 100,
    currentTokenCount: overrides.currentTokenCount ?? 5000,
    logger: noopLogger,
    resolveProvider,
    promptResolver: createStubPromptResolver(),
    promptBaseDir: '/tmp/test-prompts',
    promptContext: {
      provider: overrides.provider ?? 'test-provider',
      model: overrides.model ?? 'test-model',
    },
    promptId: 'test-prompt',
  };
}

/**
 * Generate a conversation history of alternating human/ai messages.
 */
export function generateHistory(count: number): IContent[] {
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
