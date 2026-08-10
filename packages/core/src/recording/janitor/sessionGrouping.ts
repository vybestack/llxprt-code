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
 * Logical session grouping and eligibility for the janitor (findings B, C).
 *
 * A {@link SessionGroup} deduplicates a transient raw+archive pair that
 * represent the same logical session, so the corpus is never double-counted
 * for age/count ranking (finding B).  Group identity is derived from the
 * chats directory and the shared base name (`session-<id>.jsonl`), where an
 * archive's base name is its file name without the trailing `.gz`.
 *
 * The group's recording time is the **original** session age (oldest file),
 * which is preserved on the gzip archive by the compressor (finding C).  This
 * lets `minRetention` apply to archives by original age rather than by the
 * moment they were compressed.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ResolvedRetentionConfig,
  SessionCandidate,
} from './cleanupTypes.js';
import { SessionLockManager } from '../SessionLockManager.js';

/** Archive file-name suffix. */
const ARCHIVE_SUFFIX = '.jsonl.gz';

/** Base JSONL suffix shared by both raw and archive file names. */
const JSONL_SUFFIX = '.jsonl';

/** Compression-suffix length derived from the shared suffix constants. */
const COMPRESSION_SUFFIX_LEN = ARCHIVE_SUFFIX.length - JSONL_SUFFIX.length;

/**
 * A logical session: at most one raw recording and at most one cold archive
 * for the same base name within the same chats directory.
 */
export interface SessionGroup {
  /** Stable identity: `<chatsDir>|<baseName>`. */
  readonly sessionKey: string;
  readonly chatsDir: string;
  /** `session-<id>.jsonl` (archive base name strips the `.gz`). */
  readonly baseName: string;
  readonly projectHashDir: string;
  readonly raw: SessionCandidate | null;
  readonly archive: SessionCandidate | null;
  /** Original recording time (oldest member mtime) — drives age ranking. */
  readonly mtime: Date;
  /** Session ID from the raw header, or `null` when only an unreadable/raw-less group exists. */
  readonly sessionId: string | null;
  /** Aggregate physical bytes of all group files. */
  readonly sizeBytes: number;
  readonly isCurrentSession: boolean;
}

/** Lexically normalize a path for deterministic comparison (finding C). */
export function normalizedPath(filePath: string): string {
  return path.normalize(filePath);
}

/** The canonical representative file path of a group (for tie-breaking). */
function representativePath(group: SessionGroup): string {
  return group.archive?.filePath ?? group.raw?.filePath ?? '';
}

/**
 * Deterministic oldest-first comparison.  Primary key is the original
 * recording mtime; the tie-break is the normalized representative file path,
 * which encodes project hash + full path + filename (finding C).
 */
export function compareGroupsOldestFirst(
  a: SessionGroup,
  b: SessionGroup,
): number {
  const mtimeDiff = a.mtime.getTime() - b.mtime.getTime();
  if (mtimeDiff !== 0) return mtimeDiff;
  return normalizedPath(representativePath(a)).localeCompare(
    normalizedPath(representativePath(b)),
  );
}

/** Newest-first comparison (mirror of {@link compareGroupsOldestFirst}). */
export function compareGroupsNewestFirst(
  a: SessionGroup,
  b: SessionGroup,
): number {
  return compareGroupsOldestFirst(b, a);
}

/** Strip the trailing compression suffix from an archive file name to recover the base name. */
function baseNameOf(candidate: SessionCandidate): string {
  return candidate.kind === 'archive' &&
    candidate.fileName.endsWith(ARCHIVE_SUFFIX)
    ? candidate.fileName.slice(0, -COMPRESSION_SUFFIX_LEN)
    : candidate.fileName;
}

/** Compute the chats directory that owns a candidate. */
function chatsDirOf(candidate: SessionCandidate): string {
  return candidate.kind === 'archive'
    ? path.dirname(candidate.containerDir)
    : candidate.containerDir;
}

/**
 * Build logical session groups from scanned candidates, deduplicating a
 * transient raw+archive pair into a single group (finding B: avoid
 * double-counting).
 */
export function buildSessionGroups(
  candidates: readonly SessionCandidate[],
): SessionGroup[] {
  const byKey = new Map<string, SessionGroupBuilder>();
  for (const candidate of candidates) {
    const chatsDir = chatsDirOf(candidate);
    const baseName = baseNameOf(candidate);
    const sessionKey = chatsDir + '|' + baseName;
    let builder = byKey.get(sessionKey);
    if (builder === undefined) {
      builder = {
        sessionKey,
        chatsDir,
        baseName,
        projectHashDir: candidate.projectHashDir,
        raw: null,
        archive: null,
      };
      byKey.set(sessionKey, builder);
    }
    if (candidate.kind === 'raw') {
      builder.raw = candidate;
    } else {
      builder.archive = candidate;
    }
  }

  const groups: SessionGroup[] = [];
  for (const builder of byKey.values()) {
    const raw = builder.raw;
    const archive = builder.archive;
    const times: number[] = [];
    if (raw) times.push(raw.mtime.getTime());
    if (archive) times.push(archive.mtime.getTime());
    const mtime = new Date(Math.min(...times));
    const sizeBytes = (raw?.sizeBytes ?? 0) + (archive?.sizeBytes ?? 0);
    const sessionId = raw?.sessionId ?? null;
    const isCurrentSession = raw?.isCurrentSession === true;
    groups.push({
      sessionKey: builder.sessionKey,
      chatsDir: builder.chatsDir,
      baseName: builder.baseName,
      projectHashDir: builder.projectHashDir,
      raw,
      archive,
      mtime,
      sessionId,
      sizeBytes,
      isCurrentSession,
    });
  }
  return groups;
}

interface SessionGroupBuilder {
  readonly sessionKey: string;
  readonly chatsDir: string;
  readonly baseName: string;
  readonly projectHashDir: string;
  raw: SessionCandidate | null;
  archive: SessionCandidate | null;
}

type Eligibility = 'eligible' | 'protected';

/**
 * Evaluate whether a group is eligible for any mutation.  Protected groups
 * are retained and (when they breach an explicit limit) counted as a
 * shortfall (finding B/G).
 *
 * Protection reasons (AC-7): the current session, a live lock on the raw,
 * age below the `minRetention` floor (by original session age), or a raw
 * whose session identity cannot be established.
 */
export async function evaluateGroupEligibility(
  group: SessionGroup,
  config: ResolvedRetentionConfig,
): Promise<Eligibility> {
  if (group.isCurrentSession) return 'protected';

  if (group.raw !== null) {
    // A raw whose identity cannot be established is unreadable/protected.
    if (group.sessionId === null) return 'protected';
    if (await isProtectedByLiveLock(group)) return 'protected';
  }

  // minRetention applies to archives too, by original session age (finding C).
  if (Date.now() - group.mtime.getTime() < config.minRetentionMs) {
    return 'protected';
  }
  return 'eligible';
}

/** Return true when the group's raw holds a non-stale session lock (AC-7). */
async function isProtectedByLiveLock(group: SessionGroup): Promise<boolean> {
  if (group.raw === null || group.sessionId === null) return false;
  // getLockPath performs synchronous session-ID validation and can throw.
  // Any validation/path error must fail toward retaining data (AC-7).
  let lockPath: string;
  try {
    lockPath = SessionLockManager.getLockPath(group.chatsDir, group.sessionId);
  } catch {
    return true;
  }
  try {
    await fs.access(lockPath);
  } catch {
    return false;
  }
  try {
    const isStale = await SessionLockManager.checkStaleWithPidReuse(lockPath);
    return !isStale;
  } catch {
    // Can't determine lock status — fail toward retaining (AC-7).
    return true;
  }
}
