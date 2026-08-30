/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * JSC memory probe loaded into a running LLxprt session via `bun --preload
 * scripts/memory/probe-preload.ts` (the preload entry, not this module, owns
 * the install side effect — importing this module from the launcher or tests
 * never installs a probe, even when LLXPRT_MEM_DIR is ambiently set).
 *
 * It is deliberately quiet: LLxprt owns the terminal (Ink), so this never
 * writes to stdout/stderr unless LLXPRT_MEM_VERBOSE=1 or a timer fails.
 * Diagnostics go to probe.log inside the run directory.
 *
 * Requests arrive as JSON files in the run's `requests/` directory (see
 * request.ts) and are polled by an unref'd timer, so this never needs signals,
 * ports, or platform shell commands, and the poller never keeps the target
 * alive past its own exit.
 *
 * OWNERSHIP
 * The probe acquires the run directory's lease (see lease.ts) on startup and
 * renews it on every poll tick. A run directory whose lease names a live
 * probe is never taken over, so a second probe cannot start alongside the
 * first nor recover the first's in-flight claims. The lease is released on
 * normal exit.
 *
 * RECOVERABILITY / EFFECTIVELY EXACTLY-ONCE
 * Request side effects are keyed by request ID and made idempotent (manual
 * samples are deduplicated by request ID; snapshots publish to a
 * request-keyed final name), and a completion marker is recorded after
 * processing. A claim is deleted ONLY when the request is invalid or durably
 * completed; after an operational failure (dispatch, publish, done-marker
 * write) the `.claimed` file is kept so a restarted process retries it.
 * Recovery of an orphaned claim validates shape but NOT staleness: the
 * request was already accepted when claimed, so an old claim is re-run, not
 * dropped.
 *
 * SNAPSHOT SAFETY
 * writeHeapSnapshot is synchronous: it blocks the target and can consume
 * substantially more transient memory than the live heap. Snapshots are
 * refused unless explicitly armed and unless the post-GC heap is under a
 * conservative limit (default 256 MiB on every platform). Each attempt
 * writes to a per-attempt temp file and atomically publishes, so a partial
 * snapshot is never mistaken for completion and two attempts never collide.
 * Do not snapshot a process that has already blown out.
 */

import { gcAndSweep, heapSize, heapStats } from 'bun:jsc';
import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { writeHeapSnapshot } from 'node:v8';
import { messageOf } from '../utils/error-guards.ts';
import {
  acquireLease,
  defaultLeaseDeps,
  releaseLease,
  renewLease,
} from './lease.ts';
import {
  PROBE_LOG_NAME,
  SAMPLES_FILE_NAME,
  SNAPSHOT_DIR_NAME,
} from './paths.ts';
import { FILE_MODE, ensureSecureDir, secureFile } from './perms.ts';
import { type JscHeapStats, collectSample, formatSample } from './sample.ts';
import {
  DEFAULT_STALE_MS,
  REQUEST_DIR_NAME,
  REQUEST_TEMP_MAX_AGE_MS,
  type ClaimResult,
  type MemRequest,
  type ValidateOptions,
  claimNextRequest,
  cleanStaleRequestTemps,
  findOrphanedClaims,
  finishRequest,
  isRequestDone,
  validateRequest,
  validateRequestShape,
  writeDoneMarker,
} from './request.ts';

const MB = 1024 * 1024;

/**
 * Conservative default ceiling on the live heap before a snapshot is allowed,
 * uniform across platforms. writeHeapSnapshot's transient cost on Windows has
 * not been measured; do not raise this blindly.
 */
export const DEFAULT_MAX_SNAPSHOT_HEAP_MB = 256;

/** Upper bound accepted for the sampling interval (24 hours). */
export const MAX_INTERVAL_MS = 86_400_000;

/** Upper bound accepted for the snapshot heap guard (1 TiB). */
export const MAX_SNAPSHOT_HEAP_MB_LIMIT = 1_048_576;

/** Default periodic sampling interval when the env value is absent/invalid. */
export const DEFAULT_INTERVAL_MS = 15_000;

/** How often the request poller (and lease heartbeat) runs. */
export const REQUEST_POLL_INTERVAL_MS = 1000;

export interface ProbeDeps {
  readonly runDir: string;
  readonly now: () => number;
  readonly pid: () => number;
  readonly rss: () => number;
  readonly gcAndSweep: () => void;
  readonly heapStats: () => JscHeapStats;
  readonly heapSize: () => number;
  readonly snapshotsArmed: boolean;
  readonly maxSnapshotHeapMb: number;
  readonly writeHeapSnapshot: (path: string) => void;
  readonly appendSample: (line: string) => void;
  readonly appendLog: (line: string) => void;
  readonly publishSnapshot: (tempPath: string, finalPath: string) => void;
  /**
   * True when a sample carrying this request ID was already appended to
   * samples.jsonl. Manual sample publication is idempotent by request ID:
   * a crash after the append but before the done marker must not duplicate
   * the sample on recovery.
   */
  readonly hasSample: (requestId: string) => boolean;
}

/** Writes a tagged sample through the probe's append sink. */
export function writeProbeSample(
  deps: ProbeDeps,
  tag: string,
  requestId?: string,
): void {
  const sample = collectSample({
    tag,
    pid: deps.pid(),
    rss: deps.rss(),
    stats: deps.heapStats(),
    nowMs: deps.now(),
    requestId,
  });
  deps.appendSample(formatSample(sample));
}

/**
 * Handles a `sample` request idempotently: if a sample with this request ID
 * was already published (a crash after the append), acknowledge instead of
 * appending a second copy. Otherwise force GC, write a tagged sample, and
 * log completion.
 */
export function handleSample(deps: ProbeDeps, request: MemRequest): void {
  if (deps.hasSample(request.id)) {
    deps.appendLog(`sample id=${request.id} already published; not duplicated`);
    return;
  }
  deps.gcAndSweep();
  writeProbeSample(deps, 'manual', request.id);
  deps.appendLog(
    `sample complete id=${request.id} heap=${(deps.heapSize() / MB).toFixed(0)}MB`,
  );
}

/** Final snapshot path keyed by the request ID, making output idempotent. */
export function snapshotPathFor(runDir: string, requestId: string): string {
  return join(runDir, SNAPSHOT_DIR_NAME, `snap-${requestId}.heapsnapshot`);
}

/**
 * Removes temp files left by earlier attempts of THIS request (a crash
 * mid-writeHeapSnapshot). Per-attempt temp names mean a crashed attempt never
 * collides with the current one; this keeps the snapshot directory free of
 * stale partials once a retry succeeds.
 */
function removeStaleSnapshotTemps(
  snapshotDir: string,
  base: string,
  currentTemp: string,
): void {
  for (const name of readdirSync(snapshotDir)) {
    if (
      name.startsWith(`${base}.`) &&
      name.endsWith('.tmp') &&
      join(snapshotDir, name) !== currentTemp
    ) {
      rmSync(join(snapshotDir, name), { force: true });
    }
  }
}

/**
 * Handles a `snapshot` request. Refuses safely when snapshots are not armed
 * or the post-GC heap exceeds the limit; otherwise writes the snapshot to a
 * per-attempt temporary file and atomically publishes it, so a partial
 * snapshot is never visible as the final artifact and concurrent attempts
 * cannot collide. A request whose final file already exists is acknowledged
 * as already complete rather than re-written. Never terminates the target.
 */
export function handleSnapshot(deps: ProbeDeps, request: MemRequest): void {
  if (!deps.snapshotsArmed) {
    deps.appendLog(
      `REFUSED snapshot id=${request.id}: snapshots not armed (launch with --snapshots)`,
    );
    return;
  }
  const finalPath = snapshotPathFor(deps.runDir, request.id);
  if (existsSync(finalPath)) {
    deps.appendLog(
      `snapshot id=${request.id} already present at ${finalPath}; not re-written`,
    );
    return;
  }
  deps.gcAndSweep();
  const heapMb = deps.heapSize() / MB;
  if (heapMb > deps.maxSnapshotHeapMb) {
    deps.appendLog(
      `REFUSED snapshot id=${request.id}: heap ${heapMb.toFixed(0)} MB exceeds limit ${deps.maxSnapshotHeapMb} MB. ` +
        'Snapshotting is synchronous, blocks the target, and can consume substantially more transient memory than the live heap.',
    );
    return;
  }
  const snapshotDir = join(deps.runDir, SNAPSHOT_DIR_NAME);
  ensureSecureDir(snapshotDir);
  const base = `snap-${request.id}.heapsnapshot`;
  const tempPath = join(
    snapshotDir,
    `${base}.${deps.pid().toString(36)}.${deps.now().toString(36)}.tmp`,
  );
  removeStaleSnapshotTemps(snapshotDir, base, tempPath);
  deps.writeHeapSnapshot(tempPath);
  secureFile(tempPath);
  deps.publishSnapshot(tempPath, finalPath);
  deps.appendLog(
    `snapshot id=${request.id} ${finalPath} (heap ${heapMb.toFixed(0)} MB)`,
  );
  writeProbeSample(deps, 'post-snapshot', request.id);
}

function dispatchRequest(deps: ProbeDeps, request: MemRequest): void {
  if (request.kind === 'sample') {
    handleSample(deps, request);
  } else {
    handleSnapshot(deps, request);
  }
}

/** Where a claimed request came from; governs staleness enforcement. */
export type ClaimOrigin = 'pending' | 'recovery';

/**
 * Processes a claimed request at most once.
 *
 * Deletion rules (durable exactly-once):
 * - INVALID request (unparseable, wrong schema, bad ID, and — for a pending
 *   claim — stale): rejected and deleted. It can never be processed.
 * - Already marked done: acknowledged and deleted.
 * - Valid request whose dispatch or done-marker write fails operationally
 *   (external filesystem/process errors): the `.claimed` file is KEPT for
 *   retry by a restarted process. Work is never silently lost, and because
 *   side effects are idempotent by request ID it is never duplicated either.
 *
 * `origin` selects validation: a pending request still enforces staleness so
 * a leftover file cannot trigger work long after it was issued; a recovered
 * claim was already accepted when claimed and is exempt, so recovery never
 * stale-rejects old requests.
 */
export function processClaimed(
  claimed: ClaimResult,
  deps: ProbeDeps,
  validateOptions: ValidateOptions,
  origin: ClaimOrigin,
): void {
  let request: MemRequest;
  try {
    const parsed: unknown = JSON.parse(claimed.raw);
    request =
      origin === 'pending'
        ? validateRequest(parsed, validateOptions)
        : validateRequestShape(parsed);
  } catch (error) {
    deps.appendLog(`rejected request ${claimed.fileName}: ${messageOf(error)}`);
    finishRequest(claimed.path);
    return;
  }
  if (isRequestDone(deps.runDir, request.id)) {
    deps.appendLog(
      `request ${claimed.fileName} already complete (marker present); not re-processed`,
    );
    finishRequest(claimed.path);
    return;
  }
  try {
    dispatchRequest(deps, request);
    writeDoneMarker(deps.runDir, request.id, deps.pid());
  } catch (error) {
    deps.appendLog(
      `request ${request.id} failed operationally; claim kept for retry: ${messageOf(error)}`,
    );
    return;
  }
  finishRequest(claimed.path);
}

/**
 * Recovers orphaned `.claimed` files left by a process that terminated
 * mid-request. Each is run through the same exactly-once path as a live
 * request (with staleness exempted — see processClaimed): if the completion
 * marker exists the claim is simply removed; otherwise the idempotent side
 * effects re-run. Returns the number of recovered claims.
 */
export function recoverOrphanedClaims(
  deps: ProbeDeps,
  validateOptions: ValidateOptions,
): number {
  const requestDir = join(deps.runDir, REQUEST_DIR_NAME);
  const orphans = findOrphanedClaims(requestDir);
  if (orphans.length > 0) {
    deps.appendLog(
      `recovering ${orphans.length} orphaned request(s) from a previous process`,
    );
  }
  for (const claimed of orphans) {
    processClaimed(claimed, deps, validateOptions, 'recovery');
  }
  return orphans.length;
}

/**
 * Drains every pending request in the run directory, processing each at most
 * once. Returns the number processed.
 */
export function drainPendingRequests(
  deps: ProbeDeps,
  validateOptions: ValidateOptions,
): number {
  const requestDir = join(deps.runDir, REQUEST_DIR_NAME);
  let processed = 0;
  for (;;) {
    const claimed = claimNextRequest(requestDir);
    if (claimed === null) {
      return processed;
    }
    processClaimed(claimed, deps, validateOptions, 'pending');
    processed += 1;
  }
}

// ---------------------------------------------------------------------------
// Runtime: real dependencies built from Bun's JSC API and node:v8 compatibility.
// ---------------------------------------------------------------------------

export interface ProbeConfig {
  readonly runDir: string;
  readonly intervalMs: number;
  readonly maxSnapshotHeapMb: number;
  readonly snapshotsArmed: boolean;
  readonly verbose: boolean;
}

/**
 * Parses a probe env value: it must be a finite positive integer within
 * `max`, mirroring the launcher's option parsing. An invalid value falls
 * back to the default (a bad environment must not kill the monitored
 * process) and is reported through the returned warning.
 */
export function parseBoundedPositiveInt(
  raw: string | undefined,
  fallback: number,
  max: number,
): { readonly value: number; readonly warning?: string } {
  if (raw === undefined) {
    return { value: fallback };
  }
  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > max
  ) {
    return {
      value: fallback,
      warning: `invalid value "${raw}" (expected a positive integer <= ${max}); using default ${fallback}`,
    };
  }
  return { value };
}

function readProbeConfigFromEnv(): {
  readonly config: ProbeConfig;
  readonly warnings: readonly string[];
} | null {
  const runDir = process.env['LLXPRT_MEM_DIR'];
  if (runDir === undefined || runDir.length === 0) {
    return null;
  }
  const interval = parseBoundedPositiveInt(
    process.env['LLXPRT_MEM_INTERVAL_MS'],
    DEFAULT_INTERVAL_MS,
    MAX_INTERVAL_MS,
  );
  const maxHeap = parseBoundedPositiveInt(
    process.env['LLXPRT_MEM_MAX_HEAP_MB'],
    DEFAULT_MAX_SNAPSHOT_HEAP_MB,
    MAX_SNAPSHOT_HEAP_MB_LIMIT,
  );
  return {
    config: {
      runDir,
      intervalMs: interval.value,
      maxSnapshotHeapMb: maxHeap.value,
      // '0' is written explicitly by the launcher when snapshots are off, so
      // an inherited LLXPRT_MEM_SNAPSHOT=1 from the parent cannot re-arm them.
      snapshotsArmed: process.env['LLXPRT_MEM_SNAPSHOT'] === '1',
      verbose: process.env['LLXPRT_MEM_VERBOSE'] === '1',
    },
    warnings: [
      ...(interval.warning
        ? [`LLXPRT_MEM_INTERVAL_MS: ${interval.warning}`]
        : []),
      ...(maxHeap.warning
        ? [`LLXPRT_MEM_MAX_HEAP_MB: ${maxHeap.warning}`]
        : []),
    ],
  };
}

/** Builds real ProbeDeps from bun:jsc, node:v8, and the process. */
export function createRealProbeDeps(config: ProbeConfig): ProbeDeps {
  const samplesPath = join(config.runDir, SAMPLES_FILE_NAME);
  const logPath = join(config.runDir, PROBE_LOG_NAME);
  ensureSecureDir(config.runDir);
  // Creation modes only apply to new files; tighten files reused from an
  // earlier run in this directory.
  if (existsSync(samplesPath)) {
    secureFile(samplesPath);
  }
  if (existsSync(logPath)) {
    secureFile(logPath);
  }
  return {
    runDir: config.runDir,
    now: () => Date.now(),
    pid: () => process.pid,
    rss: () => process.memoryUsage().rss,
    gcAndSweep,
    heapStats,
    heapSize,
    snapshotsArmed: config.snapshotsArmed,
    maxSnapshotHeapMb: config.maxSnapshotHeapMb,
    writeHeapSnapshot,
    appendSample: (line) =>
      appendFileSync(samplesPath, `${line}\n`, { mode: FILE_MODE }),
    appendLog: (line) => {
      appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`, {
        mode: FILE_MODE,
      });
      if (config.verbose) {
        process.stderr.write(`[memprobe] ${line}\n`);
      }
    },
    publishSnapshot: (tempPath, finalPath) => renameSync(tempPath, finalPath),
    hasSample: (requestId) => {
      try {
        return readFileSync(samplesPath, 'utf8').includes(
          `"requestId":"${requestId}"`,
        );
      } catch {
        return false;
      }
    },
  };
}

function validateOptionsFor(deps: ProbeDeps): ValidateOptions {
  return {
    now: deps.now,
    staleMs: DEFAULT_STALE_MS,
  };
}

/**
 * Runs one timer tick, converting any failure (external filesystem/process
 * errors) into a probe-log entry instead of an uncaught exception that would
 * kill the monitored LLxprt process. If even the log append fails, the
 * message goes to stderr so it is never swallowed silently.
 */
function safeTick(deps: ProbeDeps, what: string, op: () => void): void {
  try {
    op();
  } catch (error) {
    const line = `${what} failed: ${messageOf(error)}`;
    try {
      deps.appendLog(line);
    } catch {
      process.stderr.write(`[memprobe] ${line}\n`);
    }
  }
}

/**
 * Installs the probe when LLXPRT_MEM_DIR is set (i.e. when --preload'd by the
 * launcher via probe-preload.ts). Acquires the run directory lease first — a
 * directory owned by a live probe is never taken over — then recovers
 * orphaned requests so a restart neither drops nor doubles a requested sample
 * or snapshot, and starts the poller. Returns null only when the preload is not
 * configured. A refused lease is fatal because continuing would run the
 * application without the profiling session the launcher announced.
 */
export function installProbe(): ProbeDeps | null {
  const parsed = readProbeConfigFromEnv();
  if (parsed === null) {
    return null;
  }
  const { config, warnings } = parsed;
  const deps = createRealProbeDeps(config);
  for (const warning of warnings) {
    deps.appendLog(`WARNING ${warning}`);
  }
  const acquisition = acquireLease(config.runDir);
  if (acquisition.outcome === 'refused') {
    const message = `run directory lease not acquired (${acquisition.check.status}); another probe may own this run`;
    deps.appendLog(`REFUSED startup: ${message}`);
    throw new Error(`[memprobe] ${message}`);
  }
  const owner = acquisition.lease.owner;
  const validateOptions = validateOptionsFor(deps);
  safeTick(deps, 'recovery', () =>
    recoverOrphanedClaims(deps, validateOptions),
  );
  writeProbeSample(deps, 'startup');
  deps.appendLog(
    `armed pid=${deps.pid()} interval=${config.intervalMs}ms snapshots=${
      config.snapshotsArmed ? `on (guard ${config.maxSnapshotHeapMb}MB)` : 'off'
    } lease=${owner}`,
  );

  let lostLease = false;
  let leaseUncertain = false;
  const requestDir = join(config.runDir, REQUEST_DIR_NAME);
  const pollTimer = setInterval(() => {
    safeTick(deps, 'request poll', () => {
      const renewal = renewLease(config.runDir, owner);
      if (renewal === 'lost') {
        lostLease = true;
        deps.appendLog(
          'lost the run directory lease; stopping request processing',
        );
        stopTimers();
        return;
      }
      if (renewal === 'indeterminate') {
        if (!leaseUncertain) {
          deps.appendLog(
            'could not verify the run directory lease; pausing request processing',
          );
        }
        leaseUncertain = true;
        return;
      }
      if (leaseUncertain) {
        deps.appendLog('run directory lease verified; resuming requests');
        leaseUncertain = false;
      }
      cleanStaleRequestTemps(requestDir, deps.now(), REQUEST_TEMP_MAX_AGE_MS);
      drainPendingRequests(deps, validateOptions);
    });
  }, REQUEST_POLL_INTERVAL_MS);
  pollTimer.unref();
  const sampleTimer = setInterval(() => {
    safeTick(deps, 'sample tick', () => writeProbeSample(deps, 'tick'));
  }, config.intervalMs);
  sampleTimer.unref();

  function stopTimers(): void {
    clearInterval(pollTimer);
    clearInterval(sampleTimer);
  }

  process.on('exit', () => {
    if (lostLease) {
      return;
    }
    safeTick(deps, 'exit sample', () => writeProbeSample(deps, 'exit'));
    safeTick(deps, 'lease release', () =>
      releaseLease(config.runDir, owner, defaultLeaseDeps),
    );
  });
  return deps;
}
