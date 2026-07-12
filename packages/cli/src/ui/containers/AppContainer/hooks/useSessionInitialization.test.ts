/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../../../test-utils/render.js';
import { useSessionInitialization } from './useSessionInitialization.js';
import type { IContent } from '@vybestack/llxprt-code-core';

// #2378: the hook drives SessionStart through the Agent's own hooks surface
// (agent.hooks.triggerSessionStart), so the raw core triggerSessionStartHook is
// no longer imported by the SUT and does not need to be mocked here.

const iContentToHistoryItemsMock = vi.hoisted(() =>
  vi.fn().mockReturnValue([]),
);
vi.mock('../../../utils/iContentToHistoryItems.js', () => ({
  iContentToHistoryItems: iContentToHistoryItemsMock,
}));

interface ConfigStub {
  hooks: Record<string, unknown>;
  memory: {
    getLlxprtMdFileCount: ReturnType<typeof vi.fn>;
    getCoreMemoryFileCount: ReturnType<typeof vi.fn>;
  };
  agentClientSource: {
    getAgentClient: ReturnType<typeof vi.fn>;
  };
}

const makeConfig = (
  llxprtMdFileCount = 0,
  coreMemoryFileCount = 0,
): ConfigStub => {
  const hooks = {};
  return {
    hooks,
    memory: {
      getLlxprtMdFileCount: vi.fn().mockReturnValue(llxprtMdFileCount),
      getCoreMemoryFileCount: vi.fn().mockReturnValue(coreMemoryFileCount),
    },
    agentClientSource: {
      getAgentClient: vi.fn().mockReturnValue(null),
    },
  };
};

interface SessionStartOutput {
  systemMessage?: string;
  additionalContext?: string;
}

// Build a fake Agent whose hooks.triggerSessionStart resolves to the given
// SessionStart output. The captured spy is returned alongside so tests can
// assert the hook was driven through the Agent surface (#2378) rather than the
// raw core trigger. Cast to `never` matches the stub convention already used
// for uiRuntime in this file.
const makeAgentWithSpy = (output: SessionStartOutput = {}) => {
  const triggerSessionStart = vi.fn().mockResolvedValue(output);
  return {
    agent: { hooks: { triggerSessionStart } } as never,
    triggerSessionStart,
  };
};

const makeAgent = (output: SessionStartOutput = {}) =>
  makeAgentWithSpy(output).agent;

describe('useSessionInitialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes memory file counts from config', async () => {
    const config = makeConfig(3, 5);
    const loadHistory = vi.fn();
    const addItem = vi.fn();

    const { result } = renderHook(() =>
      useSessionInitialization({
        uiRuntime: config as never,
        agent: makeAgent(),
        addItem,
        loadHistory,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.llxprtMdFileCount).toBe(3);
    expect(result.current.coreMemoryFileCount).toBe(5);
  });

  it('seeds resumed history via loadHistory when resumedHistory is provided', async () => {
    const config = makeConfig();
    const loadHistory = vi.fn();
    const addItem = vi.fn();
    const resumedHistory: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
    ];
    const fakeHistoryItems = [{ id: 1, type: 'user' as const, text: 'hello' }];

    iContentToHistoryItemsMock.mockReturnValue(fakeHistoryItems);

    renderHook(() =>
      useSessionInitialization({
        uiRuntime: config as never,
        agent: makeAgent(),
        addItem,
        loadHistory,
        resumedHistory,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(loadHistory).toHaveBeenCalledWith(fakeHistoryItems);
  });

  it('does not call loadHistory when resumedHistory is empty', async () => {
    const config = makeConfig();
    const loadHistory = vi.fn();
    const addItem = vi.fn();

    renderHook(() =>
      useSessionInitialization({
        uiRuntime: config as never,
        agent: makeAgent(),
        addItem,
        loadHistory,
        resumedHistory: [],
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(loadHistory).not.toHaveBeenCalled();
  });

  it('triggers session start hook on mount', async () => {
    const config = makeConfig();
    const loadHistory = vi.fn();
    const addItem = vi.fn();
    const { agent, triggerSessionStart } = makeAgentWithSpy();

    renderHook(() =>
      useSessionInitialization({
        uiRuntime: config as never,
        agent,
        addItem,
        loadHistory,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    // #2378: SessionStart is driven through the Agent's own hooks surface
    // exactly once (the idempotency guard ref prevents duplicate triggers),
    // NOT via the raw core triggerSessionStartHook.
    expect(triggerSessionStart).toHaveBeenCalledTimes(1);
    expect(triggerSessionStart).toHaveBeenCalledWith();
  });

  it('injects SessionStart output into history via the agent client', async () => {
    const config = makeConfig();
    const loadHistory = vi.fn();
    const addItem = vi.fn();
    const addHistory = vi.fn().mockResolvedValue(undefined);
    config.agentClientSource.getAgentClient.mockReturnValue({ addHistory });
    const { agent, triggerSessionStart } = makeAgentWithSpy({
      systemMessage: 'welcome message',
      additionalContext: 'extra context',
    });

    renderHook(() =>
      useSessionInitialization({
        uiRuntime: config as never,
        agent,
        addItem,
        loadHistory,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    // The Agent hook is the single source of SessionStart output; its
    // systemMessage is surfaced as an info item and its additionalContext is
    // injected into agent-client history.
    expect(triggerSessionStart).toHaveBeenCalledTimes(1);
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info', text: 'welcome message' }),
      expect.any(Number),
    );
    expect(addHistory).toHaveBeenCalledWith({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'extra context' }],
    });
  });

  it('aborts session initialization on unmount', async () => {
    const config = makeConfig();
    const loadHistory = vi.fn();
    const addItem = vi.fn();

    const { unmount } = renderHook(() =>
      useSessionInitialization({
        uiRuntime: config as never,
        agent: makeAgent(),
        addItem,
        loadHistory,
      }),
    );

    // Unmount should not throw and should abort cleanly
    unmount();

    // Give any pending promises time to settle
    await act(async () => {
      await Promise.resolve();
    });

    // The hook must not continue to load history after unmount; with no
    // resumedHistory supplied, loadHistory is never called anyway, and the
    // abort must not cause a spurious invocation either.
    expect(loadHistory).not.toHaveBeenCalled();
  });

  it('does not duplicate history seeding across renders', async () => {
    const config = makeConfig();
    const loadHistory = vi.fn();
    const addItem = vi.fn();
    const resumedHistory: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
    ];
    const fakeHistoryItems = [{ id: 1, type: 'user' as const, text: 'hi' }];

    iContentToHistoryItemsMock.mockReturnValue(fakeHistoryItems);

    const { rerender } = renderHook(() =>
      useSessionInitialization({
        uiRuntime: config as never,
        agent: makeAgent(),
        addItem,
        loadHistory,
        resumedHistory,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    rerender();

    await act(async () => {
      await Promise.resolve();
    });

    expect(loadHistory).toHaveBeenCalledTimes(1);
  });
});
