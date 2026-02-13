/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan PLAN-20260211-SESSIONRECORDING.P03
 * @requirement REQ-REC-001, REQ-REC-002
 *
 * Core types for the session recording system. Defines the event envelope,
 * all seven event payload types, and supporting types for replay and session
 * management.
 */

import { type IContent } from '../services/history/IContent.js';

// ---------------------------------------------------------------------------
// Event type discriminator
// ---------------------------------------------------------------------------

/**
 * The seven event types that can appear in a session JSONL file.
 */
export type SessionEventType =
  | 'session_start'
  | 'content'
  | 'compressed'
  | 'rewind'
  | 'provider_switch'
  | 'session_event'
  | 'directories_changed';

// ---------------------------------------------------------------------------
// Event envelope
// ---------------------------------------------------------------------------

/**
 * Every line in a session JSONL file follows this envelope format.
 * The `v` field is the sole schema version indicator.
 */
export interface SessionRecordLine {
  /** Schema version — starts at 1, sole version indicator for the line. */
  v: number;
  /** Monotonically increasing sequence number within the session. */
  seq: number;
  /** ISO-8601 timestamp for human readability (not used for ordering). */
  ts: string;
  /** Event type discriminator. */
  type: SessionEventType;
  /** Type-specific payload. */
  payload: unknown;
}

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

/**
 * Payload for the `session_start` event — always seq=1, first line in file.
 * NOTE: No schema version field here; `v` lives only in the envelope.
 */
export interface SessionStartPayload {
  sessionId: string;
  projectHash: string;
  workspaceDirs: string[];
  provider: string;
  model: string;
  /** ISO-8601 timestamp of when the session started. */
  startTime: string;
}

/**
 * Payload for the `content` event — wraps a single IContent entry.
 */
export interface ContentPayload {
  content: IContent;
}

/**
 * Payload for the `compressed` event — replaces prior content with a summary.
 */
export interface CompressedPayload {
  /** Summary content (speaker: 'ai', text block with summary). */
  summary: IContent;
  /** Number of items that were compressed into the summary. */
  itemsCompressed: number;
}

/**
 * Payload for the `rewind` event — removes the last N items from history.
 */
export interface RewindPayload {
  /** Positive integer — number of items removed from the end of history. */
  itemsRemoved: number;
}

/**
 * Payload for the `provider_switch` event.
 */
export interface ProviderSwitchPayload {
  provider: string;
  model: string;
}

/**
 * Payload for the `session_event` event — operational metadata, not content.
 * Collected in ReplayResult.sessionEvents for audit, NOT added to IContent[].
 */
export interface SessionEventPayload {
  severity: 'info' | 'warning' | 'error';
  message: string;
}

/**
 * Payload for the `directories_changed` event.
 */
export interface DirectoriesChangedPayload {
  directories: string[];
}

// ---------------------------------------------------------------------------
// Service configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for creating a new SessionRecordingService.
 */
export interface SessionRecordingServiceConfig {
  sessionId: string;
  projectHash: string;
  chatsDir: string;
  workspaceDirs: string[];
  provider: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Replay types
// ---------------------------------------------------------------------------

/**
 * Metadata extracted from a session's `session_start` event and updated
 * by subsequent `provider_switch` / `directories_changed` events.
 */
export interface SessionMetadata {
  sessionId: string;
  projectHash: string;
  provider: string;
  model: string;
  workspaceDirs: string[];
  startTime: string;
}

/**
 * Discriminated union result from the replay engine.
 * `ok: true` carries the full replay data; `ok: false` carries an error.
 */
export type ReplayResult =
  | {
      ok: true;
      history: IContent[];
      metadata: SessionMetadata;
      lastSeq: number;
      eventCount: number;
      warnings: string[];
      sessionEvents: SessionEventPayload[];
    }
  | {
      ok: false;
      error: string;
      warnings: string[];
    };

// ---------------------------------------------------------------------------
// Session listing / management
// ---------------------------------------------------------------------------

/**
 * Summary information for a single session file — used by `--list-sessions`.
 */
export interface SessionSummary {
  sessionId: string;
  filePath: string;
  startTime: string;
  lastModified: Date;
  fileSize: number;
  provider: string;
  model: string;
}
