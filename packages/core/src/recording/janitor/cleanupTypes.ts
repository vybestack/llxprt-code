/**
 * Copyright 2026 Vybestack LLC
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
 * Shared types for the session-recording janitor.
 *
 * The janitor discovers, evaluates, losslessly archives, and evicts inactive
 * session recordings across all project hash directories under the global temp
 * root to enforce a machine-wide size budget.
 */

/**
 * User-facing retention settings.  Fields are all optional; the janitor
 * resolves them against built-in defaults at the consumer so a partial object
 * cannot accidentally remove default-on size bounding.
 *
 * This mirrors the CLI-side `SessionRetentionSettings` but lives in the core
 * package so the janitor has no upward dependency on the CLI.
 */
export interface UserRetentionSettings {
  /** When explicitly `false`, all janitorial filesystem mutations are disabled. */
  enabled?: boolean;
  /** Maximum age of sessions to keep (e.g. "30d", "7d", "24h", "1w"). */
  maxAge?: string;
  /** Maximum number of recordings to keep (most recent first). */
  maxCount?: number;
  /** Minimum retention safety floor (defaults to "1d"). */
  minRetention?: string;
  /** Machine-wide aggregate size limit in MiB (defaults to 4096 = 4 GiB). */
  maxTotalSizeMB?: number;
}

/**
 * Fully resolved retention configuration.  Every numeric field is concrete;
 * `maxAgeMs` / `maxCount` are `null` when no user limit was supplied (meaning
 * "no limit"), which differs from `undefined` so callers can distinguish
 * "resolved to no limit" from "not yet resolved".
 */
export interface ResolvedRetentionConfig {
  readonly enabled: boolean;
  readonly maxTotalSizeBytes: number;
  readonly maxAgeMs: number | null;
  readonly maxCount: number | null;
  readonly minRetentionMs: number;
}

/** Kind of physical file a candidate represents. */
export type CandidateKind = 'raw' | 'archive';

/**
 * A discovered session recording (raw JSONL or cold gzip archive) with the
 * metadata the janitor needs for eligibility evaluation and safe deletion.
 */
export interface SessionCandidate {
  readonly kind: CandidateKind;
  /** Absolute path to the file. */
  readonly filePath: string;
  /** Bare filename inside the chats/archive directory. */
  readonly fileName: string;
  /** Absolute path of the chats or archive directory containing this file. */
  readonly containerDir: string;
  /** 64-hex project-hash directory name (the direct child of global temp). */
  readonly projectHashDir: string;
  /** Session ID extracted from the header, or `null` when unreadable. */
  readonly sessionId: string | null;
  /** True when this recording belongs to the current process's session. */
  readonly isCurrentSession: boolean;
  /** Physical size on disk in bytes (file length, or allocated blocks when available). */
  readonly sizeBytes: number;
  /** File modification time. */
  readonly mtime: Date;
  /** Device ID from scan-time lstat (used for mutation-time identity re-check). */
  readonly dev: number;
  /** Inode number from scan-time lstat (used for mutation-time identity re-check). */
  readonly ino: number;
}

/**
 * Structured result of a cleanup sweep, carrying enough information to prove
 * and diagnose behaviour.
 */
export interface SessionCleanupResult {
  /** True when cleanup was disabled by configuration. */
  readonly disabled: boolean;
  /** True when this process acquired the global janitor lease and ran the sweep. */
  readonly janitorWonLease: boolean;
  /** Total recordings scanned (raw + archive). */
  readonly scanned: number;
  /** Raw JSONL recordings compressed into cold archives. */
  readonly archived: number;
  /** Raw JSONL recordings deleted (after archival or direct eviction). */
  readonly rawDeleted: number;
  /** Cold archive files deleted. */
  readonly archiveDeleted: number;
  /** Stale session lock files removed. */
  readonly staleLocksRemoved: number;
  /** Candidates retained because they were protected (current/live/recent/unreadable). */
  readonly skipped: number;
  /** Candidates the janitor failed to process (filesystem errors etc.). */
  readonly failed: number;
  /**
   * Number of sessions that breach an explicit age/count limit but are
   * retained because they are protected (current/live/recent/unreadable).
   * Protected entries count toward the configured limit yet remain retained,
   * creating and reporting this shortfall (finding B/G).  Zero when no
   * explicit age/count limit is configured.
   */
  readonly ageCountShortfall: number;
  /** Aggregate physical bytes before the sweep. */
  readonly bytesBefore: number;
  /** Aggregate physical bytes after the sweep. */
  readonly bytesAfter: number;
  /** Configured aggregate byte limit. */
  readonly configuredByteLimit: number;
  /** Remaining over-budget bytes that could not be reclaimed because data is protected. */
  readonly overBudgetBytes: number;
}
