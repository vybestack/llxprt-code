/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #2516: "MCP discovery state silently disables
 * prompts and shell passthrough".
 *
 * Acceptance criteria covered here (from the ticket's "Expected behavior"):
 * - Ordinary prompts must remain usable regardless of whether an MCP server is
 *   starting, slow, failed, or permanently unavailable.
 * - User submissions must never be silently discarded.
 * - `!` shell passthrough must not be affected by MCP discovery state.
 *
 * Before the fix, `useSubmitQueryCallback` ran an `isMcpDiscoveryBlocking`
 * early-return BEFORE `displayUserMessage`/`runSubmitQueryCore`, so any
 * non-slash input was dropped (never displayed, never queued) whenever
 * aggregate MCP discovery was not COMPLETED and servers were configured. These
 * tests exercise the real `useSubmitQuery` turn lifecycle with a stubbed agent
 * stream runner, proving that accepted input is always displayed and routed
 * regardless of MCP discovery state.
 */

import { describe, it, expect, vi } from 'vitest';
import { act, type Dispatch, type SetStateAction } from 'react';
import { renderHook, waitFor } from '../../../../test-utils/render.js';
import { useSubmitQuery, type UseSubmitQueryDeps } from '../useSubmitQuery.js';
import { StreamingState, type HistoryItemWithoutId } from '../../../types.js';
import {
  type AgentClientContract,
  type RecordingIntegration,
  type MCPServerConfig,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { MCPDiscoveryState } from '@vybestack/llxprt-code-mcp';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';

// ─── Module mocks ───────────────────────────────────────────────────────────

// Capture the displayUserMessage/prepareQueryForAgent the hook wires up so we
// can assert real behavior (was the prompt displayed + routed) without mocking
// the unit under test.
const displayUserMessageMock = vi.hoisted(() => vi.fn());
const prepareQueryForAgentMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ queryToSend: 'test-query', shouldProceed: true }),
);

vi.mock('../useStreamEventHandlers.js', () => ({
  useStreamEventHandlers: () => ({
    processStreamEvent: vi.fn(),
    displayUserMessage: displayUserMessageMock,
    prepareQueryForAgent: prepareQueryForAgentMock,
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
  // Functional-update-aware: if the production hook switches to
  // `setIsResponding(prev => !prev)`, invoke the updater against the last
  // recorded state so the test still reflects real transitions.
  return vi.fn((value: SetStateAction<boolean>) => {
    const next =
      typeof value === 'function'
        ? (value as (prev: boolean) => boolean)(
            calls[calls.length - 1] ?? false,
          )
        : value;
    calls.push(next);
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
  runStream: ReturnType<typeof vi.fn>;
  addItem: ReturnType<typeof vi.fn>;
  onAuthError: ReturnType<typeof vi.fn>;
}

function createDeps(
  options?: Partial<Omit<McpDiscoveryDeps, 'runStream'>>,
): McpDiscoveryDeps {
  const setIsRespondingCalls: boolean[] = [];
  const runStream = vi.fn().mockResolvedValue(undefined);
  return {
    setIsRespondingCalls,
    setIsResponding:
      options?.setIsResponding ?? createMockSetState(setIsRespondingCalls),
    abortControllerRef:
      options?.abortControllerRef ??
      ({ current: null as AbortController | null } as never),
    runStreamRef: options?.runStreamRef ?? ({ current: runStream } as never),
    runStream,
    loopDetectedRef: { current: false } as never,
    onAuthError: options?.onAuthError ?? vi.fn(),
    addItem: options?.addItem ?? vi.fn().mockReturnValue(1),
  } as McpDiscoveryDeps;
}

const CONFIGURED_MCP_SERVERS: Record<string, MCPServerConfig> = {
  playwright: {},
};

function renderUseSubmitQuery(
  deps: McpDiscoveryDeps,
  mcpOverrides: {
    discoveryState?: MCPDiscoveryState;
    mcpServers?: Record<string, MCPServerConfig>;
  },
) {
  const hookDeps: UseSubmitQueryDeps = {
    runtime: createStreamRuntimeForTest(
      {},
      {
        mcp: {
          getMcpServers: () =>
            mcpOverrides.mcpServers ?? CONFIGURED_MCP_SERVERS,
          getMcpClientManager: () => ({
            getDiscoveryState: () =>
              mcpOverrides.discoveryState ?? MCPDiscoveryState.IN_PROGRESS,
            getMcpServerCount: () =>
              Object.keys(mcpOverrides.mcpServers ?? CONFIGURED_MCP_SERVERS)
                .length,
            restartServer: async () => undefined,
          }),
        },
      },
    ),
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
    loopDetectedRef: { current: false },
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useSubmitQuery — MCP discovery must not drop input (issue #2516)', () => {
  it('displays and routes an ordinary prompt while discovery is IN_PROGRESS', async () => {
    displayUserMessageMock.mockClear();
    const deps = createDeps();
    const { result } = renderUseSubmitQuery(deps, {
      discoveryState: MCPDiscoveryState.IN_PROGRESS,
    });

    await act(async () => {
      await result.current.submitQuery('hello world');
    });

    await waitFor(() => expect(deps.runStream).toHaveBeenCalledTimes(1));
    expect(displayUserMessageMock).toHaveBeenCalledWith(
      'hello world',
      expect.any(Number),
    );
    // Assert the exact payload forwarded to the stream runner so a future
    // query-transformation bug (empty string, over-trimming, swapped args)
    // can't slip through a call-count-only check.
    expect(deps.runStream).toHaveBeenCalledWith(
      'test-query',
      expect.any(AbortSignal),
      expect.any(String),
    );
  });

  it('displays and routes an ordinary prompt while discovery is NOT_STARTED', async () => {
    displayUserMessageMock.mockClear();
    const deps = createDeps();
    const { result } = renderUseSubmitQuery(deps, {
      discoveryState: MCPDiscoveryState.NOT_STARTED,
    });

    await act(async () => {
      await result.current.submitQuery('hello world');
    });

    await waitFor(() => expect(deps.runStream).toHaveBeenCalledTimes(1));
    expect(displayUserMessageMock).toHaveBeenCalledWith(
      'hello world',
      expect.any(Number),
    );
  });

  it('does not drop `!` shell-passthrough during discovery', async () => {
    displayUserMessageMock.mockClear();
    const deps = createDeps();
    const { result } = renderUseSubmitQuery(deps, {
      discoveryState: MCPDiscoveryState.IN_PROGRESS,
    });

    await act(async () => {
      await result.current.submitQuery('!ls -la');
    });

    // Shell passthrough is decided downstream in queryPreparer; the key
    // issue-#2516 guarantee is that the input is NOT dropped before reaching
    // runSubmitQueryCore (the agent stream runner).
    await waitFor(() => expect(deps.runStream).toHaveBeenCalledTimes(1));
    expect(displayUserMessageMock).toHaveBeenCalledWith(
      '!ls -la',
      expect.any(Number),
    );
  });

  it('still displays and routes prompts once discovery is COMPLETED (regression)', async () => {
    displayUserMessageMock.mockClear();
    const deps = createDeps();
    const { result } = renderUseSubmitQuery(deps, {
      discoveryState: MCPDiscoveryState.COMPLETED,
    });

    await act(async () => {
      await result.current.submitQuery('hello world');
    });

    await waitFor(() => expect(deps.runStream).toHaveBeenCalledTimes(1));
    expect(displayUserMessageMock).toHaveBeenCalledWith(
      'hello world',
      expect.any(Number),
    );
  });

  it('does not display an empty/whitespace submission (existing behavior preserved)', async () => {
    displayUserMessageMock.mockClear();
    const deps = createDeps();
    const { result } = renderUseSubmitQuery(deps, {
      discoveryState: MCPDiscoveryState.IN_PROGRESS,
    });

    await act(async () => {
      await result.current.submitQuery('   ');
    });

    expect(displayUserMessageMock).not.toHaveBeenCalled();
  });

  it('preserves every accepted input across sequential submissions during discovery', async () => {
    displayUserMessageMock.mockClear();
    const deps = createDeps();
    const { result } = renderUseSubmitQuery(deps, {
      discoveryState: MCPDiscoveryState.IN_PROGRESS,
    });

    await act(async () => {
      await result.current.submitQuery('first prompt');
    });
    await waitFor(() => expect(deps.runStream).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.submitQuery('second prompt');
    });
    await waitFor(() => expect(deps.runStream).toHaveBeenCalledTimes(2));

    const displayedTexts = displayUserMessageMock.mock.calls.map(
      (call) => call[0] as string,
    );
    expect(displayedTexts).toStrictEqual(['first prompt', 'second prompt']);
  });
});
