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

export const SESSION_TITLE_MAX_LENGTH = 120;

// ---------------------------------------------------------------------------
// Event type discriminator
// ---------------------------------------------------------------------------

/**
 * The event types that can appear in a session JSONL file.
 *
 * Metadata event types (`checkpoint_created`, `checkpoint_renamed`,
 * `checkpoint_deleted`, `session_forked`, `session_named`) never appear in
 * model history. They are folded by {@link foldCheckpointMetadata} and surfaced
 * separately from `IContent[]` in the replay result.
 */
export type SessionEventType =
  | 'session_start'
  | 'content'
  | 'compressed'
  | 'rewind'
  | 'provider_switch'
  | 'session_event'
  | 'session_metadata'
  | 'directories_changed'
  | 'checkpoint_created'
  | 'checkpoint_renamed'
  | 'checkpoint_deleted'
  | 'session_forked'
  | 'session_named';

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
  /** Effective absolute working directory, when recorded by newer clients. */
  cwd?: string;
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
 * Payload for the `session_metadata` event — session-level metadata updates
 * (currently only the human-readable title). The title is tri-state:
 * - `undefined` (field absent): legacy event, no title assertion.
 * - `null`: explicit untitled (the caller asserts there is no meaningful title).
 * - `string`: a concrete title.
 *
 * This is a typed first-class recording event, NOT a `session_event` sentinel.
 */
export interface SessionMetadataPayload {
  readonly title?: string | null;
}

/**
 * Payload for the `directories_changed` event.
 */
export interface DirectoriesChangedPayload {
  directories: string[];
}

// ---------------------------------------------------------------------------
// Checkpoint and session-branching metadata event payloads.
//
// These metadata events are append-only and never enter model history.
// Checkpoint lifecycle is folded by stable `checkpointId`, not mutable name.
// ---------------------------------------------------------------------------

/** Payload for `checkpoint_created` — the envelope `seq` is the branch watermark. */
export interface CheckpointCreatedPayload {
  checkpointId: string;
  name: string;
}

/** Payload for `checkpoint_renamed` — display metadata only; ID/watermark fixed. */
export interface CheckpointRenamedPayload {
  checkpointId: string;
  name: string;
}

/** Payload for `checkpoint_deleted` — tombstones the reference only. */
export interface CheckpointDeletedPayload {
  checkpointId: string;
}

/**
 * Payload for `session_forked` — records ancestry in a self-contained child.
 * The child does not depend on the parent file for future replay.
 */
export interface SessionForkedPayload {
  parentSessionId: string;
  parentSequence: number;
  checkpointId: string;
  checkpointName: string;
}

/** Payload for `session_named` — `null` clears the mutable session name. */
export interface SessionNamedPayload {
  name: string | null;
}

// ---------------------------------------------------------------------------
// Folded metadata views
// ---------------------------------------------------------------------------

/**
 * Folded view of a checkpoint after applying all lifecycle events.
 * `sequence` is the envelope `seq` of `checkpoint_created` and is the
 * inclusive branch watermark for replay-through-sequence.
 */
export interface CheckpointMetadataView {
  readonly checkpointId: string;
  readonly name: string;
  readonly sequence: number;
  readonly deleted: boolean;
  readonly createdAt: string;
}

/** Lightweight checkpoint info returned by lifecycle operations. */
export interface RecordingCheckpointInfo {
  readonly checkpointId: string;
  readonly name: string;
  readonly sequence: number;
}

/** Lightweight session info returned by session management operations. */
export interface SessionInfo {
  readonly sessionId: string;
  readonly name: string | null;
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
  /** Effective absolute working directory for lifecycle discovery. */
  cwd?: string;
  provider: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Replay types
// ---------------------------------------------------------------------------

/**
 * Metadata extracted from a session's `session_start` event and updated
 * by subsequent `provider_switch` / `directories_changed` / `session_metadata`
 * events.
 *
 * The title is tri-state:
 * - `undefined`: no `session_metadata` event seen (legacy file). Callers fall
 *   back to first-human-text heuristics.
 * - `null`: explicit untitled (`session_metadata` asserted no title).
 * - `string`: a concrete title.
 */
export interface SessionMetadata {
  sessionId: string;
  projectHash: string;
  provider: string;
  model: string;
  workspaceDirs: string[];
  cwd?: string;
  startTime: string;
  title?: string | null;
}

/**
 * Discriminated union result from the replay engine.
 * `ok: true` carries the full replay data; `ok: false` carries an error.
 *
 * `checkpoints` and `sessionName` are folded from metadata events and never
 * appear in `history`.
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
      /** Checkpoints folded from lifecycle metadata events. */
      checkpoints?: readonly CheckpointMetadataView[];
      /** Mutable session name from the most recent `session_named` event. */
      sessionName?: string | null;
      /** Self-contained child ancestry from the `session_forked` event. */
      ancestry?: SessionForkedPayload;
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
 * Summary information for a single session file — used by `--list-sessions`
 * and session discovery/resume.
 */
export interface SessionSummary {
  sessionId: string;
  filePath: string;
  projectHash: string;
  startTime: string;
  lastModified: Date;
  fileSize: number;
  provider: string;
  model: string;
  cwd?: string;
  /**
   * Tri-state title from a persisted `session_metadata` event:
   * - `undefined`: no `session_metadata` event seen (legacy fallback).
   * - `null`: explicit untitled.
   * - `string`: a concrete title.
   */
  title?: string | null;
  /**
   * Immutable creation timestamp extracted from `session_start.startTime`.
   * Used for stable ordering independent of file `lastModified` mutations.
   */
  createdAt?: string;
  name?: string | null;
}

export type ContinueTarget =
  | { kind: 'session'; session: SessionSummary }
  | {
      kind: 'checkpoint';
      source: SessionSummary;
      checkpointId: string;
      checkpointName: string;
      sequence: number;
    };

export interface ContinueResolution {
  target: ContinueTarget;
}
