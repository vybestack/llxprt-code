/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { renderHook, cleanup } from '../../test-utils/render.js';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import { createInteractiveToolScheduler } from '../../runtime/interactiveToolScheduler.js';
import {
  ApprovalMode,
  type CompletedToolCall,
  type Config,
  DebugLogger,
  PolicyDecision,
  type SchedulerCallbacks as SchedulerCallbacksCore,
  type ToolCall,
  type ToolCallRequestInfo,
  type ToolRegistry,
  type ToolSchedulerContract,
} from '@vybestack/llxprt-code-core';

const mockToolRegistry = {
  getTool: vi.fn(),
  getAllToolNames: vi.fn(() => ['mockTool']),
};

const mockMessageBus = {
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  publish: vi.fn(),
};

type SchedulerCallbacks = SchedulerCallbacksCore & { config?: Config };

const createdSchedulers = new Map<string, ToolSchedulerContract>();

function buildMainScheduler(
  config: Config,
  callbacks: SchedulerCallbacks,
): ToolSchedulerContract {
  return {
    schedule: vi.fn(async (request, _signal) => {
      const requests = Array.isArray(request) ? request : [request];
      const completed = requests.map(
        (req) =>
          ({
            status: 'success' as const,
            request: req,
            response: {
              callId: req.callId,
              responseParts: [],
              resultDisplay: 'done',
              error: undefined,
              errorType: undefined,
              agentId: req.agentId ?? 'primary',
            },
          }) as unknown as CompletedToolCall,
      );
      callbacks.onToolCallsUpdate?.(completed);
      await callbacks.onAllToolCallsComplete?.(completed);
      callbacks.onToolCallsUpdate?.([]);
    }),
    cancelAll: vi.fn(),
    dispose: vi.fn(),
    setCallbacks: vi.fn(),
  } as unknown as ToolSchedulerContract;
}

const mockConfig = {
  getToolRegistry: vi.fn(() => mockToolRegistry as unknown as ToolRegistry),
  getApprovalMode: vi.fn(() => ApprovalMode.YOLO),
  getSessionId: () => 'test-session-id',
  getUsageStatisticsEnabled: () => true,
  getDebugMode: () => false,
  isInteractive: () => true,
  getAllowedTools: vi.fn(() => []),
  getContentGeneratorConfig: () => ({
    model: 'test-model',
  }),
  getMessageBus: () => mockMessageBus,
  getPolicyEngine: vi.fn(() => ({
    evaluate: vi.fn(() => PolicyDecision.ASK_USER),
  })),
  getOrCreateScheduler: vi.fn(
    (sessionId: string, callbacks: SchedulerCallbacks) => {
      const existing = createdSchedulers.get(sessionId);
      if (existing) {
        return Promise.resolve(existing);
      }
      const scheduler = buildMainScheduler(mockConfig, callbacks);
      createdSchedulers.set(sessionId, scheduler);
      return Promise.resolve(scheduler);
    },
  ),
  disposeScheduler: vi.fn((sessionId: string) => {
    createdSchedulers.delete(sessionId);
  }),
  setInteractiveSubagentSchedulerFactory: vi.fn(),
} as unknown as Config;

/**
 * SubagentSchedulerFactory is the type of the factory the hook registers via
 * config.setInteractiveSubagentSchedulerFactory. We capture it from the mock
 * to drive a subagent scheduler directly.
 */
type SubagentSchedulerFactory = (args: {
  schedulerConfig: {
    getSessionId: () => string;
    getOrCreateScheduler: (
      sessionId: string,
      callbacks: SchedulerCallbacksCore,
    ) => ToolSchedulerContract;
    disposeScheduler: (sessionId: string) => void;
  };
  onToolCallsUpdate?: (calls: ToolCall[]) => void;
  onAllToolCallsComplete?: (calls: CompletedToolCall[]) => void;
}) => Promise<{
  schedule: (
    req: ToolCallRequestInfo | ToolCallRequestInfo[],
    signal: AbortSignal,
  ) => Promise<void>;
  dispose: () => void;
}>;

describe('useReactToolScheduler subagent callback freshness', () => {
  let setPendingHistoryItem: Mock;

  beforeEach(() => {
    setPendingHistoryItem = vi.fn();
    mockToolRegistry.getTool.mockClear();
    (mockConfig.getApprovalMode as Mock).mockReturnValue(ApprovalMode.YOLO);
    (mockConfig.setInteractiveSubagentSchedulerFactory as Mock).mockClear();
    createdSchedulers.clear();
  });

  afterEach(() => {
    cleanup();
    for (const scheduler of createdSchedulers.values()) {
      scheduler.dispose();
    }
    createdSchedulers.clear();
    DebugLogger.disposeAll();
  });

  /**
   * Captures the subagent factory registered by the hook, creates a subagent
   * scheduler through it, and drives a tool call to completion so the
   * onComplete callback fires.
   */
  async function driveSubagentCompletion(factory: SubagentSchedulerFactory) {
    const subagentSessionId = 'subagent-session';

    // The factory calls schedulerConfig.getOrCreateScheduler(sessionId,
    // callbacks, ...) and uses the returned instance to schedule. Our mock
    // getOrCreateScheduler captures those callbacks and builds a scheduler
    // that immediately completes a call, invoking the factory's
    // onAllToolCallsComplete path (which calls hooks.onComplete).
    const subagentConfig = {
      getSessionId: () => subagentSessionId,
      getOrCreateScheduler: (
        _sessionId: string,
        callbacks: SchedulerCallbacksCore,
      ): ToolSchedulerContract =>
        ({
          schedule: async (
            req: ToolCallRequestInfo | ToolCallRequestInfo[],
          ) => {
            const requests = Array.isArray(req) ? req : [req];
            const completed = requests.map(
              (r) =>
                ({
                  status: 'success' as const,
                  request: r,
                  response: {
                    callId: r.callId,
                    responseParts: [],
                    resultDisplay: 'done',
                    error: undefined,
                    errorType: undefined,
                    agentId: r.agentId ?? 'primary',
                  },
                }) as unknown as CompletedToolCall,
            );
            callbacks.onToolCallsUpdate?.(completed);
            await callbacks.onAllToolCallsComplete?.(completed);
            callbacks.onToolCallsUpdate?.([]);
          },
          cancelAll: () => {},
          dispose: () => {},
          setCallbacks: () => {},
        }) as unknown as ToolSchedulerContract,
      disposeScheduler: vi.fn(),
    };

    const handle = await factory({
      schedulerConfig: subagentConfig,
      onToolCallsUpdate: () => {},
      onAllToolCallsComplete: () => {},
    });

    const request: ToolCallRequestInfo = {
      callId: 'sub-call-1',
      name: 'mockTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'sub-prompt',
      agentId: 'subagent-1',
    };

    await handle.schedule(request, new AbortController().signal);
    handle.dispose();
  }

  it('subagent completion calls the LATEST onComplete after a rerender changes the prop', async () => {
    const onComplete1 = vi.fn();
    const onComplete2 = vi.fn();

    // Construct the capability once so it stays stable across rerenders.
    const capability = createInteractiveToolScheduler(
      mockConfig as unknown as Config,
      undefined,
    );

    // Render with the first onComplete.
    const { result, rerender } = renderHook(
      ({ cb }: { cb: Mock }) =>
        useReactToolScheduler(
          cb,
          capability,
          setPendingHistoryItem,
          () => undefined,
          () => {},
        ),
      { initialProps: { cb: onComplete1 } },
    );

    // Wait for the capability to attach (factory registered).
    await vi.waitFor(
      () =>
        expect(
          mockConfig.setInteractiveSubagentSchedulerFactory as Mock,
        ).toHaveBeenCalledWith(expect.any(Function)),
      { interval: 10, timeout: 5000 },
    );
    // Index 5 of the ReactToolSchedulerResult tuple is the
    // `interactiveRuntimeReady` flag; wait until the capability has attached.
    await vi.waitFor(() => expect(result.current[5]).toBe(true), {
      interval: 10,
      timeout: 5000,
    });

    const factory = (mockConfig.setInteractiveSubagentSchedulerFactory as Mock)
      .mock.calls[0][0] as SubagentSchedulerFactory;

    // Rerender with a NEW onComplete — the subagent factory should see the
    // latest callback when a completion fires.
    rerender({ cb: onComplete2 });

    await driveSubagentCompletion(factory);

    // The stale closure (onComplete1) must NOT be called; the fresh
    // onComplete2 must be.
    expect(onComplete2).toHaveBeenCalledTimes(1);
    expect(onComplete1).not.toHaveBeenCalled();
  });
});
