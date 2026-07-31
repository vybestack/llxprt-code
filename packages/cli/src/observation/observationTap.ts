/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import type {
  JspActivityState,
  JspToolPhase,
  JspTurnOutcome,
  JspWaitReason,
} from './jspDocuments.js';

export interface ObservationTapTarget {
  onTurnStarted(): void;
  onTurnEnded(outcome: JspTurnOutcome): void;
  onActivityChanged(state: JspActivityState): void;
  onWaitOpened(reason: JspWaitReason): void;
  onWaitResolved(): void;
  onToolCreated(label: string, phase: JspToolPhase): void;
  onToolPhaseChanged(label: string, phase: JspToolPhase): void;
  onAssistantChunk(content: string): void;
  onAssistantMessageCommitted(content: string, committedMs: number): void;
  onSourceError(summary: string, code: string): void;
}

export interface ObservationTap {
  onTurnStarted(): void;
  onTurnEnded(outcome: JspTurnOutcome): void;
  processEvent(event: AgentEvent): void;
  onFlushCommitted(content: string, committedMs: number): void;
}

function mapDoneReason(reason: string): JspTurnOutcome {
  if (reason === 'aborted') {
    return 'cancelled';
  }
  if (reason === 'error' || reason === 'context-overflow') {
    return 'failed';
  }
  return 'completed';
}

function mapToolStatus(
  status: Extract<AgentEvent, { type: 'tool-status' }>['update']['status'],
): JspToolPhase {
  switch (status) {
    case 'awaiting-approval':
      return 'awaiting_approval';
    case 'scheduled':
      return 'scheduled';
    case 'executing':
      return 'executing';
    case 'success':
      return 'succeeded';
    case 'error':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'validating':
      return 'proposed';
    default:
      return 'proposed';
  }
}

/** Mutable correlation state scoped to a single turn. */
interface TurnScope {
  readonly toolLabels: Map<string, string>;
  readonly awaitingConfirmation: Set<string>;
}

function routeToolEvent(
  event: Extract<AgentEvent, { type: 'tool-status' | 'tool-result' }>,
  target: ObservationTapTarget,
  scope: TurnScope,
): void {
  if (event.type === 'tool-status') {
    const label = scope.toolLabels.get(event.update.id) ?? event.update.name;
    target.onToolPhaseChanged(label, mapToolStatus(event.update.status));
    if (
      mapToolStatus(event.update.status) !== 'awaiting_approval' &&
      scope.awaitingConfirmation.delete(event.update.id) &&
      scope.awaitingConfirmation.size === 0
    ) {
      target.onWaitResolved();
    }
    return;
  }
  const label = scope.toolLabels.get(event.result.id) ?? event.result.name;
  target.onToolPhaseChanged(
    label,
    event.result.isError === true ? 'failed' : 'succeeded',
  );
  scope.toolLabels.delete(event.result.id);
  if (
    scope.awaitingConfirmation.delete(event.result.id) &&
    scope.awaitingConfirmation.size === 0
  ) {
    target.onWaitResolved();
  }
}

function routeEvent(
  event: AgentEvent,
  target: ObservationTapTarget,
  scope: TurnScope,
  resetTurnScopedState: () => void,
): void {
  switch (event.type) {
    case 'text':
      target.onAssistantChunk(event.text);
      target.onActivityChanged('thinking');
      break;
    case 'thinking':
      target.onActivityChanged('thinking');
      break;
    case 'tool-call':
      scope.toolLabels.set(event.call.id, event.call.name);
      target.onActivityChanged('acting');
      target.onToolCreated(event.call.name, 'proposed');
      break;
    case 'tool-confirmation':
      scope.awaitingConfirmation.add(event.confirmation.toolCallId);
      target.onToolPhaseChanged(event.confirmation.name, 'awaiting_approval');
      target.onWaitOpened('permission');
      break;
    case 'tool-status':
    case 'tool-result':
      routeToolEvent(event, target, scope);
      break;
    case 'error':
      target.onSourceError(event.error.message, 'AGENT_ERROR');
      break;
    case 'done':
      resetTurnScopedState();
      target.onTurnEnded(mapDoneReason(event.reason));
      break;
    default:
      break;
  }
}

export function createObservationTap(
  target: ObservationTapTarget | null,
): ObservationTap {
  if (target === null) {
    return {
      onTurnStarted: () => undefined,
      onTurnEnded: () => undefined,
      processEvent: () => undefined,
      onFlushCommitted: () => undefined,
    };
  }
  const scope: TurnScope = {
    toolLabels: new Map<string, string>(),
    awaitingConfirmation: new Set<string>(),
  };

  /**
   * Tool correlation is turn-scoped. A cancelled or aborted turn never delivers
   * terminal `tool-result` events for its in-flight tools, so entries must be
   * discarded at each turn boundary rather than accumulating for the life of
   * the session and leaking a stale wait into a later turn.
   */
  const resetTurnScopedState = (): void => {
    scope.toolLabels.clear();
    scope.awaitingConfirmation.clear();
  };

  return {
    onTurnStarted(): void {
      resetTurnScopedState();
      target.onTurnStarted();
    },
    onTurnEnded(outcome: JspTurnOutcome): void {
      resetTurnScopedState();
      target.onTurnEnded(outcome);
    },
    processEvent(event: AgentEvent): void {
      routeEvent(event, target, scope, resetTurnScopedState);
    },
    onFlushCommitted(content: string, committedMs: number): void {
      if (content.length > 0) {
        target.onAssistantMessageCommitted(content, committedMs);
      }
    },
  };
}
