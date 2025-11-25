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
 * Base message record structure (minimal for session cleanup purposes)
 */
export interface BaseMessageRecord {
  timestamp: string;
  role: 'user' | 'model';
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
