/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import { describe, expect, it } from 'vitest';
import { createObservationTap } from './observationTap.js';

const textEvent: AgentEvent = { type: 'text', text: 'draft' };
const toolCallEvent: AgentEvent = {
  type: 'tool-call',
  call: { id: 'tool-1', name: 'read_file', args: {} },
};
const confirmationEvent: AgentEvent = {
  type: 'tool-confirmation',
  confirmation: {
    confirmationId: 'confirmation-1',
    toolCallId: 'tool-1',
    name: 'read_file',
    details: {},
  },
};
const executingEvent: AgentEvent = {
  type: 'tool-status',
  update: { id: 'tool-1', name: 'read_file', status: 'executing' },
};
const doneEvent: AgentEvent = { type: 'done', reason: 'stop' };
const secondToolCallEvent: AgentEvent = {
  type: 'tool-call',
  call: { id: 'tool-2', name: 'run_shell', args: {} },
};
const secondConfirmationEvent: AgentEvent = {
  type: 'tool-confirmation',
  confirmation: {
    confirmationId: 'confirmation-2',
    toolCallId: 'tool-2',
    name: 'run_shell',
    details: {},
  },
};
const secondExecutingEvent: AgentEvent = {
  type: 'tool-status',
  update: { id: 'tool-2', name: 'run_shell', status: 'executing' },
};

/**
 * A target whose callbacks are inert except where a test overrides them, so
 * each test asserts on exactly the signal it cares about.
 */
function noopTarget(calls: string[]) {
  return {
    onTurnStarted: () => calls.push('turn.started'),
    onTurnEnded: (outcome: string) => calls.push(`turn.ended:${outcome}`),
    onActivityChanged: () => undefined,
    onWaitOpened: () => undefined,
    onWaitResolved: () => undefined,
    onToolCreated: () => undefined,
    onToolPhaseChanged: () => undefined,
    onAssistantChunk: () => undefined,
    onAssistantMessageCommitted: () => undefined,
    onSourceError: () => undefined,
  };
}

describe('createObservationTap', () => {
  it('observes canonical events without consuming a second stream', () => {
    const calls: string[] = [];
    const tap = createObservationTap({
      onTurnStarted: () => calls.push('turn.started'),
      onTurnEnded: (outcome) => calls.push(`turn.ended:${outcome}`),
      onActivityChanged: (state) => calls.push(`activity:${state}`),
      onWaitOpened: (reason) => calls.push(`wait.opened:${reason}`),
      onWaitResolved: () => calls.push('wait.resolved'),
      onToolCreated: (label, phase) =>
        calls.push(`tool.created:${label}:${phase}`),
      onToolPhaseChanged: (label, phase) =>
        calls.push(`tool.phase:${label}:${phase}`),
      onAssistantChunk: () => calls.push('draft.observed'),
      onAssistantMessageCommitted: (content) =>
        calls.push(`message:${content}`),
      onSourceError: () => calls.push('source.error'),
    });

    tap.onTurnStarted();
    tap.processEvent(textEvent);
    tap.processEvent(toolCallEvent);
    tap.processEvent(confirmationEvent);
    tap.processEvent(executingEvent);
    tap.onFlushCommitted('Done.', 100);
    tap.processEvent(doneEvent);

    expect(calls).toStrictEqual([
      'turn.started',
      'draft.observed',
      'activity:thinking',
      'activity:acting',
      'tool.created:read_file:proposed',
      'tool.phase:read_file:awaiting_approval',
      'wait.opened:permission',
      'tool.phase:read_file:executing',
      'wait.resolved',
      'message:Done.',
      'turn.ended:completed',
    ]);
  });

  it('resolves the wait only once every concurrently approved tool has left approval', () => {
    const opened: string[] = [];
    const resolved: string[] = [];
    const tap = createObservationTap({
      ...noopTarget([]),
      onWaitOpened: (reason) => opened.push(reason),
      onWaitResolved: () => resolved.push('resolved'),
    });

    tap.onTurnStarted();
    tap.processEvent(toolCallEvent);
    tap.processEvent(confirmationEvent);
    tap.processEvent(secondToolCallEvent);
    tap.processEvent(secondConfirmationEvent);

    // With two concurrent approvals, the wait must be opened exactly once
    // (empty-to-nonempty transition) and not twice.
    expect(opened).toStrictEqual(['permission']);
    expect(resolved).toStrictEqual([]);

    tap.processEvent(executingEvent);
    expect(resolved).toStrictEqual([]);

    tap.processEvent(secondExecutingEvent);
    // The wait resolves exactly once when the last approval clears, matching
    // the single open.
    expect(resolved).toStrictEqual(['resolved']);
  });

  it('discards tool correlation at a turn boundary so a cancelled turn cannot leak a wait', () => {
    const calls: string[] = [];
    const tap = createObservationTap({
      ...noopTarget(calls),
      onWaitResolved: () => calls.push('wait.resolved'),
    });

    // A turn that opens an approval and is cancelled before any terminal
    // tool event arrives.
    tap.onTurnStarted();
    tap.processEvent(toolCallEvent);
    tap.processEvent(confirmationEvent);
    tap.processEvent({ type: 'done', reason: 'aborted' });

    // Abandoning the approval must resolve the wait rather than leave the
    // observer showing one that can never complete.
    expect(calls.filter((call) => call === 'wait.resolved')).toStrictEqual([
      'wait.resolved',
    ]);

    // The next turn must not inherit the abandoned approval.
    tap.onTurnStarted();
    tap.processEvent(executingEvent);

    expect(calls.filter((call) => call === 'wait.resolved')).toStrictEqual([
      'wait.resolved',
    ]);
  });

  it('reports a cut-short or declined turn as failed, never completed', () => {
    for (const [reason, outcome] of [
      ['stop', 'turn.ended:completed'],
      ['aborted', 'turn.ended:cancelled'],
      ['hook-stopped', 'turn.ended:cancelled'],
      ['error', 'turn.ended:failed'],
      ['context-overflow', 'turn.ended:failed'],
      ['max-turns', 'turn.ended:failed'],
      ['loop-detected', 'turn.ended:failed'],
      ['refusal', 'turn.ended:failed'],
    ] as const) {
      const calls: string[] = [];
      const tap = createObservationTap(noopTarget(calls));
      tap.onTurnStarted();
      tap.processEvent({ type: 'done', reason } as AgentEvent);
      expect(calls).toContain(outcome);
    }
  });

  it('maps every ToolUpdateStatus to the correct JSP tool phase', () => {
    for (const [status, phase] of [
      ['validating', 'proposed'],
      ['scheduled', 'scheduled'],
      ['awaiting-approval', 'awaiting_approval'],
      ['executing', 'executing'],
      ['success', 'succeeded'],
      ['error', 'failed'],
      ['cancelled', 'cancelled'],
    ] as const) {
      const calls: string[] = [];
      const tap = createObservationTap({
        ...noopTarget(calls),
        onToolPhaseChanged: (label, p) => calls.push(`phase:${label}:${p}`),
      });
      tap.onTurnStarted();
      tap.processEvent(toolCallEvent);
      tap.processEvent({
        type: 'tool-status',
        update: {
          id: 'tool-1',
          name: 'read_file',
          status,
        },
      } as AgentEvent);
      expect(calls).toContain(`phase:read_file:${phase}`);
    }
  });
});
