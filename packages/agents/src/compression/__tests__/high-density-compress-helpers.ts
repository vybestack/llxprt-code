/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  CompressionContext,
  StrategyCompressionResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import { HighDensityStrategy } from '../HighDensityStrategy.js';

let callIdCounter = 0;

export function nextCallId(): string {
  return `call-${++callIdCounter}`;
}

export function resetCallIds(): void {
  callIdCounter = 0;
}

export function makeHumanMessage(text: string, timestamp?: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { timestamp: timestamp ?? Date.now() },
  };
}

export function makeAiText(text: string, timestamp?: number): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { timestamp: timestamp ?? Date.now() },
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
  result: unknown,
  error?: string,
): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName,
        result,
        ...(error !== undefined ? { error } : {}),
      } as ToolResponseBlock,
    ],
    metadata: { timestamp: Date.now() },
  };
}

export function wordCountEstimateTokens(
  contents: readonly IContent[],
): Promise<number> {
  let total = 0;
  for (const entry of contents) {
    for (const block of entry.blocks) {
      if (block.type === 'text') {
        total += block.text.split(/\s+/).filter(Boolean).length;
      } else if (block.type === 'tool_response') {
        const resultStr =
          typeof block.result === 'string'
            ? block.result
            : JSON.stringify(block.result);
        total += resultStr.split(/\s+/).filter(Boolean).length;
      } else if (block.type === 'tool_call') {
        const paramStr = JSON.stringify(block.parameters);
        total += paramStr.split(/\s+/).filter(Boolean).length;
        total += block.name.length;
      }
    }
  }
  return Promise.resolve(total);
}

export function buildCompressContext(
  overrides?: Partial<{
    history: IContent[];
    preserveThreshold: number;
    compressionThreshold: number;
    contextLimit: number;
    estimateTokens: (contents: readonly IContent[]) => Promise<number>;
    currentTokenCount: number;
  }>,
): CompressionContext {
  const history = overrides?.history ?? [];
  const preserveThreshold = overrides?.preserveThreshold ?? 0.3;
  const compressionThreshold = overrides?.compressionThreshold ?? 0.85;
  const contextLimit = overrides?.contextLimit ?? 128000;

  return {
    history,
    runtimeContext: {
      state: {
        runtimeId: 'test',
        provider: 'test',
        model: 'test',
        sessionId: 'test',
        updatedAt: Date.now(),
      },
      ephemerals: {
        compressionThreshold: () => compressionThreshold,
        contextLimit: () => contextLimit,
        preserveThreshold: () => preserveThreshold,
        topPreserveThreshold: () => 0.1,
        compressionProfile: () => undefined,
        compressionStrategy: () => 'high-density',
        toolFormatOverride: () => undefined,
        densityCompressHeadroom: () => 0.6,
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
    } as unknown as CompressionContext['runtimeContext'],
    runtimeState: {
      runtimeId: 'test',
      provider: 'test',
      model: 'test',
      sessionId: 'test',
      updatedAt: Date.now(),
    } as unknown as CompressionContext['runtimeState'],
    estimateTokens: overrides?.estimateTokens ?? wordCountEstimateTokens,
    currentTokenCount: overrides?.currentTokenCount ?? 100000,
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      log: () => {},
    } as unknown as CompressionContext['logger'],
    resolveProvider: () => {
      throw new Error('resolveProvider must not be called — no LLM allowed');
    },
    promptResolver: {
      resolveFile: () => ({ found: false, path: null, source: null }),
    } as unknown as CompressionContext['promptResolver'],
    promptBaseDir: '/tmp/test',
    promptContext: { provider: 'test', model: 'test' },
    promptId: 'test',
  };
}

export function buildMixedHistory(entryCount: number): IContent[] {
  resetCallIds();
  const history: IContent[] = [];
  for (let i = 0; i < entryCount; i++) {
    const phase = i % 4;
    if (phase === 0) {
      history.push(makeHumanMessage(`User question ${i}`));
    } else if (phase === 1) {
      const { entry, callId } = makeAiToolCall('read_file', {
        file_path: `/workspace/src/file${i}.ts`,
      });
      history.push(entry);
      const lines = Array.from(
        { length: 50 },
        (_, j) => `line ${j + 1}: content of file${i}.ts`,
      ).join('\n');
      history.push(makeToolResponse(callId, 'read_file', lines));
      i++;
    } else if (phase === 2) {
      history.push(makeAiText(`Here is my analysis of the code at step ${i}.`));
    } else {
      const { entry, callId } = makeAiToolCall('run_shell_command', {
        command: `echo "test output ${i}"`,
      });
      history.push(entry);
      history.push(
        makeToolResponse(
          callId,
          'run_shell_command',
          `test output ${i}\nmore output`,
        ),
      );
      i++;
    }
  }
  return history;
}

export function createStrategy(): HighDensityStrategy {
  return new HighDensityStrategy();
}

export function resultHistory(result: StrategyCompressionResult): IContent[] {
  return result.kind === 'applied' ? result.newHistory : [];
}
