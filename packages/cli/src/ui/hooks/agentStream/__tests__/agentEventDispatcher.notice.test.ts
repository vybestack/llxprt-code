/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4036, interactive path. A refusal-recovery `notice` event (retry
 * progress, the summary when recovery gives up) must reach the user as an info
 * item. Notices that carry no source, such as an MCP discovery failure, keep
 * their existing behavior and render nothing.
 *
 * Drives the real `dispatchAgentEvent` with the real `processContentEvent` and
 * `PendingResponseBuffer`; only the React state setters are plain holders.
 */

import { describe, expect, it } from 'bun:test';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import type { HistoryItemWithoutId } from '../../../types.js';
import {
  dispatchAgentEvent,
  type AgentEventDeps,
} from '../agentEventDispatcher.js';
import {
  withJournalResponse,
  renderedOrder,
  type Arrival,
} from './journal-response-test-helpers.js';

async function render(events: readonly AgentEvent[]): Promise<string[]> {
  const shown: string[] = [];
  await withJournalResponse(async (fixture) => {
    let arrival: Arrival | undefined;
    let pendingCommit: Promise<void> = Promise.resolve();
    let attempt = 0;
    const pendingHistoryItemRef: { current: HistoryItemWithoutId | null } = {
      current: null,
    };
    const deps: AgentEventDeps = {
      setLastPromptTokenCount: () => {},
      addItem: (item) => {
        if (item.type === 'info') shown.push(`info:${item.text}`);
      },
      flushPendingHistoryItem: () => {
        const held = arrival;
        if (held === undefined) return;
        const index = shown.length;
        shown.push('pending');
        arrival = undefined;
        pendingHistoryItemRef.current = null;
        pendingCommit = held.seal({}).then(async () => {
          const texts = renderedOrder(await fixture.items());
          shown[index] = texts[texts.length - 1];
        });
      },
      pendingHistoryItemRef,
      loopDetectedRef: { current: false },
      lastModelInfoRef: { current: null },
      lastModelIdentityRef: { current: null },
      setLastAgentActivityTime: () => {},
      setThought: () => {},
      handleUserCancelledEvent: () => {},
      handleErrorEvent: () => {},
      handleChatCompressionEvent: () => {},
      handleFinishedNotice: () => {},
      handleMaxSessionTurnsEvent: () => {},
      handleContextWindowWillOverflowEvent: () => {},
      handleCitationEvent: () => {},
      handleStreamAttemptDiscarded: () => {
        if (arrival !== undefined)
          pendingCommit = arrival.interrupt('superseded');
        arrival = undefined;
        pendingHistoryItemRef.current = null;
      },
    };
    for (const event of events) {
      if (event.type === 'text') {
        arrival ??= await fixture.open(`attempt-${attempt++}`);
        await arrival.append({ type: 'text', text: event.text });
        pendingHistoryItemRef.current = { type: 'gemini', text: '' };
      }
      dispatchAgentEvent(event, deps, 1);
      await pendingCommit;
    }
    await arrival?.interrupt('cancelled');
  });
  return shown;
}

describe('dispatchAgentEvent refusal-recovery notices (issue #4036)', () => {
  it('shows a retry notice as an info item', async () => {
    const shown = await render([
      {
        type: 'notice',
        source: 'refusal-recovery',
        message:
          'Model m refused the request; retrying in 15 s (retry 1 of 2).',
      },
    ]);

    expect(shown).toStrictEqual([
      'info:Model m refused the request; retrying in 15 s (retry 1 of 2).',
    ]);
  });

  it('shows the notice after the refused attempt text was discarded', async () => {
    const shown = await render([
      { type: 'text', text: 'I cannot help with that.' },
      { type: 'retry' },
      { type: 'notice', source: 'refusal-recovery', message: 'retrying' },
      { type: 'text', text: 'the answer' },
    ]);

    expect(shown).toStrictEqual(['info:retrying']);
  });

  it('commits visible refused text before a stop summary notice', async () => {
    const shown = await render([
      { type: 'text', text: 'I cannot help with that.' },
      { type: 'notice', source: 'refusal-recovery', message: 'Stopping.' },
    ]);

    expect(shown).toStrictEqual([
      'text:I cannot help with that.',
      'info:Stopping.',
    ]);
  });

  it('ignores notices without a source, as before', async () => {
    const shown = await render([
      { type: 'notice', message: "MCP server 'x' discovery failed: boom" },
    ]);

    expect(shown).toStrictEqual([]);
  });
});
