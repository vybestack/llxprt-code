/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ToolResultDisplay,
  ToolCallConfirmationDetails,
} from '@vybestack/llxprt-code-tools';
import type { IContent } from '../services/history/IContent.js';

/**
 * Persisted tool call display information.
 * Matches CLI's IndividualToolCallDisplay interface for type compatibility.
 */
export interface PersistedToolCall {
  /** Unique identifier for the tool call */
  callId: string;
  /** Tool name */
  name: string;
  /** Human-readable description of what the tool is doing */
  description: string;
  /** Tool execution status (string to accept CLI's ToolCallStatus enum) */
  status: string;
  /** Result display for completed tools */
  resultDisplay: ToolResultDisplay | undefined;
  /** Confirmation details for tools requiring user approval */
  confirmationDetails: ToolCallConfirmationDetails | undefined;
  /** Whether to render output as markdown */
  renderOutputAsMarkdown?: boolean;
  /** Whether this tool is currently focused in UI */
  isFocused?: boolean;
}

/**
 * Minimal interface for persisted UI history items.
 * CLI's HistoryItem should satisfy this interface.
 * Uses permissive types since CLI has multiple history types with different shapes.
 */
export interface PersistedUIHistoryItem {
  /** Unique identifier for the history item */
  id: number;
  /** Type discriminator for the history item */
  type: string;
  /** Optional text content (for user/gemini/info/warning/error messages) */
  text?: string;
  /** Optional model identifier (for gemini responses) */
  model?: string;
  /** Optional agent ID (for subagent contexts) */
  agentId?: string;
  /** Optional tools array - shape varies by type (tool_group vs tools_list) */
  tools?: unknown[];
}

/**
 * Persisted session format for --continue functionality
 */
export interface PersistedSession {
  /** Schema version for future migrations */
  version: number;
  /** Monotonic save generation. Absent in legacy persisted sessions. */
  generation?: number;
  /** Unique session identifier */
  sessionId: string;
  /** Hash of project root for validation */
  projectHash: string;
  /** When session was created */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Full conversation history (core format) */
  history: IContent[];
  /** UI history items for display restoration (preserves exactly what user sees) */
  uiHistory?: PersistedUIHistoryItem[];
  /** Optional metadata */
  metadata?: {
    provider?: string;
    model?: string;
    tokenCount?: number;
  };
}
