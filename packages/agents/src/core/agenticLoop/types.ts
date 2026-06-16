/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @requirement REQ-LOOP-002
 *
 * Engine-owned multi-turn agentic loop types.
 */

import type { PartListUnion } from '@google/genai';
import type { ServerGeminiStreamEvent } from '@vybestack/llxprt-code-core/core/turn.js';
import type {
  ToolCall,
  OutputUpdateHandler,
  ToolCallsUpdateHandler,
} from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { EditorType } from '@vybestack/llxprt-code-core/utils/editor.js';
import {
  type ToolConfirmationOutcome,
  type ToolConfirmationPayload,
} from '@vybestack/llxprt-code-tools';
import type { ToolConfirmationRequest } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';

/**
 * @requirement REQ-LOOP-001
 * Flat event stream yielded by {@link AgenticLoop.run}. The loop wraps model
 * stream events and tool-execution events into a single discriminated union so
 * consumers observe the full turn lifecycle without re-implementing it.
 */
export type AgenticLoopEvent =
  | { kind: 'stream'; event: ServerGeminiStreamEvent }
  | { kind: 'tool_update'; toolCalls: ToolCall[] }
  | { kind: 'tool_output'; callId: string; chunk: string }
  | { kind: 'tools_complete'; completed: CompletedToolCall[] }
  | { kind: 'awaiting_approval'; toolCalls: ToolCall[] };

/**
 * @requirement REQ-LOOP-002
 * Structured result returned by an {@link ApprovalHandler}. Carries the
 * {@link ToolConfirmationOutcome} and an optional payload used to override
 * tool arguments (e.g. modified content for inline modify, edited shell
 * command). The loop forwards both to the confirmation bus via
 * `messageBus.respondToConfirmation(correlationId, outcome, payload)`.
 */
export interface ApprovalResult {
  outcome: ToolConfirmationOutcome;
  payload?: ToolConfirmationPayload;
}

/**
 * @requirement REQ-LOOP-002
 * Approval handler invoked only when policy returns `ASK_USER`. Resolves an
 * {@link ApprovalResult} whose outcome (and optional payload) the loop
 * forwards back over the confirmation bus via
 * `messageBus.respondToConfirmation`.
 *
 * This is the single injection point where clients (CLI dialog, a2a auto-deny,
 * headless tests) differ. When omitted, the existing non-interactive path
 * treats an unsatisfiable `ASK_USER` as a denial.
 */
export type ApprovalHandler = (
  request: ToolConfirmationRequest,
) => Promise<ApprovalResult>;

/**
 * @requirement REQ-LOOP-002
 * Caller-provided UI passthrough callbacks forwarded to the scheduler while
 * the loop still owns the completion signal. Each field mirrors the
 * corresponding scheduler callback signature exactly; all are optional so a
 * caller may supply only the display surface it cares about. When a field is
 * omitted the loop falls back to a no-op default, preserving headless
 * behavior.
 */
export interface DisplayCallbacks {
  /** Forwarded after the loop records its own tool_update/awaiting_approval events. */
  onToolCallsUpdate?: ToolCallsUpdateHandler;
  /** Forwarded after the loop records its own tool_output event (string chunks only). */
  outputUpdateHandler?: OutputUpdateHandler;
  /** Preferred editor for ModifyWithEditor flows; `undefined` when the caller has none. */
  getPreferredEditor?: () => EditorType | undefined;
  /** Invoked when an editor is opened during a ModifyWithEditor flow. */
  onEditorOpen?: () => void;
  /** Invoked when an editor is closed during a ModifyWithEditor flow. */
  onEditorClose?: () => void;
}

/**
 * @requirement REQ-LOOP-002
 * Construction options for {@link AgenticLoop}.
 *
 * Three injection points:
 *  - **Policy**: `config` carries the `PolicyEngine`/`ApprovalMode`. Pure
 *    engine logic — never touches UI.
 *  - **Approval**: the optional `approvalHandler`, invoked only on `ASK_USER`.
 *  - **Display**: the optional {@link DisplayCallbacks}, forwarded to the
 *    scheduler so an embedding UI (e.g. the CLI) can observe tool/output
 *    updates and drive editor flows without colliding with the loop's
 *    completion ownership.
 */
export interface AgenticLoopOptions {
  /** Single-turn turn primitive (`sendMessageStream`) and history sink. */
  agentClient: AgentClientContract;
  /** Carries policy, scheduler singleton, tool registry, session id, interactivity. */
  config: Config;
  /** Confirmation bus the scheduler's ConfirmationCoordinator publishes to. */
  messageBus: MessageBus;
  /** Optional handler resolving ASK_USER confirmations. See {@link ApprovalHandler}. */
  approvalHandler?: ApprovalHandler;
  /**
   * Whether the scheduler runs in interactive mode. When `false` (default) the
   * scheduler is configured for non-interactive/subagent contexts. When `true`,
   * tool context sees interactive mode (enabling editor support and live
   * progress display).
   */
  interactiveMode?: boolean;
  /**
   * Caller-provided UI passthrough callbacks forwarded to the scheduler. The
   * loop composes these with its own internal handlers so completion ownership
   * stays with the loop while display updates flow to the caller. See
   * {@link DisplayCallbacks}.
   */
  displayCallbacks?: DisplayCallbacks;
}

/** Initial message type accepted by {@link AgenticLoop.run}. */
export type AgenticLoopMessage = PartListUnion;
