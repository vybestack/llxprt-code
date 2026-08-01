/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JspProducerIdentity } from './jspSchema.js';
import type {
  JspFieldState,
  JspNativeSession,
  JspSnapshotDocument,
  JspActivityState,
  JspWaitReason,
  JspTodoList,
  JspTodoItem,
  JspToolCall,
  JspToolPhase,
  JspTurnOutcome,
} from './jspDocuments.js';

export type NowFn = () => number;

export type {
  JspNativeSession,
  JspActivityState,
  JspWaitReason,
  JspToolPhase,
  JspTurnOutcome,
  JspTodoItem,
  JspTodoList,
  JspToolCall,
};

export interface JspTurnAnchor {
  readonly startedAtMs: number;
}

export interface JspWait {
  readonly reason: JspWaitReason;
}

export type JspTransition =
  | { readonly type: 'turn.started' }
  | { readonly type: 'turn.ended'; readonly outcome: JspTurnOutcome }
  | { readonly type: 'activity.changed'; readonly state: JspActivityState }
  | { readonly type: 'wait.opened'; readonly reason: JspWaitReason }
  | { readonly type: 'wait.resolved' }
  | {
      readonly type: 'todos.replaced';
      readonly revision: number;
      readonly items: readonly JspTodoItem[];
    }
  | {
      readonly type: 'tool_call.created';
      readonly label: string;
      readonly phase: JspToolPhase;
    }
  | {
      readonly type: 'tool_call.phase_changed';
      readonly label: string;
      readonly phase: JspToolPhase;
    }
  | {
      readonly type: 'assistant_message.displayed';
      readonly content: string;
      readonly committedMs: number;
    }
  | {
      readonly type: 'source.error';
      readonly summary: string;
      readonly code: string;
    }
  | { readonly type: 'session.ended' };

export interface JspProducerState {
  readonly identity: JspProducerIdentity;
  readonly nativeSession: JspNativeSession;
  readonly sourceSequence: number;
  readonly activity: JspActivityState;
  readonly wait: JspWait | null;
  readonly currentTurn: JspTurnAnchor | null;
  readonly todos: JspTodoList | null;
  readonly lastMessage: {
    readonly content: string;
    readonly committedMs: number;
  } | null;
  readonly lastTool: JspToolCall | null;
  readonly sourceError: {
    readonly summary: string;
    readonly code: string;
  } | null;
  readonly terminalState: {
    readonly summary: string;
    readonly code: string;
  } | null;
}

export function initProducerState(
  identity: JspProducerIdentity,
  nativeSession: JspNativeSession,
): JspProducerState {
  return {
    identity,
    nativeSession,
    sourceSequence: 0,
    activity: 'idle',
    wait: null,
    currentTurn: null,
    todos: null,
    lastMessage: null,
    lastTool: null,
    sourceError: null,
    terminalState: null,
  };
}

function next(state: JspProducerState): JspProducerState {
  return {
    ...state,
    sourceSequence: state.sourceSequence + 1,
  };
}

export function applyTransition(
  state: JspProducerState,
  transition: JspTransition,
  now: NowFn,
): JspProducerState {
  switch (transition.type) {
    case 'turn.started': {
      return next({
        ...state,
        activity: 'thinking',
        currentTurn: { startedAtMs: now() },
      });
    }
    case 'turn.ended': {
      return next({
        ...state,
        activity: 'idle',
        currentTurn: null,
      });
    }
    case 'activity.changed': {
      return next({ ...state, activity: transition.state });
    }
    case 'wait.opened': {
      return next({ ...state, wait: { reason: transition.reason } });
    }
    case 'wait.resolved': {
      return next({ ...state, wait: null });
    }
    case 'todos.replaced': {
      return applyTodosReplaced(state, transition);
    }
    case 'tool_call.created': {
      return next({
        ...state,
        lastTool: { label: transition.label, phase: transition.phase },
      });
    }
    case 'tool_call.phase_changed': {
      if (
        state.lastTool !== null &&
        state.lastTool.label === transition.label
      ) {
        return next({
          ...state,
          lastTool: { label: transition.label, phase: transition.phase },
        });
      }
      // A phase change for a tool that is no longer the headline is ignored.
      // Advancing the sequence here would publish a revision carrying no state
      // change, which is also how a stale task-list revision is handled.
      return state;
    }
    case 'assistant_message.displayed': {
      return next({
        ...state,
        lastMessage: {
          content: transition.content,
          committedMs: transition.committedMs,
        },
      });
    }
    case 'source.error': {
      return next({
        ...state,
        sourceError: { summary: transition.summary, code: transition.code },
      });
    }
    case 'session.ended': {
      // Record the terminal state and produce a genuinely terminal snapshot:
      // clear the in-flight turn (so elapsed_ms stops growing), clear any
      // pending wait, and return activity to idle. Leaving these untouched
      // would make buildSnapshot advertise a forever-growing elapsed_ms and
      // a pending wait that can never complete after the session has ended.
      return next({
        ...state,
        activity: 'idle',
        wait: null,
        currentTurn: null,
        terminalState: { summary: 'session ended', code: 'SESSION_ENDED' },
      });
    }
    default:
      return state;
  }
}

function applyTodosReplaced(
  state: JspProducerState,
  transition: Extract<JspTransition, { type: 'todos.replaced' }>,
): JspProducerState {
  // Revisions are positive and strictly increasing per epoch, including the
  // first one: without this a leading zero or negative revision is accepted.
  if (!Number.isInteger(transition.revision) || transition.revision < 1) {
    return state;
  }
  if (state.todos !== null && transition.revision <= state.todos.revision) {
    return state;
  }
  return next({
    ...state,
    todos: {
      revision: transition.revision,
      items: transition.items.map((i) => ({ ...i })),
    },
  });
}

function knownField<T>(value: T): JspFieldState<T> {
  return {
    provenance: 'authoritative',
    availability: 'known',
    value,
  };
}

function unknownField<T>(
  provenance: 'authoritative' | 'inferred',
): JspFieldState<T> {
  return { provenance, availability: 'unknown' };
}

export function buildSnapshot(
  state: JspProducerState,
  now: NowFn,
): JspSnapshotDocument {
  const { identity } = state;
  const currentTurn =
    state.currentTurn === null
      ? null
      : { elapsed_ms: Math.max(0, now() - state.currentTurn.startedAtMs) };
  // Until a task list has actually been observed the revision is unknown, not
  // revision 1 with no items. Claiming revision 1 here lets a real first list
  // arrive carrying the same revision, which a consumer deduplicating on
  // revision would then discard.
  const todosField: JspFieldState<JspTodoList> =
    state.todos === null
      ? unknownField<JspTodoList>('authoritative')
      : knownField(state.todos);
  return {
    schema: 1,
    kind: 'snapshot',
    agent_id: identity.agentId,
    lifecycle_generation: identity.lifecycleGeneration,
    source_epoch: identity.sourceEpoch,
    source_sequence: state.sourceSequence,
    cursor: state.sourceSequence,
    bridge_observed_ms: now(),
    native_session: state.nativeSession,
    process_binding: knownField({
      pid: identity.pid,
      started_at_ms: identity.startedAtMs,
    }),
    native_activity: knownField({ state: state.activity }),
    current_wait: knownField(state.wait),
    current_turn: knownField(currentTurn),
    todos: todosField,
    last_displayed_assistant_message:
      state.lastMessage === null
        ? unknownField('inferred')
        : {
            provenance: 'inferred',
            availability: 'known',
            value: {
              content: state.lastMessage.content,
              committed_ms: state.lastMessage.committedMs,
            },
          },
    last_created_tool_call:
      state.lastTool === null
        ? unknownField('authoritative')
        : knownField(state.lastTool),
    source_terminal_state: knownField(state.terminalState),
    source_error_state:
      state.sourceError === null
        ? unknownField('authoritative')
        : knownField(state.sourceError),
  };
}
