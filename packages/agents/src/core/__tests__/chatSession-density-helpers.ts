/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helpers for density optimization test files. Extracted from the
 * original monolithic chatSession-density.test.ts so no file-level
 * max-lines disable is needed.
 */

import { vi } from 'vitest';
import type { ChatSession } from '../chatSession.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';

// ---------------------------------------------------------------------------
// Test helpers — construct real IContent objects
// ---------------------------------------------------------------------------

let callIdCounter = 0;

function nextCallId(): string {
  return `call-${++callIdCounter}`;
}

export function resetCallIds(): void {
  callIdCounter = 0;
}

export function makeUserMessage(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { timestamp: Date.now() },
  };
}

export function makeAiText(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { timestamp: Date.now() },
  };
}

export function makeAiToolCall(
  toolName: string,
  parameters: unknown,
  callId?: string,
): { entry: IContent; callId: string } {
  const id = callId ?? nextCallId();
  return {
    entry: {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id,
          name: toolName,
          parameters,
        } as ToolCallBlock,
      ],
      metadata: { timestamp: Date.now() },
    },
    callId: id,
  };
}

export function makeToolResponse(
  callId: string,
  toolName: string,
  result: string,
): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName,
        result,
      } as ToolResponseBlock,
    ],
    metadata: { timestamp: Date.now() },
  };
}

// ---------------------------------------------------------------------------
// Runtime context builder — matches existing test patterns
// ---------------------------------------------------------------------------

export function buildRuntimeContext(
  historyService: HistoryService,
  overrides: {
    compressionStrategy?: string;
    compressionThreshold?: number;
    contextLimit?: number;
    'compression.density.readWritePruning'?: boolean;
    'compression.density.fileDedupe'?: boolean;
    'compression.density.recencyPruning'?: boolean;
    'compression.density.recencyRetention'?: number;
    'compression.density.optimizeThreshold'?: number;
  } = {},
): AgentRuntimeContext {
  const runtimeState = createAgentRuntimeState({
    runtimeId: 'test-runtime',
    provider: 'test-provider',
    model: 'test-model',
    sessionId: 'test-session',
  });

  const mockProviderAdapter = {
    getActiveProvider: vi.fn(() => ({
      name: 'test-provider',
      generateChatCompletion: vi.fn(),
    })),
  } as never;

  const mockTelemetryAdapter = {
    recordTokenUsage: vi.fn(),
    recordEvent: vi.fn(),
  } as never;

  const mockToolsView = {
    getToolRegistry: vi.fn(() => undefined),
  } as never;

  return createAgentRuntimeContext({
    state: runtimeState,
    history: historyService,
    settings: {
      compressionThreshold: overrides.compressionThreshold ?? 0.8,
      contextLimit: overrides.contextLimit ?? 131134,
      preserveThreshold: 0.2,
      telemetry: { enabled: false, target: null },
      compressionStrategy: overrides.compressionStrategy,
      'compression.density.readWritePruning':
        overrides['compression.density.readWritePruning'],
      'compression.density.fileDedupe':
        overrides['compression.density.fileDedupe'],
      'compression.density.recencyPruning':
        overrides['compression.density.recencyPruning'],
      'compression.density.recencyRetention':
        overrides['compression.density.recencyRetention'],
      'compression.density.optimizeThreshold':
        overrides['compression.density.optimizeThreshold'],
    },
    provider: mockProviderAdapter,
    telemetry: mockTelemetryAdapter,
    tools: mockToolsView,
    providerRuntime: {
      runtimeId: 'test-runtime',
      settingsService: { get: vi.fn(() => undefined) } as never,
      config: {} as never,
    },
  });
}

export function buildMockContentGenerator(): ContentGenerator {
  return {
    generateContent: vi.fn(),
    generateContentStream: vi.fn(),
    countTokens: vi.fn().mockReturnValue(100),
    embedContent: vi.fn(),
  } as unknown as ContentGenerator;
}

// ---------------------------------------------------------------------------
// Helper: Create a ChatSession with access to private members
// ---------------------------------------------------------------------------

export interface ChatSessionInternals {
  ensureDensityOptimized(): Promise<void>;
  densityDirty: boolean;
  historyService: HistoryService;
  ensureCompressionBeforeSend(
    promptId: string,
    pendingTokens: number,
    source: 'send' | 'stream',
    trigger?: 'manual' | 'auto',
  ): Promise<void>;
  enforceContextWindow(
    pendingTokens: number,
    promptId: string,
    provider?: unknown,
  ): Promise<void>;
  shouldCompress(pendingTokens?: number): boolean;
}

export function getInternals(chat: ChatSession): ChatSessionInternals {
  return chat as never;
}

// ---------------------------------------------------------------------------
// Helper: Build history with prunable read→write pairs
// ---------------------------------------------------------------------------

/**
 * Creates a history pattern that the high-density read-write pruning can act on:
 * 1. AI calls read_file on a file
 * 2. Tool responds with file contents
 * 3. AI calls write_file on the same file
 * 4. Tool responds with success
 *
 * The read pair (steps 1-2) becomes stale after the write and should be prunable.
 */
export function addPrunableReadWritePair(
  historyService: HistoryService,
  filePath: string,
  fileContent: string,
  writeContent: string,
): void {
  // Read call
  const readCall = makeAiToolCall('read_file', { file_path: filePath });
  historyService.add(readCall.entry);
  historyService.add(
    makeToolResponse(readCall.callId, 'read_file', fileContent),
  );

  // Write call (makes the read stale)
  const writeCall = makeAiToolCall('write_file', {
    file_path: filePath,
    content: writeContent,
  });
  historyService.add(writeCall.entry);
  historyService.add(
    makeToolResponse(
      writeCall.callId,
      'write_file',
      'File written successfully',
    ),
  );
}
