/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { act } from 'react';
import { renderHook } from '../../../../__tests__/render.js';
import { useStreamEventHandlers } from '../useStreamEventHandlers.js';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';
import {
  createLoadedSettings,
  createMockOverrides,
} from './submitQueryTestFixtures.js';
import { createFakeAgentFromMockClient } from '../../__tests__/useAgentStream-test-helpers.js';
import type { HistoryItemWithoutId } from '../../../types.js';
import type { ThoughtSummary } from '@vybestack/llxprt-code-core';
import { describe, it, expect } from 'bun:test';
import { waitFor } from '../../../../__tests__/async.js';
import {
  withJournalResponse,
  sealText,
  renderedOrder,
} from './journal-response-test-helpers.js';

describe('journal discard-and-restart (issue #3048)', () => {
  it('renders only the successful attempt and retracts abandoned paragraph prefixes', async () => {
    await withJournalResponse(async (fixture) => {
      await sealText(fixture, 'previous', ['earlier reply']);
      const arrival = await fixture.open('abandoned');
      await arrival.append({ type: 'text', text: 'para one\n\npara two' });
      await waitFor(async () => {
        expect(renderedOrder(await fixture.items())).toContain(
          'text:para one\n\npara two',
        );
      });
      await arrival.interrupt('superseded');
      await sealText(fixture, 'replacement', ['kept']);
      expect(renderedOrder(await fixture.items())).toStrictEqual([
        'text:earlier reply',
        'text:kept',
      ]);
    });
  });

  it('clears abandoned thinking without retracting a completed earlier turn', async () => {
    await withJournalResponse(async (fixture) => {
      await sealText(fixture, 'completed', ['completed turn']);
      const arrival = await fixture.open('thinking-retry');
      await arrival.append({
        type: 'thinking',
        thought: 'reasoning about the answer',
      });
      await waitFor(async () => {
        expect(renderedOrder(await fixture.items())).toContain(
          'thinking:reasoning about the answer',
        );
      });
      await arrival.interrupt('superseded');
      await arrival.interrupt('superseded');
      expect(renderedOrder(await fixture.items())).toStrictEqual([
        'text:completed turn',
      ]);
    });
  });

  it('preserves earlier user messages and unrelated pending tool controls', async () => {
    await withJournalResponse(async (fixture) => {
      fixture.history.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'earlier user' }],
      });
      const arrival = await fixture.open('retry');
      await arrival.append({ type: 'text', text: 'abandoned partial' });
      await arrival.interrupt('superseded');
      expect(
        (await fixture.items()).map((item) => [item.type, item.text]),
      ).toStrictEqual([['user', 'earlier user']]);
      await sealText(fixture, 'next', ['x']);
      expect(renderedOrder(await fixture.items())).toStrictEqual(['text:x']);
    });
  });
});

function retryControls(pending: HistoryItemWithoutId | null) {
  const state: {
    pending: HistoryItemWithoutId | null;
    thought: ThoughtSummary | null;
    responding: boolean;
    queue: string[];
  } = {
    pending,
    thought: { subject: 'reasoning', description: 'answer' },
    responding: true,
    queue: ['next'],
  };
  const pendingHistoryItemRef = {
    get current() {
      return state.pending;
    },
    set current(value: HistoryItemWithoutId | null) {
      state.pending = value;
    },
  };
  const deps: Parameters<typeof useStreamEventHandlers>[0] = {
    runtime: createStreamRuntimeForTest({}, createMockOverrides()),
    agent: createFakeAgentFromMockClient({}),
    settings: createLoadedSettings(),
    addItem: () => 1,
    onDebugMessage: () => {},
    onCancelSubmit: () => {},
    sanitizeContent: (text) => ({ text, blocked: false }),
    flushPendingHistoryItem: () => {},
    pendingHistoryItemRef,
    turnCancelledRef: { current: false },
    clearSubmissions: () => {
      state.queue = [];
    },
    setPendingHistoryItem: (value) => {
      state.pending =
        typeof value === 'function' ? value(state.pending) : value;
    },
    setIsResponding: (value) => {
      state.responding =
        typeof value === 'function' ? value(state.responding) : value;
    },
    setThought: (value) => {
      state.thought =
        typeof value === 'function' ? value(state.thought) : value;
    },
    setLastAgentActivityTime: () => {},
    scheduleToolCalls: async () => {},
    abortActiveStream: () => {},
    handleShellCommand: () => false,
    handleSlashCommand: async () => false,
    logger: null,
    shellModeActive: false,
    loopDetectedRef: { current: false },
    lastProfileNameRef: { current: undefined },
    lastModelInfoRef: { current: null },
    lastModelIdentityRef: { current: null },
  };
  return { state, deps };
}

describe('retry control ownership', () => {
  it('preserves scheduler tool controls, turn ownership and queued submissions on retry', () => {
    const tool: HistoryItemWithoutId = { type: 'tool_group', tools: [] };
    const { state, deps } = retryControls(tool);
    const hook = renderHook(() => useStreamEventHandlers(deps));
    act(() => {
      hook.result.current.handleStreamAttemptDiscarded();
    });
    expect(state.pending).toBe(tool);
    expect(state.thought).toBeNull();
    expect(state.responding).toBe(true);
    expect(state.queue).toStrictEqual(['next']);
    hook.unmount();
  });

  it('drops pending assistant state without releasing the active turn on retry', () => {
    const { state, deps } = retryControls({
      type: 'gemini',
      text: 'abandoned',
    });
    const hook = renderHook(() => useStreamEventHandlers(deps));
    act(() => {
      hook.result.current.handleStreamAttemptDiscarded();
    });
    expect(state.pending).toBeNull();
    expect(state.thought).toBeNull();
    expect(state.responding).toBe(true);
    expect(state.queue).toStrictEqual(['next']);
    hook.unmount();
  });
});
