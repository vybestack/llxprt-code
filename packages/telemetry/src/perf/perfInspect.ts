/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Perf directory inspection (P11, REQ-3167-8, D7).
 *
 * Surfaces the directory path, schema version, privacy statement, owned JSONL
 * file count / bytes, operation and memory-sample counts, tolerant skipped
 * breakdown, and claim count. Uses real files.
 */

import { promises as fsp } from 'node:fs';
import { PERF_SCHEMA_VERSION } from './perfRecords.js';
import { isClaimFile } from './perfArtifacts.js';
import type { PerfConsumerCounts } from './perfConsumer.js';

/**
 * Counts of lines that were SKIPPED during tolerant reading — every
 * non-parsed line EXCEPT truncated (which is surfaced separately). This
 * deliberately excludes `parsed` (successfully processed records are NOT
 * skipped), so it is a narrower type than {@link PerfReaderCounts}.
 */
export interface PerfSkippedCounts {
  readonly malformed: number;
  readonly futureVersion: number;
  readonly unversioned: number;
  readonly truncated: number;
  readonly blank: number;
}

/** The inspect result. */
export interface PerfInspectResult {
  readonly dir: string;
  readonly schemaVersion: number;
  readonly privacy: {
    readonly localOnly: true;
    readonly defaultOff: true;
    readonly noUpload: true;
    readonly memorySeparatelyOptIn: true;
  };
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly operationCount: number;
  readonly memorySampleCount: number;
  readonly claimCount: number;
  /** Skipped (non-parsed) line counts. Excludes `parsed` (successful records). */
  readonly skipped: PerfSkippedCounts;
  readonly counts: PerfConsumerCounts;
}

function hasErrnoCode(err: unknown, code: string): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === code;
}

/**
 * Inspects a perf directory. A missing directory returns zero counts (it is
 * a valid empty dataset). Other genuine filesystem errors propagate so the
 * caller can fail open.
 */
export async function perfInspect(dir: string): Promise<PerfInspectResult> {
  // Import here to avoid circular deps at module scope.
  const { consumePerfDirectory } = await import('./perfConsumer.js');
  const { entries, counts } = await consumePerfDirectory(dir);

  let operationCount = 0;
  let memorySampleCount = 0;

  for (const ce of entries) {
    if (ce.entry.kind !== 'ok') continue;
    if (ce.entry.record.record_type === 'operation') {
      operationCount += 1;
    } else {
      memorySampleCount += 1;
    }
  }

  // Count claim files separately (the consumer skips them).
  let claimCount = 0;
  try {
    const names = await fsp.readdir(dir);
    claimCount = names.filter(isClaimFile).length;
  } catch (err) {
    if (!hasErrnoCode(err, 'ENOENT')) throw err;
  }

  return {
    dir,
    schemaVersion: PERF_SCHEMA_VERSION,
    privacy: {
      localOnly: true,
      defaultOff: true,
      noUpload: true,
      memorySeparatelyOptIn: true,
    },
    fileCount: counts.files,
    totalBytes: counts.bytes,
    operationCount,
    memorySampleCount,
    claimCount,
    skipped: {
      malformed: counts.malformed,
      futureVersion: counts.futureVersion,
      unversioned: counts.unversioned,
      truncated: counts.truncated,
      blank: counts.blank,
    },
    counts,
  };
}

/**
 * Formats an inspect result into a stable, human-readable string.
 */
export function formatInspect(result: PerfInspectResult): string {
  const lines: string[] = [];

  lines.push('Perf Inspect');
  lines.push('============');
  lines.push('');
  lines.push(`Directory: ${result.dir}`);
  lines.push(`Schema version: ${result.schemaVersion}`);
  lines.push('');
  lines.push('Privacy:');
  lines.push('  local-only (never uploaded)');
  lines.push('  default-off');
  lines.push('  memory collection separately opt-in');
  lines.push('');
  lines.push(`Owned JSONL files: ${result.fileCount}`);
  lines.push(`Total bytes: ${formatBytes(result.totalBytes)}`);
  lines.push(`Claim files: ${result.claimCount}`);
  lines.push('');
  lines.push('Record counts:');
  lines.push(`  operations: ${result.operationCount}`);
  lines.push(`  memory samples: ${result.memorySampleCount}`);
  lines.push('');
  const s = result.skipped;
  lines.push('Skipped breakdown:');
  lines.push(`  malformed: ${s.malformed}`);
  lines.push(`  future version: ${s.futureVersion}`);
  lines.push(`  unversioned: ${s.unversioned}`);
  lines.push(`  truncated: ${s.truncated}`);
  lines.push(`  blank: ${s.blank}`);

  return lines.join('\n');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
