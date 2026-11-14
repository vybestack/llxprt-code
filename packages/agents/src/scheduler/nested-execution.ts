/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scheduler-side pieces of code mode (issue #4084): the per-execution scope
 * handed to an invocation, the host-only nested-execution port, and the
 * result-delivery sink through which a nested caller receives the post-hook
 * `ToolResult` before it is formatted for the model.
 */

import type { ToolCallRequestInfo } from '@vybestack/llxprt-code-core/core/turn.js';
import { DEFAULT_AGENT_ID } from '@vybestack/llxprt-code-core/core/turn.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { SchedulerCallbacks } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import type {
  NestedToolExecution,
  ToolExecutionScope,
  ToolGovernance,
  ToolLookup,
  ToolResult,
} from '@vybestack/llxprt-code-tools';
import type { ToolScriptRunEvent } from '@vybestack/llxprt-code-core/telemetry/types.js';
import type { ApprovalHandler } from '../core/agenticLoop/types.js';
import type { SessionSchedulerOwner } from '../session/sessionSchedulerOwner.js';
import type { CodeModeSettingLimits } from '../code-mode/code-mode-settings.js';

/** A finished call's post-hook result, before model-token formatting. */
export interface ToolResultDelivery {
  readonly callId: string;
  readonly toolName: string;
  readonly result: ToolResult;
}

export type ToolResultSink = (delivery: ToolResultDelivery) => void;

export interface NestedSchedulerCallbacks extends SchedulerCallbacks {
  readonly onToolResult: ToolResultSink;
}

export interface NestedSchedulerOptions {
  /**
   * Whether anyone can answer this run's approval prompts. When false a
   * nested call that needs approval fails at once with an approval-required
   * error instead of waiting for an answer that cannot come.
   */
  readonly promptsAvailable: boolean;
}

/**
 * What a nested run needs from the caller's scheduler composition: the same
 * bus, approval handler, interactive mode, admitted selection and governance,
 * and a factory for a fresh scheduler owner built from the same configuration
 * and policy. The factory's schedulers carry no nested composition of their
 * own, so a nested call can never start another script.
 */
export interface NestedExecutionComposition {
  readonly messageBus: MessageBus;
  readonly approval: ApprovalHandler | undefined;
  readonly interactiveMode: boolean;
  readonly selection: ToolLookup;
  readonly readGovernance: () => ToolGovernance;
  readonly createScheduler: (
    callbacks: NestedSchedulerCallbacks,
    options: NestedSchedulerOptions,
  ) => SessionSchedulerOwner;
  /** Exports one script run's lifecycle metrics through session telemetry. */
  readonly logScriptRun: (event: ToolScriptRunEvent) => void;
  /**
   * The caller's code mode limits for a run started now (a subagent's are
   * already lowered to its caller's). Read once per run and frozen for it.
   */
  readonly readCodeModeLimits: () => CodeModeSettingLimits;
  /** The caller's own deadline (epoch ms), when it has one. */
  readonly readDeadline: () => number | undefined;
}

/** The code mode inputs a caller adds to its scheduler composition. */
export interface NestedCodeModeInputs {
  readonly approval: ApprovalHandler | undefined;
  readonly readCodeModeLimits: () => CodeModeSettingLimits;
  readonly readDeadline?: () => number | undefined;
}

/**
 * Host-only port attached to one scheduled execution. It binds the caller's
 * composition to the hook owner of that call; tools cannot construct it and
 * no model argument can reach it.
 */
export class NestedExecutionPort implements NestedToolExecution {
  readonly kind = 'nested-tool-execution';

  constructor(
    readonly composition: NestedExecutionComposition,
    readonly hookOwner: HookExecutionOwner | undefined,
  ) {}
}

export function buildExecutionScope(
  request: ToolCallRequestInfo,
  composition: NestedExecutionComposition | undefined,
  hookOwner: HookExecutionOwner | undefined,
): ToolExecutionScope {
  return Object.freeze({
    callId: request.callId,
    promptId: request.prompt_id,
    agentId: request.agentId ?? DEFAULT_AGENT_ID,
    origin: request.script === undefined ? 'model' : 'script',
    hookRestrictedAllowedTools:
      request.hookRestrictedAllowedTools === undefined
        ? undefined
        : Object.freeze([...request.hookRestrictedAllowedTools]),
    nestedExecution:
      composition === undefined
        ? undefined
        : new NestedExecutionPort(composition, hookOwner),
  });
}
