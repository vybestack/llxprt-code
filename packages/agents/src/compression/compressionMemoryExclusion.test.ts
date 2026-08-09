/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #3174: compression requests must exclude caller
 * core memory (.LLXPRT_SYSTEM) and MCP-server instructions.
 *
 * Unlike the sibling compressionSystemPrompt.test.ts, this file does NOT mock
 * getCoreSystemPromptAsync. It exercises the REAL compression system-prompt
 * assembler against a real on-disk .LLXPRT_SYSTEM file and real MCP
 * instructions exposed through config, then asserts neither leaks into the
 * assembled compression instruction. It also proves the compression request
 * still carries the <state_snapshot> template and that a valid snapshot
 * response is applied.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type {
  CompressionContext,
  CompressionProviderResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { PromptResolver } from '@vybestack/llxprt-code-core/prompt-config/prompt-resolver.js';
import { buildCompressionSystemInstruction } from './compressionSystemPrompt.js';
import { OneShotStrategy } from './OneShotStrategy.js';

// ---------------------------------------------------------------------------
// Sentinels
// ---------------------------------------------------------------------------

const CORE_MEMORY_SENTINEL = 'CORE_MEMORY_SENTINEL_3174_DO_NOT_LEAK';
const MCP_SENTINEL = 'MCP_INSTRUCTIONS_SENTINEL_3174_DO_NOT_LEAK';
const CORE_MEMORY_WRAPPER = 'Core System Memory';
const VALID_SNAPSHOT =
  '<state_snapshot><overall_goal>ship issue 3174</overall_goal></state_snapshot>';
const COMPRESSION_MODEL = 'compression-test-model';

// ---------------------------------------------------------------------------
// Test-isolation state
// ---------------------------------------------------------------------------

let promptDir: string;
let originalCwd: string;
let projectDir: string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal Config double that exposes MCP instructions containing the sentinel.
 * Config is a large class whose real construction requires full session
 * initialization (McpClientManager, MessageBus, tool registry, ...). The MCP
 * accessor is a regression input that the previous compression assembler read;
 * the fixed assembler must ignore it. The strategy path still reads
 * isInteractive() to derive the compressed session's interaction mode.
 */
function createMcpConfigDouble(mcpInstructions: string): Config {
  const manager = {
    getMcpInstructions: () => mcpInstructions,
  };
  return {
    getMcpClientManager: () => manager,
    isInteractive: () => false,
  } as unknown as Config;
}

function humanMsg(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function aiTextMsg(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

function generateHistory(count: number): IContent[] {
  const messages: IContent[] = [];
  for (let i = 0; i < count; i++) {
    messages.push(
      i % 2 === 0
        ? humanMsg(`user message ${i}`)
        : aiTextMsg(`ai response ${i}`),
    );
  }
  return messages;
}

function extractText(contents: readonly IContent[]): string {
  const parts: string[] = [];
  for (const msg of contents) {
    for (const block of msg.blocks) {
      if (block.type === 'text') {
        parts.push(block.text);
      }
    }
  }
  return parts.join('\n');
}

function createOptionsCapturingProvider(
  captured: RuntimeGenerateChatOptions[],
  summaryText: string,
): IProvider {
  return {
    name: 'options-capture-provider',
    getModels: async () => [],
    getDefaultModel: () => COMPRESSION_MODEL,
    getServerTools: () => [],
    invokeServerTool: async () => ({}),
    async *generateChatCompletion(options: RuntimeGenerateChatOptions) {
      captured.push(options);
      yield {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: summaryText }],
      };
    },
  } as unknown as IProvider;
}

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  log: () => {},
} as unknown as DebugLogger;

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

function buildCompressionContext(
  overrides: Partial<{
    history: IContent[];
    config: Config;
    provider: IProvider;
  }>,
): CompressionContext {
  const provider =
    overrides.provider ?? createOptionsCapturingProvider([], VALID_SNAPSHOT);
  const resolveProvider = (): CompressionProviderResult => ({
    provider,
    runtime: createStubProviderRuntime(),
  });

  const runtimeState: AgentRuntimeState = {
    runtimeId: 'test-runtime',
    provider: 'test-provider',
    model: COMPRESSION_MODEL,
    sessionId: 'test-session',
    updatedAt: Date.now(),
  };

  const runtimeContext = {
    state: runtimeState,
    ephemerals: {
      compressionThreshold: () => 0.8,
      contextLimit: () => 100000,
      preserveThreshold: () => 0.2,
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
    providerRuntime: createStubProviderRuntime(),
  } as unknown as AgentRuntimeContext;

  const promptResolver = {
    resolveFile: () => ({ found: false, path: null, source: null }),
  } as unknown as PromptResolver;

  const context: CompressionContext = {
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
    promptContext: { provider: 'test-provider', model: COMPRESSION_MODEL },
    promptId: 'test-prompt',
    ...(overrides.config === undefined ? {} : { config: overrides.config }),
  };
  return context;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Compression memory exclusion (issue #3174)', () => {
  beforeAll(async () => {
    promptDir = mkdtempSync(join(tmpdir(), 'llxprt-compression-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDir;
    await initializePromptSystem();
  });

  beforeEach(() => {
    originalCwd = process.cwd();
    projectDir = mkdtempSync(join(tmpdir(), 'llxprt-compression-project-'));
    mkdirSync(join(projectDir, '.llxprt'), { recursive: true });
    writeFileSync(
      join(projectDir, '.llxprt', '.LLXPRT_SYSTEM'),
      `${CORE_MEMORY_SENTINEL}\nsuppress this core memory during compression`,
    );
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(promptDir, { recursive: true, force: true });
    delete process.env.LLXPRT_PROMPTS_DIR;
  });

  it('excludes core memory and MCP instructions from the assembled compression system instruction', async () => {
    const instruction = await buildCompressionSystemInstruction(
      COMPRESSION_MODEL,
      {
        provider: 'compression-test-provider',
        interactionMode: 'non-interactive',
      },
    );

    expect(typeof instruction).toBe('string');
    expect(instruction.length).toBeGreaterThan(0);
    expect(instruction).not.toContain(CORE_MEMORY_SENTINEL);
    expect(instruction).not.toContain(MCP_SENTINEL);
    expect(instruction).not.toContain(CORE_MEMORY_WRAPPER);
  });

  it('still produces a non-empty instruction even without core memory on disk', async () => {
    rmSync(join(projectDir, '.llxprt'), { recursive: true, force: true });
    const instruction = await buildCompressionSystemInstruction(
      COMPRESSION_MODEL,
      {
        provider: 'compression-test-provider',
        interactionMode: 'non-interactive',
      },
    );

    expect(typeof instruction).toBe('string');
    expect(instruction.length).toBeGreaterThan(0);
    expect(instruction).not.toContain(CORE_MEMORY_WRAPPER);
  });

  it('strategy request excludes memory/MCP, keeps the state_snapshot template, and applies a valid snapshot', async () => {
    const captured: RuntimeGenerateChatOptions[] = [];
    const provider = createOptionsCapturingProvider(captured, VALID_SNAPSHOT);
    const context = buildCompressionContext({
      history: generateHistory(20),
      config: createMcpConfigDouble(MCP_SENTINEL),
      provider,
    });

    const strategy = new OneShotStrategy();
    const result = await strategy.compress(context);

    expect(captured.length).toBeGreaterThanOrEqual(1);
    const request = captured[0];
    const sysInstr = request.systemInstruction;
    expect(typeof sysInstr).toBe('string');
    expect((sysInstr as string).length).toBeGreaterThan(0);
    expect(sysInstr).not.toContain(CORE_MEMORY_SENTINEL);
    expect(sysInstr).not.toContain(MCP_SENTINEL);
    expect(sysInstr).not.toContain(CORE_MEMORY_WRAPPER);

    const requestText = extractText(request.contents);
    expect(requestText).toContain('<state_snapshot>');

    expect(result.kind).toBe('applied');
    const summarizedHistory =
      result.kind === 'applied' ? result.newHistory : [];
    expect(extractText(summarizedHistory)).toContain('<state_snapshot>');
  });
});
