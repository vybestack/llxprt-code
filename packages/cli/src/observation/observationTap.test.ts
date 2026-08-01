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
    const calls: string[] = [];
    const tap = createObservationTap({
      ...noopTarget(calls),
      onWaitResolved: () => calls.push('wait.resolved'),
    });

    tap.onTurnStarted();
    tap.processEvent(toolCallEvent);
    tap.processEvent(confirmationEvent);
    tap.processEvent(secondToolCallEvent);
    tap.processEvent(secondConfirmationEvent);

    tap.processEvent(executingEvent);
    expect(calls).not.toContain('wait.resolved');

    tap.processEvent(secondExecutingEvent);
    expect(calls.filter((call) => call === 'wait.resolved')).toStrictEqual([
      'wait.resolved',
    ]);
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
});
