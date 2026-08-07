/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AgentEvent,
  AgentToolResult,
  DoneReason,
} from '@vybestack/llxprt-code-agents';
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
 * The pause tool name, matched case-insensitively. Kept as a local literal
 * for consistency with `AgenticLoop.ts` and `TodoContinuationService.ts`,
 * which hardcode the same value. The matching constant is also exported from
 * a self-contained module in the tools package, but the other two call sites
 * use the literal, so this matches them rather than introducing a new import
 * for a single string comparison.
 */
const TODO_PAUSE_TOOL_NAME = 'todo_pause';

/**
 * A pause is "successful" only when it ended in a succeeded terminal phase
 * with a non-error result. This mirrors `hasSuccessfulTodoPause` in
 * AgenticLoop.ts, which additionally requires `status === 'success'` beyond
 * the error/response checks. The projected-event analogue of that status is
 * the effective terminal phase: a pause cancelled by abort projects
 * `isError: false` and `errorType: undefined` but a `cancelled` phase, so the
 * phase gate is what prevents a cancelled-by-abort pause from masquerading as
 * a successful one. A failed pause (invalid reason, schema error, filtered
 * text) does not stop the loop, so it must not be reported as the agent being
 * blocked on a human.
 */
function isSuccessfulPauseResult(
  label: string,
  result: AgentToolResult,
  effectivePhase: JspToolPhase,
): boolean {
  return (
    label.toLowerCase() === TODO_PAUSE_TOOL_NAME &&
    effectivePhase === 'succeeded' &&
    result.isError !== true &&
    result.errorType === undefined
  );
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
   * The FIRST terminal phase observed for each call id, keyed by call id.
   *
   * The first terminal phase is sticky: a cancelled tool still emits a
   * terminal `tool-result`, and `projectToolResult` derives `isError` as
   * `status === 'error' || (status === 'cancelled' && outcome === Cancel)`,
   * so a tool cancelled by abort (not by an explicit Cancel confirmation
   * outcome) yields `isError: false` and would otherwise be rewritten from
   * `cancelled` to `succeeded` by the later `tool-result`. Recording the
   * phase rather than a bare membership also lets the pause-success check
   * reject a cancelled-by-abort pause, whose result carries neither error
   * flag nor errorType.
   */
  readonly terminalPhases: Map<string, JspToolPhase>;
  /**
   * Becomes true once a successful pause-tool result has been seen this turn.
   * Turn-scoped: reset at each turn boundary so it never leaks across turns.
   * Mutable by design — it records observed turn state.
   */
  successfulPauseObserved: boolean;
}

function routeToolEvent(
  event: Extract<AgentEvent, { type: 'tool-status' | 'tool-result' }>,
  target: ObservationTapTarget,
  scope: TurnScope,
): void {
  if (event.type === 'tool-status') {
    const label = scope.toolLabels.get(event.update.id) ?? event.update.name;
    // Refresh the call-id → label correlation from the status update's name.
    // A `tool-result` projected from the raw a2a `ToolCallResponse` stream
    // variant carries an EMPTY name (only the loop-native `tools_complete`
    // path knows the originating request), so the label has to come from the
    // `tool-call` or an intervening status update.
    if (event.update.name.length > 0) {
      scope.toolLabels.set(event.update.id, event.update.name);
    }
    const phase = mapToolStatus(event.update.status);
    if (!scope.terminalPhases.has(event.update.id)) {
      target.onToolPhaseChanged(label, phase);
      if (isTerminalPhase(phase)) {
        scope.terminalPhases.set(event.update.id, phase);
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
  // The effective terminal phase honors the sticky first terminal status when
  // one was observed (a cancelled-by-abort tool reaches here with
  // isError:false). Only when no status ever arrived does the result's error
  // flag derive the phase.
  const effectivePhase: JspToolPhase =
    scope.terminalPhases.get(event.result.id) ??
    (event.result.isError === true ? 'failed' : 'succeeded');
  if (!scope.terminalPhases.has(event.result.id)) {
    target.onToolPhaseChanged(label, effectivePhase);
    scope.terminalPhases.set(event.result.id, effectivePhase);
  }
  // Record a successful pause using the correlated label (captured above,
  // before the toolLabels entry is deleted below) so a result whose raw-stream
  // projection carries an empty name is still matched against the tool-call.
  // This check MUST stay outside the terminal-phase guard above: production
  // delivers tool-status:success BEFORE the tool-result, so guarding it would
  // suppress every genuine pause (the phase is already recorded as terminal
  // when the result arrives).
  if (isSuccessfulPauseResult(label, event.result, effectivePhase)) {
    scope.successfulPauseObserved = true;
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
    terminalPhases: new Map<string, JspToolPhase>(),
    successfulPauseObserved: false,
  };

  /**
   * Session-scoped: a pause wait deliberately survives the turn-scoped reset so
   * the observer keeps showing "needs you" while the agent sits at the prompt.
   * It is resolved only when the next turn actually begins — that is the moment
   * the human re-engages, so the wait resolves there and only there. Keeping it
   * out of the turn-scoped reset is the entire point: an unconditional wait on
   * every turn end would mark every idle agent as needing attention, destroying
   * the distinction between "finished" and "gave up and blocked on a human".
   */
  let pauseWaitOpen = false;

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
    scope.terminalPhases.clear();
    scope.successfulPauseObserved = false;
    if (hadPendingApproval) {
      target.onWaitResolved();
    }
  };

  /**
   * A turn can be closed from three places: the terminal `done` event, the
   * submit path's failure handler, and the interactive cancel handler. Only the
   * first of those may take effect, or the observer would see several ends for
   * one turn. Ending a turn that was never started is likewise a no-op.
   *
   * This is also where a pause-ended turn opens its `user_input` wait. The
   * public stream emits exactly one `done` and it is the LAST event of the
   * turn (issue #3087), so by the time a `done` reaches here every tool result
   * — including a pause's — has already been observed. `turn.ended` is
   * published FIRST and the wait second: the wait must not claim the agent is
   * blocked on a human before control has actually returned. The two are
   * separate revisions, so a consumer sampling between them momentarily sees
   * the idle state.
   */
  let turnOpen = false;
  const endTurn = (outcome: JspTurnOutcome): void => {
    if (!turnOpen) {
      return;
    }
    turnOpen = false;
    // Read the pause flag before the reset clears it.
    const pauseEndedTurn = scope.successfulPauseObserved;
    resetTurnScopedState();
    target.onTurnEnded(outcome);
    if (pauseEndedTurn && outcome === 'completed' && !pauseWaitOpen) {
      target.onWaitOpened('user_input');
      pauseWaitOpen = true;
    }
  };

  return {
    onTurnStarted(): void {
      // Resolve a lingering pause wait before the new turn begins. The wait is
      // session-scoped precisely so it survives here: the next prompt is the
      // moment the human re-engages, so the wait resolves exactly once, before
      // turn.started, and a later turn with no pause emits no further signal.
      if (pauseWaitOpen) {
        target.onWaitResolved();
        pauseWaitOpen = false;
      }
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
