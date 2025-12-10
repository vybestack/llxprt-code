/**
 * Event types for the adapter layer between llxprt-code-core and nui UI.
 * These represent the streaming events that the UI understands.
 */

export interface TextDeltaEvent {
  readonly type: 'text_delta';
  readonly text: string;
}

export interface ThinkingDeltaEvent {
  readonly type: 'thinking_delta';
  readonly text: string;
}

export type ToolStatus =
  | 'pending'
  | 'executing'
  | 'complete'
  | 'error'
  | 'confirming'
  | 'cancelled';

export interface ToolPendingEvent {
  readonly type: 'tool_pending';
  readonly id: string;
  readonly name: string;
  readonly params: Record<string, unknown>;
}

export type ToolConfirmationType = 'edit' | 'exec' | 'mcp' | 'info';

export interface ToolConfirmationEvent {
  readonly type: 'tool_confirmation';
  readonly id: string;
  readonly name: string;
  readonly params: Record<string, unknown>;
  readonly confirmationType: ToolConfirmationType;
  /** Human-readable question for the user */
  readonly question: string;
  /** Preview content (command, file diff, etc.) */
  readonly preview: string;
  /** Whether "always allow" options should be shown */
  readonly canAllowAlways: boolean;
  /** Correlation ID for MessageBus response */
  readonly correlationId: string;
}

export interface ToolResultEvent {
  readonly type: 'tool_result';
  readonly id: string;
  readonly success: boolean;
  /** Display output from the tool */
  readonly output: string;
  /** Error message if failed */
  readonly errorMessage?: string;
}

export interface ToolCancelledEvent {
  readonly type: 'tool_cancelled';
  readonly id: string;
}

export interface CompleteEvent {
  readonly type: 'complete';
}

export interface ErrorEvent {
  readonly type: 'error';
  readonly message: string;
}

export interface UnknownEvent {
  readonly type: 'unknown';
  readonly raw: unknown;
}

export type AdapterEvent =
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | ToolPendingEvent
  | ToolConfirmationEvent
  | ToolResultEvent
  | ToolCancelledEvent
  | CompleteEvent
  | ErrorEvent
  | UnknownEvent;
