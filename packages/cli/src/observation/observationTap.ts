/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentEvent, DoneReason } from '@vybestack/llxprt-code-agents';
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

/**
 * Map a stream completion reason to a turn outcome.
 *
 * Exhaustive on purpose. A falling-through default reported `max-turns`,
 * `loop-detected`, `hook-stopped` and `refusal` as completed, which claims a
 * turn succeeded when it was cut short or declined. Typing the parameter means
 * a reason added upstream fails this build instead of silently becoming a
 * success.
 */
function mapDoneReason(reason: DoneReason): JspTurnOutcome {
  switch (reason) {
    case 'stop':
      return 'completed';
    case 'aborted':
    case 'hook-stopped':
      return 'cancelled';
    case 'error':
    case 'context-overflow':
    case 'max-turns':
    case 'loop-detected':
    case 'refusal':
      return 'failed';
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
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
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function isTerminalPhase(phase: JspToolPhase): boolean {
  return phase === 'succeeded' || phase === 'failed' || phase === 'cancelled';
}

/** Mutable correlation state scoped to a single turn. */
interface TurnScope {
  readonly toolLabels: Map<string, string>;
  readonly awaitingConfirmation: Set<string>;
  /**
   * Call ids that already reported a terminal phase this turn.
   *
   * The first terminal phase observed for a call id is sticky: a cancelled
   * tool still emits a terminal `tool-result`, and
   * `projectToolResult` derives `isError` as
   * `status === 'error' || (status === 'cancelled' && outcome === Cancel)`,
   * so a tool cancelled by abort (not by an explicit Cancel confirmation
   * outcome) yields `isError: false` and would otherwise be rewritten from
   * `cancelled` to `succeeded` by the later `tool-result`.
   */
  readonly terminalTools: Set<string>;
}

function routeToolEvent(
  event: Extract<AgentEvent, { type: 'tool-status' | 'tool-result' }>,
  target: ObservationTapTarget,
  scope: TurnScope,
): void {
  if (event.type === 'tool-status') {
    const label = scope.toolLabels.get(event.update.id) ?? event.update.name;
    const phase = mapToolStatus(event.update.status);
    if (!scope.terminalTools.has(event.update.id)) {
      target.onToolPhaseChanged(label, phase);
      if (isTerminalPhase(phase)) {
        scope.terminalTools.add(event.update.id);
      }
    }
    // Suppression above covers only the phase emission. A suppressed event
    // still has to clear a pending approval, or an observer would be left
    // showing a wait that can never resolve.
    if (
      phase !== 'awaiting_approval' &&
      scope.awaitingConfirmation.delete(event.update.id) &&
      scope.awaitingConfirmation.size === 0
    ) {
      target.onWaitResolved();
    }
    return;
  }
  const label = scope.toolLabels.get(event.result.id) ?? event.result.name;
  const phase: JspToolPhase =
    event.result.isError === true ? 'failed' : 'succeeded';
  if (!scope.terminalTools.has(event.result.id)) {
    target.onToolPhaseChanged(label, phase);
    scope.terminalTools.add(event.result.id);
  }
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
  endTurn: (outcome: JspTurnOutcome) => void,
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
      // Open the wait only on the empty-to-nonempty transition so that N
      // concurrent approvals produce one opened and one resolved signal,
      // not N opened and 1 resolved.
      target.onToolPhaseChanged(event.confirmation.name, 'awaiting_approval');
      if (scope.awaitingConfirmation.size === 0) {
        target.onWaitOpened('permission');
      }
      scope.awaitingConfirmation.add(event.confirmation.toolCallId);
      break;
    case 'tool-status':
    case 'tool-result':
      routeToolEvent(event, target, scope);
      break;
    case 'error':
      target.onSourceError(event.error.message, 'AGENT_ERROR');
      break;
    case 'done':
      endTurn(mapDoneReason(event.reason));
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
    terminalTools: new Set<string>(),
  };

  /**
   * Tool correlation is turn-scoped. A cancelled or aborted turn never delivers
   * terminal `tool-result` events for its in-flight tools, so entries must be
   * discarded at each turn boundary rather than accumulating for the life of
   * the session and leaking a stale wait into a later turn.
   */
  const resetTurnScopedState = (): void => {
    // Discarding a pending approval without reporting it resolved would leave
    // the observer showing a wait that can never complete.
    const hadPendingApproval = scope.awaitingConfirmation.size > 0;
    scope.toolLabels.clear();
    scope.awaitingConfirmation.clear();
    scope.terminalTools.clear();
    if (hadPendingApproval) {
      target.onWaitResolved();
    }
  };

  /**
   * A turn can now be closed from three places: a terminal `done` event, the
   * submit path's failure handler, and the interactive cancel handler. Only the
   * first of those may take effect, or the observer would see several ends for
   * one turn. Ending a turn that was never started is likewise a no-op.
   */
  let turnOpen = false;
  const endTurn = (outcome: JspTurnOutcome): void => {
    if (!turnOpen) {
      return;
    }
    turnOpen = false;
    resetTurnScopedState();
    target.onTurnEnded(outcome);
  };

  return {
    onTurnStarted(): void {
      resetTurnScopedState();
      turnOpen = true;
      target.onTurnStarted();
    },
    onTurnEnded(outcome: JspTurnOutcome): void {
      endTurn(outcome);
    },
    processEvent(event: AgentEvent): void {
      routeEvent(event, target, scope, endTurn);
    },
    onFlushCommitted(content: string, committedMs: number): void {
      if (content.length > 0) {
        target.onAssistantMessageCommitted(content, committedMs);
      }
    },
  };
}
