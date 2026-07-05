/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  DEFAULT_AGENT_ID,
  type Config,
  type ToolCallRequestInfo,
  type ToolSchedulerContract,
  type CompletedToolCall,
} from '@vybestack/llxprt-code-core';
import {
  createInteractiveToolScheduler,
  type MainSchedulerDisplayHooks,
  type SubagentDisplayHooks,
} from '../interactiveToolScheduler.js';

/**
 * Builds a minimal mock scheduler that records schedule calls.
 */
function buildMockScheduler(): ToolSchedulerContract & {
  scheduleMock: Mock;
  cancelAllMock: Mock;
} {
  const scheduleMock = vi.fn(
    async (_request: ToolCallRequestInfo | ToolCallRequestInfo[]) => {},
  );
  const cancelAllMock = vi.fn();
  const scheduler = {
    schedule: scheduleMock as unknown as ToolSchedulerContract['schedule'],
    cancelAll: cancelAllMock,
    dispose: vi.fn(),
    setCallbacks: vi.fn(),
    handleConfirmationResponse: vi.fn(),
    scheduleMock,
    cancelAllMock,
  };
  return scheduler as unknown as ToolSchedulerContract & {
    scheduleMock: Mock;
    cancelAllMock: Mock;
  };
}

function buildMainHooks(
  overrides: Partial<MainSchedulerDisplayHooks> = {},
): MainSchedulerDisplayHooks {
  return {
    outputUpdateHandler: vi.fn(),
    onAllToolCallsComplete: vi.fn(),
    onToolCallsUpdate: vi.fn(),
    getPreferredEditor: () => undefined,
    onEditorClose: vi.fn(),
    onEditorOpen: vi.fn(),
    setLastToolOutputTime: vi.fn(),
    isMounted: () => true,
    ...overrides,
  };
}

function buildSubagentHooks(
  overrides: Partial<SubagentDisplayHooks> = {},
): SubagentDisplayHooks {
  return {
    updateToolCallOutput: vi.fn(),
    replaceToolCalls: vi.fn(),
    onComplete: vi.fn(),
    getPreferredEditor: () => undefined,
    onEditorClose: vi.fn(),
    onEditorOpen: vi.fn(),
    setLastToolOutputTime: vi.fn(),
    ...overrides,
  };
}

function buildMockConfig(
  scheduler: ToolSchedulerContract,
  options: {
    sessionId?: string;
    hasSubagentFactory?: boolean;
  } = {},
): Config & {
  setFactoryCalls: unknown[];
  getOrCreateSchedulerMock: Mock;
  disposeSchedulerMock: Mock;
} {
  const sessionId = options.sessionId ?? 'test-session';
  const setFactoryCalls: unknown[] = [];
  const getOrCreateSchedulerMock = vi.fn(async () => scheduler);
  const disposeSchedulerMock = vi.fn();
  const hasFactory = options.hasSubagentFactory === true;
  const config = {
    getSessionId: () => sessionId,
    getOrCreateScheduler: getOrCreateSchedulerMock,
    disposeScheduler: disposeSchedulerMock,
    setInteractiveSubagentSchedulerFactory: hasFactory
      ? (factory: unknown) => {
          setFactoryCalls.push(factory);
        }
      : undefined,
    isInteractive: () => true,
  } as unknown as Config & {
    setFactoryCalls: unknown[];
    getOrCreateSchedulerMock: Mock;
    disposeSchedulerMock: Mock;
  };
  Object.defineProperty(config, 'setFactoryCalls', {
    value: setFactoryCalls,
    writable: true,
  });
  Object.defineProperty(config, 'getOrCreateSchedulerMock', {
    value: getOrCreateSchedulerMock,
    writable: true,
  });
  Object.defineProperty(config, 'disposeSchedulerMock', {
    value: disposeSchedulerMock,
    writable: true,
  });
  return config;
}

function buildRequest(
  overrides: Partial<ToolCallRequestInfo> = {},
): ToolCallRequestInfo {
  return {
    callId: overrides.callId ?? 'call-1',
    name: overrides.name ?? 'testTool',
    args: overrides.args ?? {},
    isClientInitiated: overrides.isClientInitiated ?? false,
    prompt_id: overrides.prompt_id ?? 'prompt-1',
    agentId: overrides.agentId,
  };
}

describe('createInteractiveToolScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queues pending schedule requests and flushes them after attach completes', async () => {
    const scheduler = buildMockScheduler();
    const config = buildMockConfig(scheduler);
    const capability = createInteractiveToolScheduler(config, undefined);

    // Schedule BEFORE attach — should queue, not call the scheduler.
    const req1 = buildRequest({ callId: 'pending-1' });
    const signal1 = new AbortController().signal;
    await capability.schedule(req1, signal1);
    expect(scheduler.scheduleMock).not.toHaveBeenCalled();

    // Attach — flush should occur.
    const mainHooks = buildMainHooks();
    const subagentHooks = buildSubagentHooks();
    const detach = await capability.attach(mainHooks, subagentHooks);

    // The pending request should now have been flushed to the scheduler.
    expect(scheduler.scheduleMock).toHaveBeenCalledTimes(1);
    const flushArg = scheduler.scheduleMock.mock.calls[0][0];
    const flushRequests = Array.isArray(flushArg) ? flushArg : [flushArg];
    expect(flushRequests).toContainEqual(
      expect.objectContaining({
        callId: 'pending-1',
        agentId: DEFAULT_AGENT_ID,
      }),
    );

    detach();
  });

  it('normalizes agentId to DEFAULT_AGENT_ID when scheduling', async () => {
    const scheduler = buildMockScheduler();
    const config = buildMockConfig(scheduler);
    const capability = createInteractiveToolScheduler(config, undefined);

    const detach = await capability.attach(
      buildMainHooks(),
      buildSubagentHooks(),
    );

    const requestWithoutAgent = buildRequest({ callId: 'no-agent' });
    await capability.schedule(
      requestWithoutAgent,
      new AbortController().signal,
    );

    const normArg = scheduler.scheduleMock.mock.calls[0][0];
    const normRequests = Array.isArray(normArg) ? normArg : [normArg];
    expect(normRequests[0].agentId).toBe(DEFAULT_AGENT_ID);

    detach();
  });

  it('de-registers the subagent factory on detach when the host supports it', async () => {
    const scheduler = buildMockScheduler();
    const config = buildMockConfig(scheduler, {
      hasSubagentFactory: true,
    });
    const capability = createInteractiveToolScheduler(config, undefined);

    const mainHooks = buildMainHooks();
    const subagentHooks = buildSubagentHooks();
    const detach = await capability.attach(mainHooks, subagentHooks);

    // Factory should have been registered (non-undefined).
    expect(config.setFactoryCalls.length).toBe(1);
    expect(config.setFactoryCalls[0]).toBeDefined();

    detach();

    // After detach, factory should have been de-registered (undefined passed).
    expect(config.setFactoryCalls.length).toBe(2);
    expect(config.setFactoryCalls[1]).toBeUndefined();

    // Scheduler should have been disposed.
    expect(config.disposeSchedulerMock).toHaveBeenCalledWith(
      config.getSessionId(),
    );
  });

  it('marks isReady false before attach and true after', async () => {
    const scheduler = buildMockScheduler();
    const config = buildMockConfig(scheduler);
    const capability = createInteractiveToolScheduler(config, undefined);

    expect(capability.isReady()).toBe(false);

    const detach = await capability.attach(
      buildMainHooks(),
      buildSubagentHooks(),
    );

    expect(capability.isReady()).toBe(true);

    detach();

    expect(capability.isReady()).toBe(false);
  });

  it('cancelAll delegates to the scheduler after attach', async () => {
    const scheduler = buildMockScheduler();
    const config = buildMockConfig(scheduler);
    const capability = createInteractiveToolScheduler(config, undefined);

    // Before attach, cancelAll should be a no-op (no throw).
    expect(() => capability.cancelAll()).not.toThrow();

    const detach = await capability.attach(
      buildMainHooks(),
      buildSubagentHooks(),
    );

    capability.cancelAll();
    expect(scheduler.cancelAllMock).toHaveBeenCalledTimes(1);

    detach();
  });

  it('does not double-dispose when detach is called twice', async () => {
    const scheduler = buildMockScheduler();
    const config = buildMockConfig(scheduler);
    const capability = createInteractiveToolScheduler(config, undefined);

    const detach = await capability.attach(
      buildMainHooks(),
      buildSubagentHooks(),
    );

    detach();
    detach(); // Should be idempotent.

    expect(config.disposeSchedulerMock).toHaveBeenCalledTimes(1);
  });

  it('flushes pending requests in arrival order', async () => {
    const scheduler = buildMockScheduler();
    const config = buildMockConfig(scheduler);
    const capability = createInteractiveToolScheduler(config, undefined);

    const req1 = buildRequest({ callId: 'first' });
    const req2 = buildRequest({ callId: 'second' });
    const req3 = buildRequest({ callId: 'third' });

    await capability.schedule(req1, new AbortController().signal);
    await capability.schedule(req2, new AbortController().signal);
    await capability.schedule(req3, new AbortController().signal);

    const detach = await capability.attach(
      buildMainHooks(),
      buildSubagentHooks(),
    );

    expect(scheduler.scheduleMock).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) {
      const callArg = scheduler.scheduleMock.mock.calls[i][0];
      const reqs = Array.isArray(callArg) ? callArg : [callArg];
      const expected = ['first', 'second', 'third'][i];
      expect(reqs[0].callId).toBe(expected);
    }

    detach();
  });

  it('skips aborted pending requests during flush', async () => {
    const scheduler = buildMockScheduler();
    const config = buildMockConfig(scheduler);
    const capability = createInteractiveToolScheduler(config, undefined);

    const abortedController = new AbortController();
    abortedController.abort();
    const validReq = buildRequest({ callId: 'valid' });

    await capability.schedule(
      buildRequest({ callId: 'aborted' }),
      abortedController.signal,
    );
    await capability.schedule(validReq, new AbortController().signal);

    const detach = await capability.attach(
      buildMainHooks(),
      buildSubagentHooks(),
    );

    // Only the non-aborted request should reach the scheduler.
    expect(scheduler.scheduleMock).toHaveBeenCalledTimes(1);
    const validArg = scheduler.scheduleMock.mock.calls[0][0];
    const validReqs = Array.isArray(validArg) ? validArg : [validArg];
    expect(validReqs[0].callId).toBe('valid');

    detach();
  });

  it('routes main scheduler onAllToolCallsComplete through display hooks', async () => {
    const scheduler = buildMockScheduler();
    const config = buildMockConfig(scheduler);
    const capability = createInteractiveToolScheduler(config, undefined);

    const onAllToolCallsComplete = vi.fn();
    const mainHooks = buildMainHooks({ onAllToolCallsComplete });
    const detach = await capability.attach(mainHooks, buildSubagentHooks());

    // Extract the callbacks that were passed to getOrCreateScheduler.
    const createCall = config.getOrCreateSchedulerMock.mock.calls[0];
    const passedCallbacks = createCall[1] as {
      onAllToolCallsComplete: (calls: CompletedToolCall[]) => Promise<void>;
    };

    const completedCalls = [
      { status: 'success' },
    ] as unknown as CompletedToolCall[];
    await passedCallbacks.onAllToolCallsComplete(completedCalls);

    expect(onAllToolCallsComplete).toHaveBeenCalledWith(completedCalls);

    detach();
  });
});
