import type { FunctionCall } from '@google/genai';
import type {
  ToolConfirmationOutcome,
  ToolConfirmationPayload,
} from '../tools/tool-confirmation-types.js';
import type { ToolCall } from '../scheduler/types.js';

export enum MessageBusType {
  TOOL_CONFIRMATION_REQUEST = 'tool-confirmation-request',
  TOOL_CONFIRMATION_RESPONSE = 'tool-confirmation-response',
  TOOL_POLICY_REJECTION = 'tool-policy-rejection',
  TOOL_EXECUTION_SUCCESS = 'tool-execution-success',
  TOOL_EXECUTION_FAILURE = 'tool-execution-failure',
  UPDATE_POLICY = 'update-policy',
  BUCKET_AUTH_CONFIRMATION_REQUEST = 'bucket-auth-confirmation-request',
  BUCKET_AUTH_CONFIRMATION_RESPONSE = 'bucket-auth-confirmation-response',
  HOOK_EXECUTION_REQUEST = 'HOOK_EXECUTION_REQUEST',
  HOOK_EXECUTION_RESPONSE = 'HOOK_EXECUTION_RESPONSE',
  TOOL_CALLS_UPDATE = 'tool-calls-update',
}

export interface ToolCallsUpdateMessage {
  type: MessageBusType.TOOL_CALLS_UPDATE;
  readonly toolCalls: readonly ToolCall[];
}

/**
 * Data-only versions of ToolCallConfirmationDetails for bus transmission.
 */
export type SerializableConfirmationDetails =
  | { type: 'info'; title: string; prompt: string; urls?: string[] }
  | {
      type: 'edit';
      title: string;
      fileName: string;
      filePath: string;
      fileDiff: string;
      originalContent: string | null;
      newContent: string;
    }
  | {
      type: 'exec';
      title: string;
      command: string;
      rootCommand: string;
      rootCommands: string[];
    }
  | {
      type: 'mcp';
      title: string;
      serverName: string;
      toolName: string;
      toolDisplayName: string;
    };

export interface ToolConfirmationRequest {
  type: MessageBusType.TOOL_CONFIRMATION_REQUEST;
  toolCall: FunctionCall;
  correlationId: string;
  serverName?: string; // For MCP tool spoofing prevention
  /**
   * Optional rich details for the confirmation UI (diffs, counts, etc.)
   */
  details?: SerializableConfirmationDetails;
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
  persist?: boolean; // NEW: When true, save to TOML
  argsPattern?: string; // NEW: Regex pattern for tool args
  commandPrefix?: string | string[]; // NEW: Shell command prefix (e.g., "git status")
  mcpName?: string; // NEW: MCP server name
}

/**
 * Request to confirm OAuth bucket authentication
 */
export interface BucketAuthConfirmationRequest {
  type: MessageBusType.BUCKET_AUTH_CONFIRMATION_REQUEST;
  correlationId: string;
  provider: string;
  bucket: string;
  bucketIndex: number;
  totalBuckets: number;
}

/**
 * Response to bucket auth confirmation request
 */
export interface BucketAuthConfirmationResponse {
  type: MessageBusType.BUCKET_AUTH_CONFIRMATION_RESPONSE;
  correlationId: string;
  confirmed: boolean;
}

export interface HookExecutionRequest {
  type: MessageBusType.HOOK_EXECUTION_REQUEST;
  payload: { eventName: string; correlationId: string };
}

export interface HookExecutionResponse {
  type: MessageBusType.HOOK_EXECUTION_RESPONSE;
  payload: { correlationId: string };
}

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
