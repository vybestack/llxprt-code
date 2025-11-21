import type { FunctionCall } from '@google/genai';
import type {
  ToolConfirmationOutcome,
  ToolConfirmationPayload,
} from '../tools/tool-confirmation-types.js';

export enum MessageBusType {
  TOOL_CONFIRMATION_REQUEST = 'tool-confirmation-request',
  TOOL_CONFIRMATION_RESPONSE = 'tool-confirmation-response',
  TOOL_POLICY_REJECTION = 'tool-policy-rejection',
  TOOL_EXECUTION_SUCCESS = 'tool-execution-success',
  TOOL_EXECUTION_FAILURE = 'tool-execution-failure',
  UPDATE_POLICY = 'update-policy',
}

export interface ToolConfirmationRequest {
  type: MessageBusType.TOOL_CONFIRMATION_REQUEST;
  toolCall: FunctionCall;
  correlationId: string;
  serverName?: string; // For MCP tool spoofing prevention
}

export interface ToolConfirmationResponse {
  type: MessageBusType.TOOL_CONFIRMATION_RESPONSE;
  correlationId: string;
  /**
   * Complete enum outcome preferred for consumers. When omitted, fall back to
   * the legacy `confirmed` boolean semantics.
   */
  outcome?: ToolConfirmationOutcome;
  /**
   * Optional payload used by inline modify flows.
   */
  payload?: ToolConfirmationPayload;
  /**
   * Legacy flag maintained for compatibility. New publishers should send a
   * concrete outcome instead.
   */
  confirmed?: boolean;
  requiresUserConfirmation?: boolean; // When true, use legacy UI
}

export interface ToolPolicyRejection {
  type: MessageBusType.TOOL_POLICY_REJECTION;
  toolCall: FunctionCall;
  correlationId: string;
  reason: string;
  serverName?: string;
}

export interface ToolExecutionSuccess {
  type: MessageBusType.TOOL_EXECUTION_SUCCESS;
  toolCall: FunctionCall;
  correlationId: string;
  result: unknown;
}

export interface ToolExecutionFailure {
  type: MessageBusType.TOOL_EXECUTION_FAILURE;
  toolCall: FunctionCall;
  correlationId: string;
  error: Error;
}

export interface UpdatePolicy {
  type: MessageBusType.UPDATE_POLICY;
  toolName: string;
}

export type MessageBusMessage =
  | ToolConfirmationRequest
  | ToolConfirmationResponse
  | ToolPolicyRejection
  | ToolExecutionSuccess
  | ToolExecutionFailure
  | UpdatePolicy;
