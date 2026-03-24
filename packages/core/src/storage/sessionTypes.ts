/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Session file naming prefix
 */
export const SESSION_FILE_PREFIX = 'session-';

/**
 * Recorded tool call within a message (minimal for rewind purposes)
 */
export interface ToolCallRecord {
  toolName: string;
  args?: Record<string, unknown>;
  resultDisplay?: unknown;
}

/**
 * Base message record structure (minimal for session cleanup purposes)
 */
export interface BaseMessageRecord {
  id?: string;
  timestamp: string;
  role: 'user' | 'model';
  type?: string;
  content?: string;
  toolCalls?: ToolCallRecord[];
}

/**
 * Conversation record structure (minimal for session cleanup purposes)
 */
export interface ConversationRecord {
  id: string;
  sessionId: string;
  timestamp: string;
  startTime: string;
  lastUpdated?: string;
  messages: BaseMessageRecord[];
}
