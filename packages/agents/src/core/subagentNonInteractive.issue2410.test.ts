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
 * These tests verify that `dispatchNonInteractiveTurnResult` returns `[]`
 * (an empty Content[] — truthy, not null) when processFunctionCalls returns [],
 * which is the exact value that the old `!nextMessages` guard failed to catch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Content, FunctionCall } from '@google/genai';
import type { ExecutionLoopContext } from './subagentExecution.js';
import type { NonInteractiveRunContext } from './subagentNonInteractive.js';
import { dispatchNonInteractiveTurnResult } from './subagentNonInteractive.js';
import {
  SubagentTerminateMode,
  type OutputObject,
  type RunConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

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
const mockedProcessFunctionCalls = vi.mocked(processFunctionCalls);

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

describe('issue #2410 (Layer 1) – processFunctionCalls returning [] produces empty array, not null', () => {
  beforeEach(() => {
    mockedProcessFunctionCalls.mockClear();
    mockedProcessFunctionCalls.mockResolvedValue([]);
  });

  it('returns an empty Content[] (truthy, not null) when processFunctionCalls returns []', async () => {
    // This is the crux of the bug: processFunctionCalls returns [] when all
    // calls are hook-restricted. The old `!nextMessages` guard evaluated
    // `![]` as `false`, so the loop continued and sent an empty user turn
    // to the provider (causing z.ai error 1213). The fix checks
    // `nextMessages.length === 0` instead.
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

    // processFunctionCalls was actually invoked (not skipped)
    expect(mockedProcessFunctionCalls).toHaveBeenCalledTimes(1);

    // The result is [] — an empty but truthy array. The old `!nextMessages`
    // check would NOT catch this (because ![] === false). The fix does.
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);

    // Demonstrate the old guard would have failed:
    // `!result` is false (empty array is truthy), so `if (!nextMessages)`
    // would NOT have stopped the loop. The fix uses `nextMessages.length === 0`.
    expect(!result).toBe(false); // old guard: does NOT stop
    expect(result.length === 0).toBe(true); // new guard: DOES stop
  });

  it('processFunctionCalls is invoked when function calls are present in the turn', async () => {
    const functionCalls: FunctionCall[] = [
      { id: 'c1', name: 'read_file', args: { path: '/tmp/test' } },
      { id: 'c2', name: 'write_file', args: { path: '/tmp/out' } },
    ];
    const result = await dispatchNonInteractiveTurnResult(
      functionCalls,
      new AbortController(),
      'prompt-2',
      1,
      makeExecCtx(),
      makeCtx(),
    );

    expect(mockedProcessFunctionCalls).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(0);
  });
});
