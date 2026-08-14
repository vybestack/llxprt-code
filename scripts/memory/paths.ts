/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resolution of run directories and samples files for the request CLI,
 * reporter, and launcher, plus the shared on-disk layout names.
 *
 * The filesystem and path-join operations are injectable so resolution can be
 * exercised against temp fixtures and with Windows (win32) path semantics on
 * any host platform.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import * as nodePath from 'node:path';
import {
  type LeaseCheck,
  type LeaseDeps,
  type LeaseStatus,
  checkLease,
  defaultLeaseDeps,
} from './lease.ts';

/** Root directory (under the repo) holding all profiling runs. */
export const MEMPROFILE_DIR_NAME = '.memprofile';

/** Name of the pointer file inside the memprofile root naming the newest run. */
export const LATEST_POINTER_NAME = 'latest';

/** Name of the JSONL samples file inside a run directory. */
export const SAMPLES_FILE_NAME = 'samples.jsonl';

/** Name of the probe's diagnostics log inside a run directory. */
export const PROBE_LOG_NAME = 'probe.log';

/** Name of the snapshot subdirectory inside a run directory. */
export const SNAPSHOT_DIR_NAME = 'snapshots';

export interface PathDeps {
  readonly exists: (path: string) => boolean;
  readonly isDirectory: (path: string) => boolean;
  readonly readFile: (path: string) => string;
  readonly join: (...segments: string[]) => string;
}

export const defaultPathDeps: PathDeps = {
  exists: existsSync,
  isDirectory: (p) => existsSync(p) && statSync(p).isDirectory(),
  readFile: (p) => readFileSync(p, 'utf8'),
  join: nodePath.join,
};

export class RunResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunResolutionError';
  }
}

function describeFsFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs an injected filesystem probe, converting failures to actionable
 * RunResolutionErrors naming the operation and failing path.
 */
function guarded<T>(what: string, path: string, op: () => T): T {
  try {
    return op();
  } catch (error) {
    throw new RunResolutionError(
      `Cannot ${what} at ${path}: ${describeFsFailure(error)}`,
    );
  }
}

export interface ResolveRunDirOptions {
  /** Explicit run directory; wins over the latest pointer when provided. */
  readonly explicit?: string;
  /** Directory containing the `latest` pointer (e.g. `<repo>/.memprofile`). */
  readonly memprofileRoot: string;
  readonly deps?: PathDeps;
}

/**
 * Resolves the active run directory: an explicit value, otherwise the path
 * stored in `<memprofileRoot>/latest`. Fails fast when the pointer is empty
 * or points at a directory that does not exist, and when an explicit run
 * directory does not exist, so a request is never queued into nowhere.
 * Filesystem failures (permissions, I/O) surface as RunResolutionError with
 * the failing path and cause.
 */
export function resolveRunDir(options: ResolveRunDirOptions): string {
  const deps = options.deps ?? defaultPathDeps;
  const explicit = options.explicit;
  if (explicit !== undefined && explicit.length > 0) {
    if (
      !guarded('stat run directory', explicit, () => deps.isDirectory(explicit))
    ) {
      throw new RunResolutionError(`Run directory does not exist: ${explicit}`);
    }
    return explicit;
  }
  const latest = deps.join(options.memprofileRoot, LATEST_POINTER_NAME);
  if (!guarded('stat latest pointer', latest, () => deps.exists(latest))) {
    throw new RunResolutionError(
      'No profiling run found. Start one with: npm run mem:profile -- --profile-load <profile>',
    );
  }
  const target = guarded('read latest pointer', latest, () =>
    deps.readFile(latest),
  ).trim();
  if (target.length === 0) {
    throw new RunResolutionError(
      `The latest pointer at ${latest} is empty. Restart a profiling run.`,
    );
  }
  if (
    !guarded('stat latest pointer target', target, () =>
      deps.isDirectory(target),
    )
  ) {
    throw new RunResolutionError(
      `The latest pointer at ${latest} references a missing directory: ${target}`,
    );
  }
  return target;
}

export interface ResolveActiveRunDirOptions extends ResolveRunDirOptions {
  /** Injectable clock for lease-staleness tests. */
  readonly now?: () => number;
  readonly leaseDeps?: LeaseDeps;
}

/** Human-readable counterpart of a lease status for error messages. */
function leaseFailure(check: LeaseCheck): string {
  const reasons: Record<LeaseStatus, string> = {
    missing: 'no probe lease is present (the session likely exited)',
    stale: 'the probe lease is stale (the session is no longer running)',
    malformed: 'the probe lease is malformed',
    unreadable: `the probe lease cannot be read (${check.reason ?? 'unknown error'})`,
    active: 'active',
  };
  return reasons[check.status];
}

/**
 * Resolves a run directory and additionally requires a live probe lease in
 * it. Used by the request CLI so a request is never queued into a run whose
 * probe has exited, failed to start, or been superseded. Reporting does NOT
 * use this: a finished run is still a valid report target.
 */
export function resolveActiveRunDir(
  options: ResolveActiveRunDirOptions,
): string {
  const runDir = resolveRunDir(options);
  const check = checkLease(
    runDir,
    options.leaseDeps ?? {
      ...defaultLeaseDeps,
      now: options.now ?? defaultLeaseDeps.now,
    },
  );
  if (check.status !== 'active') {
    throw new RunResolutionError(
      `The profiling session at ${runDir} is not active: ${leaseFailure(check)}. ` +
        'Start one with: npm run mem:profile -- --profile-load <profile>',
    );
  }
  return runDir;
}

export interface ResolveSamplesOptions {
  /**
   * Explicit samples.jsonl path, or a run directory containing one. When
   * omitted, the latest run is resolved.
   */
  readonly explicit?: string;
  readonly memprofileRoot: string;
  readonly deps?: PathDeps;
}

/**
 * Resolves a samples.jsonl path from an explicit file, an explicit run
 * directory, or the latest run. Directories are joined with `samples.jsonl`
 * using the injected join (win32-aware under test).
 */
export function resolveSamplesPath(options: ResolveSamplesOptions): string {
  const deps = options.deps ?? defaultPathDeps;
  const explicit = options.explicit;
  if (explicit !== undefined && explicit.length > 0) {
    if (
      guarded('stat samples target', explicit, () => deps.isDirectory(explicit))
    ) {
      return deps.join(explicit, SAMPLES_FILE_NAME);
    }
    return explicit;
  }
  const runDir = resolveRunDir({
    memprofileRoot: options.memprofileRoot,
    deps,
  });
  return deps.join(runDir, SAMPLES_FILE_NAME);
}
