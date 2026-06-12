/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260609-ISSUE1591.P10d
 * @requirement REQ-008.2
 * Backward-compatible re-export shim. The confirmation bus now lives in
 * `@vybestack/llxprt-code-policy`. Core retains this module so existing deep
 * imports (`../confirmation-bus/types.js`) keep working, and specializes the
 * generic `ToolCallsUpdateMessage` / `MessageBusMessage` with core's own
 * `ToolCall` type for ergonomic consumption inside core.
 */
import type {
  ToolCallsUpdateMessage as PolicyToolCallsUpdateMessage,
  ToolConfirmationRequest,
  ToolConfirmationResponse,
  ToolPolicyRejection,
  ToolExecutionSuccess,
  ToolExecutionFailure,
  UpdatePolicy,
  BucketAuthConfirmationRequest,
  BucketAuthConfirmationResponse,
  HookExecutionRequest,
  HookExecutionResponse,
} from '@vybestack/llxprt-code-policy';
import type { ToolCall } from '../scheduler/types.js';

export {
  MessageBusType,
  type SerializableConfirmationDetails,
  type ToolConfirmationRequest,
  type ToolConfirmationResponse,
  type ToolPolicyRejection,
  type ToolExecutionSuccess,
  type ToolExecutionFailure,
  type UpdatePolicy,
  type BucketAuthConfirmationRequest,
  type BucketAuthConfirmationResponse,
  type HookExecutionRequest,
  type HookExecutionResponse,
} from '@vybestack/llxprt-code-policy';

/**
 * Core-specialized tool-calls update message. The policy package defines this
 * generically; core narrows it to its own `ToolCall` shape.
 */
export type ToolCallsUpdateMessage = PolicyToolCallsUpdateMessage<ToolCall>;

/**
 * Core-specialized message union that uses the core `ToolCall` for the
 * tool-calls update variant.
 */
export type MessageBusMessage =
  | ToolConfirmationRequest
  | ToolConfirmationResponse
  | ToolPolicyRejection
  | ToolExecutionSuccess
  | ToolExecutionFailure
  | UpdatePolicy
  | BucketAuthConfirmationRequest
  | BucketAuthConfirmationResponse
  | HookExecutionRequest
  | HookExecutionResponse
  | ToolCallsUpdateMessage;
