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
});
