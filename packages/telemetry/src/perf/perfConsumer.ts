/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cross-platform directory streaming consumer for the perf JSONL directory
 * (P11, REQ-3167-9).
 *
 * Reads sorted `perf-*.jsonl` files one at a time (no gzip, no shell pipeline,
 * no argument-limit breakage). Each yielded entry carries source-file / run-UUID
 * identity so the report computes per-file memory slopes and never accidentally
 * pools data across process uptimes / session indices.
 *
 * A missing directory is an empty dataset (fail open). Other genuine filesystem
 * errors propagate so the caller (report / inspect / delete) can fail open at
 * the external-inspection boundary and reflect the error in self-health.
 *
 * The consumer does NOT parse claim files.
 */

import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { streamPerfRecords, type PerfStreamEntry } from './perfRecords.js';
import { isPerfJsonl, extractRunUuid } from './perfArtifacts.js';

/**
 * A classified perf line annotated with its source file and run-UUID identity.
 * The run UUID is parsed from the filename (`perf-YYYYMMDD-<uuid>.jsonl`) so
 * memory slopes can be computed per run/file without pooling.
 */
export interface PerfConsumerEntry {
  readonly entry: PerfStreamEntry;
  readonly sourceFile: string;
  readonly runUuid: string;
}

/**
 * Aggregate counters across all files in the directory. Extends the per-file
 * reader counts with file/byte totals for the inspect surface.
 */
export interface PerfConsumerCounts {
  readonly parsed: number;
  readonly malformed: number;
  readonly futureVersion: number;
  readonly unversioned: number;
  readonly truncated: number;
  readonly blank: number;
  readonly files: number;
  readonly bytes: number;
}

export interface PerfConsumerResult {
  readonly entries: readonly PerfConsumerEntry[];
  readonly counts: PerfConsumerCounts;
}

/**
 * Returns true if an error carries the given Node errno code.
 */
function hasErrnoCode(err: unknown, code: string): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === code;
}

/**
 * Extracts the run UUID from a perf JSONL filename, throwing on null.
 *
 * `streamPerfDirectory`/`consumePerfDirectory` only enumerate names that pass
 * `isPerfJsonl`, so `extractRunUuid` can never legitimately return null here.
 * A null result is an internal invariant violation (a name slipped through that
 * does not match `perf-YYYYMMDD-<uuid>.jsonl`) and must fail fast rather than
 * be masked by an invented `unknown` identity.
 */
function requireRunUuid(name: string): string {
  const uuid = extractRunUuid(name);
  if (uuid === null) {
    throw new Error(
      `Internal invariant violation: extractRunUuid returned null for perf JSONL name '${name}'`,
    );
  }
  return uuid;
}

interface PerfFileInfo {
  readonly name: string;
  readonly path: string;
  readonly bytes: number;
}

/**
 * Lists sorted `perf-*.jsonl` files in a directory, returning name + path +
 * byte size. A missing directory (ENOENT) yields nothing — an empty dataset.
 * Other errors propagate.
 */
async function* listPerfFiles(dir: string): AsyncGenerator<PerfFileInfo> {
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch (err) {
    if (hasErrnoCode(err, 'ENOENT')) return; // missing dir = empty dataset
    throw err;
  }

  const sorted = names.filter(isPerfJsonl).sort();
  for (const name of sorted) {
    const filePath = join(dir, name);
    let bytes = 0;
    try {
      const stat = await fsp.stat(filePath);
      bytes = stat.size;
    } catch (err) {
      if (!hasErrnoCode(err, 'ENOENT')) throw err;
      // ENOENT race (file deleted between readdir and stat) — skip.
      continue;
    }
    yield { name, path: filePath, bytes };
  }
}

/**
 * Streams perf consumer entries from all `perf-*.jsonl` files in a directory,
 * one file at a time. Each entry carries its source file name and run UUID.
 *
 * A missing directory yields nothing (empty dataset). Other genuine filesystem
 * errors propagate.
 */
export async function* streamPerfDirectory(
  dir: string,
): AsyncGenerator<PerfConsumerEntry> {
  for await (const file of listPerfFiles(dir)) {
    const runUuid = requireRunUuid(file.name);
    for await (const entry of streamPerfRecords(file.path)) {
      yield { entry, sourceFile: file.name, runUuid };
    }
  }
}

/**
 * Accumulating directory consumer: streams all `perf-*.jsonl` files and
 * accumulates every parsed entry with aggregate counts. This is NOT an
 * algorithmically bounded collector — it retains all entries in memory so the
 * report can group and compute p50/slopes across the full dataset. A bounded
 * variant would lose the longitudinal comparison the report needs.
 *
 * Missing directory = empty result. Other genuine filesystem errors
 * propagate.
 */
export async function consumePerfDirectory(
  dir: string,
): Promise<PerfConsumerResult> {
  const entries: PerfConsumerEntry[] = [];
  let parsed = 0;
  let malformed = 0;
  let futureVersion = 0;
  let unversioned = 0;
  let truncated = 0;
  let blank = 0;
  let files = 0;
  let bytes = 0;

  for await (const file of listPerfFiles(dir)) {
    files += 1;
    bytes += file.bytes;
    const runUuid = requireRunUuid(file.name);
    for await (const entry of streamPerfRecords(file.path)) {
      entries.push({ entry, sourceFile: file.name, runUuid });
      switch (entry.kind) {
        case 'ok':
          parsed += 1;
          break;
        case 'malformed':
          malformed += 1;
          break;
        case 'future_version':
          futureVersion += 1;
          break;
        case 'unversioned':
          unversioned += 1;
          break;
        case 'truncated':
          truncated += 1;
          break;
        case 'blank':
          blank += 1;
          break;
        default: {
          const _exhaustive: never = entry;
          throw new Error(
            `Internal invariant violation: unhandled PerfStreamEntry kind: ${JSON.stringify(_exhaustive)}`,
          );
        }
      }
    }
  }

  return {
    entries,
    counts: {
      parsed,
      malformed,
      futureVersion,
      unversioned,
      truncated,
      blank,
      files,
      bytes,
    },
  };
}
