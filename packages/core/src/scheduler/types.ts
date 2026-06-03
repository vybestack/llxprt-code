/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260302-TOOLSCHEDULER.P01
 * @requirement TS-TYPE-001
 *
 * CoreToolScheduler type definitions.
 * These types define the state machine for tool execution.
 */

import type {
  AnyDeclarativeTool,
  AnyToolInvocation,
  ToolCallConfirmationDetails,
} from '../tools/tools.js';
import type {
  ToolCallRequestInfo,
  ToolCallResponseInfo,
} from '../core/turn.js';
import type { ToolConfirmationOutcome } from '../tools/tool-confirmation-types.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';
import type { SerializableConfirmationDetails } from '../confirmation-bus/types.js';

/**
 * @requirement TS-TYPE-001
 * ToolCall State Types - Define the discriminated union for tool execution states
 */

export type ValidatingToolCall = {
  status: 'validating';
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  invocation: AnyToolInvocation;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};

export type ScheduledToolCall = {
  status: 'scheduled';
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  invocation: AnyToolInvocation;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};

export type ExecutingToolCall = {
  status: 'executing';
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  invocation: AnyToolInvocation;
  liveOutput?: string | AnsiOutput;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
  pid?: number;
};

export type SuccessfulToolCall = {
  status: 'success';
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  response: ToolCallResponseInfo;
  invocation: AnyToolInvocation;
  durationMs?: number;
  outcome?: ToolConfirmationOutcome;
};

export type ErroredToolCall = {
  status: 'error';
  request: ToolCallRequestInfo;
  response: ToolCallResponseInfo;
  tool?: AnyDeclarativeTool;
  durationMs?: number;
  outcome?: ToolConfirmationOutcome;
};

export type CancelledToolCall = {
  status: 'cancelled';
  request: ToolCallRequestInfo;
  response: ToolCallResponseInfo;
  tool: AnyDeclarativeTool;
  invocation: AnyToolInvocation;
  durationMs?: number;
  outcome?: ToolConfirmationOutcome;
};

export type WaitingToolCall = {
  status: 'awaiting_approval';
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  invocation: AnyToolInvocation;
  /**
   * Supports both legacy (with callbacks) and new (serializable) details.
   * New code should treat this as SerializableConfirmationDetails.
   *
   * Follow-up (#1569): Remove ToolCallConfirmationDetails and collapse to just
   * SerializableConfirmationDetails after migration.
   */
  confirmationDetails:
    | ToolCallConfirmationDetails
    | SerializableConfirmationDetails;
  // Follow-up (#1569): Make required after migration.
  correlationId?: string;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};

/**
 * @requirement TS-TYPE-001
 * Union Types - Discriminated union of all tool call states
 */

export type ToolCall =
  | ValidatingToolCall
  | ScheduledToolCall
  | ExecutingToolCall
  | SuccessfulToolCall
  | ErroredToolCall
  | CancelledToolCall
  | WaitingToolCall;

export type CompletedToolCall =
  | SuccessfulToolCall
  | CancelledToolCall
  | ErroredToolCall;

export type Status = ToolCall['status'];

/**
 * @requirement TS-TYPE-001
 * Handler Types - Callback function signatures for tool execution events
 */

export type ConfirmHandler = (
  toolCall: WaitingToolCall,
) => Promise<ToolConfirmationOutcome>;

export type OutputUpdateHandler = (
  toolCallId: string,
  outputChunk: string | AnsiOutput,
) => void;

export type AllToolCallsCompleteHandler = (
  completedToolCalls: CompletedToolCall[],
) => Promise<void>;

export type ToolCallsUpdateHandler = (toolCalls: ToolCall[]) => void;

/**
 * @requirement TS-TYPE-001
 * Internal Types - Policy context
 */

export type PolicyContext = {
  toolName: string;
  args: Record<string, unknown>;
  serverName?: string;
};
