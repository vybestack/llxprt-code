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

export interface PolicyFunctionCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}

export interface PolicyToolCallState {
  id?: string;
  name?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ToolCallsUpdateMessage<T = unknown> {
  type: MessageBusType.TOOL_CALLS_UPDATE;
  readonly toolCalls: readonly T[];
}

/**
 * Confirmation outcome enum. Declared as `ToolConfirmationOutcome` so its
 * declaration name matches the structurally-identical enum declared in the
 * telemetry package. TypeScript keys cross-module enum assignability off the
 * declaration name, so sharing the name keeps telemetry event construction
 * (e.g. `new ToolCallEvent(completedToolCall)`) compatible across packages.
 *
 * `ConfirmationOutcome` is exported as a value+type alias for the policy
 * package's public API and internal references.
 */
export enum ToolConfirmationOutcome {
  ProceedOnce = 'proceed_once',
  ProceedAlways = 'proceed_always',
  ProceedAlwaysAndSave = 'proceed_always_and_save',
  ProceedAlwaysServer = 'proceed_always_server',
  ProceedAlwaysTool = 'proceed_always_tool',
  ModifyWithEditor = 'modify_with_editor',
  SuggestEdit = 'suggest_edit',
  Cancel = 'cancel',
}

export const ConfirmationOutcome = ToolConfirmationOutcome;
export type ConfirmationOutcome = ToolConfirmationOutcome;

export interface ConfirmationPayload {
  /**
   * Used to override modified proposed content for modifiable tools in the
   * inline modify flow.
   */
  newContent?: string;

  /**
   * Used to override command text for shell-like tool confirmations.
   */
  editedCommand?: string;
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
  toolCall: PolicyFunctionCall;
  correlationId: string;
  serverName?: string;
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
  outcome?: ConfirmationOutcome;
  /**
   * Optional payload used by inline modify flows.
   */
  payload?: ConfirmationPayload;
  /**
   * Legacy flag maintained for compatibility. New publishers should send a
   * concrete outcome instead.
   */
  confirmed?: boolean;
  requiresUserConfirmation?: boolean;
}

export interface ToolPolicyRejection {
  type: MessageBusType.TOOL_POLICY_REJECTION;
  toolCall: PolicyFunctionCall;
  correlationId: string;
  reason: string;
  serverName?: string;
}

export interface ToolExecutionSuccess {
  type: MessageBusType.TOOL_EXECUTION_SUCCESS;
  toolCall: PolicyFunctionCall;
  correlationId: string;
  result: unknown;
}

export interface ToolExecutionFailure {
  type: MessageBusType.TOOL_EXECUTION_FAILURE;
  toolCall: PolicyFunctionCall;
  correlationId: string;
  error: Error;
}

export interface UpdatePolicy {
  type: MessageBusType.UPDATE_POLICY;
  toolName: string;
  persist?: boolean;
  argsPattern?: string;
  commandPrefix?: string | string[];
  mcpName?: string;
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

export type MessageBusMessage<TToolCall = unknown> =
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
  | ToolCallsUpdateMessage<TToolCall>;

export type ToolConfirmationPayload = ConfirmationPayload;
