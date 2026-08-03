/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type JspFieldState<T> =
  | 'unsupported'
  | {
      readonly provenance: 'authoritative' | 'inferred';
      readonly availability: 'known';
      readonly value: T;
    }
  | {
      readonly provenance: 'authoritative' | 'inferred';
      readonly availability: 'unknown';
    }
  | {
      readonly provenance: 'authoritative' | 'inferred';
      readonly availability: 'degraded';
      readonly last_value: T;
      readonly as_of_ms: number;
      readonly diagnostic_code: string;
    };

export interface JspNativeSession {
  readonly repository: string;
  readonly path: string;
  readonly agent_kind: string;
  readonly pid: number;
  readonly display_name: string;
}

export type JspActivityState = 'idle' | 'thinking' | 'acting';
export type JspWaitReason =
  | 'permission'
  | 'question'
  | 'elicitation'
  | 'choice'
  | 'user_input'
  | 'other';
export type JspToolPhase =
  | 'proposed'
  | 'awaiting_approval'
  | 'scheduled'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';
export type JspTurnOutcome = 'completed' | 'failed' | 'cancelled';

export interface JspTodoItem {
  readonly text: string;
  readonly completed: boolean;
}

export interface JspTodoList {
  readonly revision: number;
  readonly items: readonly JspTodoItem[];
}

export interface JspAssistantMessage {
  readonly content: string;
  readonly committed_ms: number;
}

export interface JspToolCall {
  readonly label: string;
  readonly phase: JspToolPhase;
}

export interface JspDiagnostic {
  readonly summary: string;
  readonly code: string;
}

export interface JspSnapshotDocument {
  readonly schema: 1;
  readonly kind: 'snapshot';
  readonly agent_id: string;
  readonly lifecycle_generation: number;
  readonly source_epoch: string;
  readonly source_sequence: number;
  readonly cursor: number;
  readonly bridge_observed_ms: number;
  readonly native_session: JspNativeSession;
  readonly process_binding: JspFieldState<{
    readonly pid: number;
    readonly started_at_ms: number;
  }>;
  readonly native_activity: JspFieldState<{ readonly state: JspActivityState }>;
  readonly current_wait: JspFieldState<{
    readonly reason: JspWaitReason;
  } | null>;
  readonly current_turn: JspFieldState<{ readonly elapsed_ms: number } | null>;
  readonly todos: JspFieldState<JspTodoList>;
  readonly last_displayed_assistant_message: JspFieldState<JspAssistantMessage>;
  readonly last_created_tool_call: JspFieldState<JspToolCall>;
  readonly source_terminal_state: JspFieldState<JspDiagnostic | null>;
  readonly source_error_state: JspFieldState<JspDiagnostic>;
}

export type JspEventPayload =
  | { readonly type: 'activity.changed'; readonly state: JspActivityState }
  | { readonly type: 'wait.opened'; readonly reason: JspWaitReason }
  | { readonly type: 'wait.resolved' }
  | { readonly type: 'turn.started' }
  | { readonly type: 'turn.ended'; readonly outcome: JspTurnOutcome }
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
      readonly committed_ms: number;
    }
  | {
      readonly type: 'source.error';
      readonly summary: string;
      readonly code: string;
    }
  | { readonly type: 'session.ended' };

export interface JspEventDocument {
  readonly schema: 1;
  readonly kind: 'event';
  readonly agent_id: string;
  readonly lifecycle_generation: number;
  readonly source_epoch: string;
  readonly source_sequence: number;
  readonly bridge_observed_ms: number;
  readonly event: JspEventPayload;
}

export interface JspHeartbeatDocument {
  readonly schema: 1;
  readonly kind: 'heartbeat';
  readonly agent_id: string;
  readonly lifecycle_generation: number;
  readonly source_epoch: string;
  readonly bridge_observed_ms: number;
}

export type JspBoundDocument =
  | JspSnapshotDocument
  | JspEventDocument
  | JspHeartbeatDocument;
