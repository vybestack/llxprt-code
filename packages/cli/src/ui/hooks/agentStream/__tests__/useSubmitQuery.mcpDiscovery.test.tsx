/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #2516: "With MCP servers configured, ordinary
 * prompts and `!` shell passthrough silently disappear when MCP discovery is
 * not COMPLETED."
 *
 * Root cause (Phase 1 fix): a UI-level MCP-readiness guard dropped non-slash
 * input when discovery != COMPLETED. That guard has been intentionally REMOVED.
 * These tests lock in that the submit path flows unconditionally to
 * displayUserMessage / runSubmitQueryCore regardless of MCP discovery state.
 *
 * These tests exercise the real `useSubmitQuery` turn lifecycle. The stream
 * event handlers and turn preparation are mocked so the query can be observed
 * reaching `runStream` (via `runStreamRef`) without live provider networking.
 */

import { describe, it, expect, vi } from 'vitest';
import { act, type Dispatch, type SetStateAction } from 'react';
import { renderHook, waitFor } from '../../../../test-utils/render.js';
import { useSubmitQuery, type UseSubmitQueryDeps } from '../useSubmitQuery.js';
import { StreamingState, type HistoryItemWithoutId } from '../../../types.js';
import {
  type AgentClientContract,
  type RecordingIntegration,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { MCPDiscoveryState } from '@vybestack/llxprt-code-mcp';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';

// ─── Module mocks ───────────────────────────────────────────────────────────

// Stable spy for displayUserMessage so tests can assert the documented
// contract (the user message IS displayed). vi.hoisted keeps the same
// reference across the module mock factory and the test body.
const displayUserMessageMock = vi.hoisted(() => vi.fn());

vi.mock('../useStreamEventHandlers.js', () => ({
  useStreamEventHandlers: () => ({
    processStreamEvent: vi.fn(),
    displayUserMessage: displayUserMessageMock,
    prepareQueryForAgent: vi
      .fn()
      .mockResolvedValue({ queryToSend: 'test-query', shouldProceed: true }),
    handleLoopDetectedEvent: vi.fn(),
  }),
}));

vi.mock('../../../contexts/SessionContext.js', () => ({
  useSessionStats: () => ({
    startNewPrompt: vi.fn(),
    getPromptCount: () => 0,
  }),
}));

vi.mock('../turnPreparation.js', () => ({
  prepareTurnForQuery: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../streamUtils.js', () => ({
  handleSubmissionError: vi.fn(),
  processSlashCommandResult: vi.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createMockAgentClient(): AgentClientContract {
  return {
    getCurrentSequenceModel: () => 'test-model',
    getChat: () =>
      ({
        recordCompletedToolCalls: vi.fn(),
      }) as never,
  } as unknown as AgentClientContract;
}

function createMockSetState(
  calls: boolean[],
): Dispatch<SetStateAction<boolean>> {
  return vi.fn((value: SetStateAction<boolean>) => {
    if (typeof value === 'boolean') calls.push(value);
  }) as unknown as Dispatch<SetStateAction<boolean>>;
}

interface McpDiscoveryDeps {
  setIsRespondingCalls: boolean[];
  setIsResponding: Dispatch<SetStateAction<boolean>>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  runStreamRef: React.MutableRefObject<
    | ((
        message: unknown,
        signal: AbortSignal,
        promptId: string,
      ) => Promise<void>)
    | null
  >;
  loopDetectedRef: React.MutableRefObject<boolean>;
  onAuthError: ReturnType<typeof vi.fn>;
  addItem: ReturnType<typeof vi.fn>;
}

function createDeps(options?: Partial<McpDiscoveryDeps>): McpDiscoveryDeps {
  const setIsRespondingCalls: boolean[] = [];
  return {
    setIsRespondingCalls,
    setIsResponding:
      options?.setIsResponding ?? createMockSetState(setIsRespondingCalls),
    abortControllerRef:
      options?.abortControllerRef ??
      ({ current: null as AbortController | null } as never),
    runStreamRef: options?.runStreamRef ?? ({ current: null } as never),
    loopDetectedRef: options?.loopDetectedRef ?? ({ current: false } as never),
    onAuthError: options?.onAuthError ?? vi.fn(),
    addItem: options?.addItem ?? vi.fn().mockReturnValue(1),
  };
}

function renderUseSubmitQuery(
  deps: McpDiscoveryDeps,
  mcpOverrides?: Parameters<typeof createStreamRuntimeForTest>[1],
) {
  const hookDeps: UseSubmitQueryDeps = {
    runtime: createStreamRuntimeForTest({}, mcpOverrides),
    agent: createMockAgentClient() as unknown as Agent,
    addItem: deps.addItem,
    settings: {} as never,
    onDebugMessage: vi.fn(),
    onCancelSubmit: vi.fn(),
    onAuthError: deps.onAuthError,
    sanitizeContent: (text: string) => ({ text, blocked: false }),
    flushPendingHistoryItem: vi.fn(),
    pendingHistoryItemRef: {
      current: null,
    } as React.MutableRefObject<HistoryItemWithoutId | null>,
    thinkingBlocksRef: { current: [] },
    turnCancelledRef: { current: false },
    queuedSubmissionsRef: { current: [] },
    setPendingHistoryItem: vi.fn(),
    setIsResponding: deps.setIsResponding,
    setInitError: vi.fn(),
    setThought: vi.fn(),
    setLastAgentActivityTime: vi.fn(),
    scheduleToolCalls: vi.fn(),
    abortActiveStream: vi.fn(),
    handleShellCommand: vi.fn().mockReturnValue(false),
    handleSlashCommand: vi.fn().mockResolvedValue(false),
    logger: null,
    shellModeActive: false,
    loopDetectedRef: deps.loopDetectedRef,
    lastProfileNameRef: { current: undefined },
    lastModelInfoRef: { current: null },
    lastModelIdentityRef: { current: null },
    abortControllerRef: deps.abortControllerRef,
    runStreamRef: deps.runStreamRef,
    submitQueryRef: { current: null },
    isResponding: false,
    streamingState: StreamingState.Idle,
    recordingIntegration: {
      flushAtTurnBoundary: vi.fn(),
    } as unknown as RecordingIntegration,
  };
  return renderHook(() => useSubmitQuery(hookDeps));
}

/**
 * Creates an MCP runtime override where the manager reports non-COMPLETED
 * discovery and at least one configured server — the exact scenario that
 * triggered issue #2516. Defaults to IN_PROGRESS; pass a state to exercise
 * other non-COMPLETED values (e.g. NOT_STARTED).
 */
function createBlockingMcpOverrides(
  state: MCPDiscoveryState = MCPDiscoveryState.IN_PROGRESS,
) {
  return {
    mcp: {
      getMcpServers: () => ({ server1: { command: 'test-cmd' } }),
      getMcpClientManager: () => ({
        getDiscoveryState: () => state,
        getMcpServerCount: () => 1,
        restartServer: async () => undefined,
      }),
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useSubmitQuery — MCP discovery no longer drops input (issue #2516)', () => {
  it('does NOT drop an ordinary prompt submitted while MCP discovery is IN_PROGRESS', async () => {
    displayUserMessageMock.mockClear();
    const runDeferred = createDeferred<void>();
    const runStreamMock = vi.fn().mockReturnValueOnce(runDeferred.promise);
    const deps = createDeps({
      runStreamRef: { current: runStreamMock } as never,
    });

    const { result } = renderUseSubmitQuery(deps, createBlockingMcpOverrides());

    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery('hello world');
    });

    // The user message must be displayed (the documented contract) — the old
    // MCP gate returned before displayUserMessage ran.
    expect(displayUserMessageMock).toHaveBeenCalled();

    // The query must reach runStream — it was NOT dropped by an MCP gate.
    expect(runStreamMock).toHaveBeenCalledTimes(1);

    // isResponding must transition to true (the turn started).
    await waitFor(() =>
      expect(deps.setIsRespondingCalls).toStrictEqual([true]),
    );

    // Clean up: resolve the deferred so the turn completes.
    await act(async () => {
      runDeferred.resolve();
    });

    await act(async () => {
      await turnPromise;
    });
  });

  it('does NOT add a "Waiting for MCP servers" info message during discovery', async () => {
    const runDeferred = createDeferred<void>();
    const runStreamMock = vi.fn().mockReturnValueOnce(runDeferred.promise);
    const addItem = vi.fn().mockReturnValue(1);
    const deps = createDeps({
      runStreamRef: { current: runStreamMock } as never,
      addItem,
    });

    const { result } = renderUseSubmitQuery(deps, createBlockingMcpOverrides());

    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery('hello world');
    });

    // The OLD behavior added a MessageType.INFO "Waiting for MCP servers" item.
    // That branch was removed — addItem must NEVER be called with a "Waiting"
    // info text.
    for (const call of addItem.mock.calls) {
      const item = call[0] as { type?: string; text?: string };
      expect(item.text).not.toMatch(/Waiting for MCP servers/i);
    }

    await act(async () => {
      runDeferred.resolve();
    });

    await act(async () => {
      await turnPromise;
    });
  });

  it('does NOT drop a `!` shell-passthrough submission during discovery', async () => {
    const runDeferred = createDeferred<void>();
    const runStreamMock = vi.fn().mockReturnValueOnce(runDeferred.promise);
    const deps = createDeps({
      runStreamRef: { current: runStreamMock } as never,
    });

    const { result } = renderUseSubmitQuery(deps, createBlockingMcpOverrides());

    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery('!ls -la');
    });

    // The `!` passthrough must reach runStream — not dropped by MCP gate.
    expect(runStreamMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      runDeferred.resolve();
    });

    await act(async () => {
      await turnPromise;
    });
  });

  it('processes every accepted input regardless of discovery state', async () => {
    const runDeferred1 = createDeferred<void>();
    const runDeferred2 = createDeferred<void>();
    const runStreamMock = vi
      .fn()
      .mockReturnValueOnce(runDeferred1.promise)
      .mockReturnValueOnce(runDeferred2.promise);
    const deps = createDeps({
      runStreamRef: { current: runStreamMock } as never,
    });

    const { result } = renderUseSubmitQuery(deps, createBlockingMcpOverrides());

    let turn1!: Promise<void>;
    let turn2!: Promise<void>;
    await act(async () => {
      turn1 = result.current.submitQuery('first query');
    });
    await act(async () => {
      runDeferred1.resolve();
    });
    await act(async () => {
      await turn1;
    });

    await act(async () => {
      turn2 = result.current.submitQuery('second query');
    });
    await act(async () => {
      runDeferred2.resolve();
    });
    await act(async () => {
      await turn2;
    });

    // Both queries must have been processed — no input silently disappeared.
    expect(runStreamMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT drop an ordinary prompt when discovery is NOT_STARTED (the other non-COMPLETED state named in #2516)', async () => {
    displayUserMessageMock.mockClear();
    const runDeferred = createDeferred<void>();
    const runStreamMock = vi.fn().mockReturnValueOnce(runDeferred.promise);
    const deps = createDeps({
      runStreamRef: { current: runStreamMock } as never,
    });

    const { result } = renderUseSubmitQuery(
      deps,
      createBlockingMcpOverrides(MCPDiscoveryState.NOT_STARTED),
    );

    let turnPromise!: Promise<void>;
    await act(async () => {
      turnPromise = result.current.submitQuery('hello before discovery');
    });

    expect(displayUserMessageMock).toHaveBeenCalled();
    expect(runStreamMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      runDeferred.resolve();
    });
    await act(async () => {
      await turnPromise;
    });
  });
});
