/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #2410 (Layer 1):
 * When `processFunctionCalls` returns `[]` (an empty, truthy array) — e.g.
 * because all function calls were hook-restricted — the non-interactive loop
 * must STOP rather than continue with `messages: []`. Previously `![]`
 * evaluated to `false`, so the loop continued, producing an empty user turn
 * that z.ai rejected with HTTP 400 error 1213.
 *
 * These tests verify two things:
 * 1. `dispatchNonInteractiveTurnResult` can return `[]` (an empty Content[])
 *    when processFunctionCalls returns [].
 * 2. `executeNonInteractiveRun` stops the loop cleanly when an iteration
 *    produces no further messages (either null or empty array).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Content, FunctionDeclaration } from '@google/genai';
import type { ChatSession } from './chatSession.js';
import type { ExecutionLoopContext } from './subagentExecution.js';
import type { NonInteractiveRunContext } from './subagentNonInteractive.js';
import {
  executeNonInteractiveRun,
  dispatchNonInteractiveTurnResult,
} from './subagentNonInteractive.js';
import {
  SubagentTerminateMode,
  type OutputObject,
  type RunConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { FunctionCall } from '@google/genai';

// Mock processFunctionCalls so it returns [] (simulating all-hook-restricted)
vi.mock('./subagentToolProcessing.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./subagentToolProcessing.js')>();
  return {
    ...actual,
    processFunctionCalls: vi.fn().mockResolvedValue([] as Content[]),
    resolveToolName: actual.resolveToolName,
    finalizeOutput: actual.finalizeOutput,
    buildTodoCompletionPrompt: vi.fn().mockResolvedValue(null),
  };
});

// Mock subagentExecution helpers
vi.mock('./subagentExecution.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./subagentExecution.js')>();
  return {
    ...actual,
    checkTerminationConditions: vi.fn().mockReturnValue({ shouldStop: false }),
    processNonInteractiveTextResponse: actual.processNonInteractiveTextResponse,
    handleExecutionError: actual.handleExecutionError,
    checkGoalCompletion: vi.fn().mockResolvedValue(null),
  };
});

// Import the mocked processFunctionCalls so we can assert on it
const { processFunctionCalls } = await import('./subagentToolProcessing.js');
const mockedProcessFunctionCalls = processFunctionCalls as unknown as {
  mockResolvedValue: (val: Content[]) => void;
  mockClear: () => void;
};

function makeExecCtx(): ExecutionLoopContext {
  return {
    output: { emitted_vars: {}, terminate_reason: SubagentTerminateMode.ERROR },
    subagentId: 'test-sub',
    runConfig: {
      max_turns: 10,
      max_time_minutes: 5,
    } as RunConfig,
    textToolParser: { parse: vi.fn().mockReturnValue({ functionCalls: [] }) },
    toolsView: {
      listToolNames: () => [],
      getToolMetadata: () => undefined,
    },
    logger: new DebugLogger('test'),
  };
}

function makeCtx(): NonInteractiveRunContext {
  return {
    output: {
      emitted_vars: {},
      terminate_reason: SubagentTerminateMode.ERROR,
    } as OutputObject,
    subagentId: 'test-sub',
    name: 'test',
    runtimeContext: {
      state: { sessionId: 'test-session' },
    } as never,
    logger: new DebugLogger('test'),
    config: {} as never,
    runConfig: {
      max_turns: 10,
      max_time_minutes: 5,
    } as RunConfig,
    toolExecutorContext: {
      getToolRegistry: () => ({}) as never,
      getEphemeralSettings: () => ({}),
      getEphemeralSetting: () => undefined,
      getExcludeTools: () => [],
      getSessionId: () => 'test-session',
      getTelemetryLogPromptsEnabled: () => false,
      getOrCreateScheduler: vi.fn(),
      disposeScheduler: vi.fn(),
    },
  };
}

describe('issue #2410 (Layer 1) – empty nextMessages stops the loop', () => {
  beforeEach(() => {
    mockedProcessFunctionCalls.mockClear();
    mockedProcessFunctionCalls.mockResolvedValue([]);
  });

  describe('dispatchNonInteractiveTurnResult returns [] from processFunctionCalls', () => {
    it('returns an empty Content[] (not null) when processFunctionCalls returns []', async () => {
      // This is the crux of the bug: the return is [] (truthy), not null.
      const functionCalls: FunctionCall[] = [
        { id: 'c1', name: 'restricted_tool', args: {} },
      ];
      const result = await dispatchNonInteractiveTurnResult(
        functionCalls,
        new AbortController(),
        'prompt-1',
        0,
        makeExecCtx(),
        makeCtx(),
      );

      // The result is [] — an empty but truthy array. The old `!nextMessages`
      // check would NOT catch this (because ![] === false).
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe('executeNonInteractiveRun stops on empty messages', () => {
    it('does NOT make a second provider call when the first turn yields no messages', async () => {
      // With an empty stream, functionCalls = []. dispatchNonInteractiveTurnResult
      // calls checkGoalCompletion (mocked → null). The loop should stop.
      let sendMessageCallCount = 0;

      const mockChat = {
        sendMessageStream: vi.fn(() => {
          sendMessageCallCount += 1;
          return {
            async *[Symbol.asyncIterator]() {
              // Empty stream — no events
            },
          };
        }),
      } as unknown as ChatSession;

      await executeNonInteractiveRun(
        mockChat,
        [] as FunctionDeclaration[],
        new AbortController(),
        [{ role: 'user', parts: [{ text: 'do the task' }] }],
        Date.now(),
        makeExecCtx(),
        makeCtx(),
        () => {},
      );

      // Exactly one provider call — loop stopped, did not retry with []
      expect(sendMessageCallCount).toBe(1);
    });
  });
});
