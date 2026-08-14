/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workspace context provider for enriching context with working-set files.
 */

import { promises as fsPromises } from 'fs';
import { isNodeError } from '../../utils/errors.js';
import type {
  ConnectedFile,
  EnhancedDeclaration,
  WorkingSetAcquisition,
  WorkingSetAcquisitionStatus,
  WorkingSetPartialReason,
} from './types.js';
import type { ASTQueryExtractor } from './ast-query-extractor.js';
import type {
  RepositoryContextProvider,
  WorkingSetDiscoveryOutcome,
} from './repository-context-provider.js';
import { createDefaultByteBudget } from '../../acquisition/byteBudget.js';

/** Finite policy: maximum working-set files retained per acquisition. */
export const MAX_WORKING_SET_FILES = 50;

/** Finite policy: maximum declarations retained across the working set. */
export const MAX_WORKING_SET_DECLARATIONS = 500;

/** Finite policy: working-set files acquired concurrently per chunk. */
export const WORKING_SET_ACQUISITION_CONCURRENCY = 4;

/**
 * Bounded-read growth sentinel: a working-set file may grow between its
 * planned stat and its read, so reads materialize at most the admitted
 * allowance plus this window. Filling the window means the content can never
 * be confirmed complete within the allowance, and the file is skipped.
 */
const READ_SENTINEL_BYTES = 4096;

/** One planned working-set candidate: admissible, or a skip outcome. */
type PlannedCandidate =
  | { readonly kind: 'admit'; readonly path: string; readonly size: number }
  | { readonly kind: 'missing'; readonly path: string }
  | { readonly kind: 'unreadable'; readonly path: string }
  | { readonly kind: 'oversized'; readonly path: string };

/** One settled acquisition item: a parsed file, or a skip outcome. */
type AcquiredItem =
  | {
      readonly kind: 'file';
      readonly sourceBytes: number;
      readonly declarations: readonly EnhancedDeclaration[];
    }
  | { readonly kind: 'skipped'; readonly reason: 'unreadable' | 'oversized' };

/** One admitted chunk item with its pre-assigned byte allowance. */
interface AdmittedCandidate {
  readonly path: string;
  readonly allowance: number;
}

/**
 * Immutable accumulator for one bounded acquisition run. Every transition
 * returns a new frozen state, so the retained arrays and the counters used
 * to derive the final status can never diverge.
 */
interface WorkingSetRunState {
  readonly retained: readonly ConnectedFile[];
  readonly retainedFiles: number;
  readonly retainedDeclarations: number;
  readonly retainedSourceBytes: number;
  readonly skippedFiles: number;
  readonly oversizedFiles: number;
  readonly missingFiles: number;
}

const EMPTY_RUN_STATE: WorkingSetRunState = Object.freeze({
  retained: Object.freeze([]),
  retainedFiles: 0,
  retainedDeclarations: 0,
  retainedSourceBytes: 0,
  skippedFiles: 0,
  oversizedFiles: 0,
  missingFiles: 0,
});

function retainFile(
  state: WorkingSetRunState,
  file: ConnectedFile,
  sourceBytes: number,
): WorkingSetRunState {
  return Object.freeze({
    ...state,
    retained: Object.freeze([...state.retained, file]),
    retainedFiles: state.retainedFiles + 1,
    retainedDeclarations: state.retainedDeclarations + file.declarations.length,
    retainedSourceBytes: state.retainedSourceBytes + sourceBytes,
  });
}

function countSkip(
  state: WorkingSetRunState,
  kind: 'missing' | 'unreadable' | 'oversized',
): WorkingSetRunState {
  if (kind === 'missing') {
    return Object.freeze({ ...state, missingFiles: state.missingFiles + 1 });
  }
  if (kind === 'unreadable') {
    return Object.freeze({ ...state, skippedFiles: state.skippedFiles + 1 });
  }
  return Object.freeze({ ...state, oversizedFiles: state.oversizedFiles + 1 });
}

/** True when the optional signal is present and already aborted. */
function signalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

/**
 * Plan one discovered candidate with a bounded stat. A Git-reported path
 * that vanished is missing; one that is no longer a regular file is
 * unreadable; one whose size alone exceeds the aggregate budget is oversized.
 * Never rejects: planning problems become skip outcomes so one bad candidate
 * cannot fail the whole collection.
 */
async function planCandidate(
  candidate: string,
  budgetBytes: number,
): Promise<PlannedCandidate> {
  let stats;
  try {
    stats = await fsPromises.stat(candidate);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { kind: 'missing', path: candidate };
    }
    return { kind: 'unreadable', path: candidate };
  }
  if (!stats.isFile()) {
    return { kind: 'unreadable', path: candidate };
  }
  if (stats.size > budgetBytes) {
    return { kind: 'oversized', path: candidate };
  }
  return { kind: 'admit', path: candidate, size: stats.size };
}

/**
 * Read the bounded window into `buffer`, returning the exact raw byte count.
 * Throws on a real read failure (for example the path became a directory
 * after its stat ran) so the caller can turn it into a single-file skip.
 */
async function readBoundedTotal(
  handle: fsPromises.FileHandle,
  buffer: Buffer,
): Promise<number> {
  let total = 0;
  while (total < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      total,
      buffer.length - total,
      total,
    );
    if (bytesRead === 0) {
      break;
    }
    total += bytesRead;
  }
  return total;
}

/**
 * Acquire one admitted candidate with a bounded read.
 *
 * Materializes at most the admitted allowance plus the growth sentinel: if
 * the read fills the buffer the content cannot be confirmed complete within
 * the allowance and the file is skipped as oversized. The authoritative byte
 * charge is the exact raw byte count the read returned — never a re-encoded
 * UTF-8 length, which would mis-account invalid bytes. Never rejects: a
 * candidate that fails at the open, read, or parse boundary is counted as a
 * skip while the handle is always closed.
 */
async function acquireAdmittedItem(
  candidate: AdmittedCandidate,
  budgetBytes: number,
  declarationLimit: number,
  astExtractor: ASTQueryExtractor,
): Promise<AcquiredItem> {
  let handle;
  try {
    handle = await fsPromises.open(candidate.path, 'r');
  } catch {
    return { kind: 'skipped', reason: 'unreadable' };
  }
  try {
    const buffer = Buffer.alloc(candidate.allowance + READ_SENTINEL_BYTES);
    let total: number;
    try {
      total = await readBoundedTotal(handle, buffer);
    } catch {
      // One bad candidate must never reject the whole collection.
      return { kind: 'skipped', reason: 'unreadable' };
    }
    if (total === buffer.length) {
      return { kind: 'skipped', reason: 'oversized' };
    }
    if (total > budgetBytes) {
      return { kind: 'skipped', reason: 'oversized' };
    }
    const content = buffer.toString('utf8', 0, total);
    let declarations;
    try {
      declarations = await astExtractor.extractDeclarationsBounded(
        candidate.path,
        content,
        declarationLimit,
      );
    } catch {
      // The bounded parser is an external boundary for arbitrary file
      // contents: a parse fault skips the file instead of failing the run.
      return { kind: 'skipped', reason: 'unreadable' };
    }
    return {
      kind: 'file',
      sourceBytes: Math.max(candidate.allowance, total),
      declarations,
    };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Derive the partial reason with deterministic precedence. */
function derivePartialReason(
  stop: WorkingSetPartialReason | null,
  discovery: WorkingSetDiscoveryOutcome,
  skippedTotal: number,
): WorkingSetPartialReason | undefined {
  if (stop !== null) {
    return stop;
  }
  if (discovery === 'git-error') {
    return 'git-error';
  }
  if (discovery === 'truncated') {
    return 'discovery-limit';
  }
  return skippedTotal > 0 ? 'skipped-files' : undefined;
}

/** Derive the final bounded status with deterministic reason precedence. */
function buildStatus(
  state: WorkingSetRunState,
  stop: WorkingSetPartialReason | null,
  discovery: WorkingSetDiscoveryOutcome,
  eligibleFiles: number,
): WorkingSetAcquisitionStatus {
  const skippedTotal =
    state.skippedFiles + state.oversizedFiles + state.missingFiles;
  const partialReason = derivePartialReason(stop, discovery, skippedTotal);
  const traversalComplete = discovery === 'complete' && stop === null;
  const base = {
    traversalComplete,
    discoveryTruncated: discovery === 'truncated',
    retainedFiles: state.retainedFiles,
    retainedDeclarations: state.retainedDeclarations,
    retainedSourceBytes: state.retainedSourceBytes,
    eligibleFiles,
    skippedFiles: state.skippedFiles,
    oversizedFiles: state.oversizedFiles,
    missingFiles: state.missingFiles,
  };
  if (partialReason === undefined) {
    return Object.freeze({ ...base, complete: true });
  }
  return Object.freeze({ ...base, complete: false, partialReason });
}

/**
 * Enrich context with declarations from working-set files (Git unstaged,
 * staged, and recent commits) under finite acquisition policies.
 *
 * Discovery observes at most MAX_WORKING_SET_FILES + 1 candidates (the finite
 * count plus a one-over sentinel) through an abortable, exact-child-terminated
 * Git run. Acquisition proceeds in bounded-concurrency chunks: candidates are
 * planned with a stat, admitted sequentially against the remaining aggregate
 * byte budget (so concurrent in-flight materialization is bounded by the
 * budget, not the worker count), read with bounded buffers, and extracted
 * with a bounded declaration acquisition. Policies are enforced before
 * over-budget reads/parses start, in a fixed precedence: file-count, then
 * source-bytes, then declarations; cancellation dominates when the signal is
 * the binding cause. Any skipped, truncated, or failed candidate makes the
 * context partial with explicit accounting; in-flight chunk items always
 * settle before the returned promise resolves, so no invocation-owned work is
 * left running.
 *
 * @param targetFilePath - The file currently being read (excluded from the set)
 * @param workspaceRoot - The workspace root directory
 * @param repoProvider - Repository context provider for git operations
 * @param astExtractor - AST query extractor for declaration extraction
 * @param signal - Optional cancellation signal for owned acquisition
 * @returns Bounded working-set acquisition: retained files and accounting
 */
export async function enrichWithWorkingSetContext(
  targetFilePath: string,
  workspaceRoot: string,
  repoProvider: RepositoryContextProvider,
  astExtractor: ASTQueryExtractor,
  signal?: AbortSignal,
): Promise<WorkingSetAcquisition> {
  if (signalAborted(signal)) {
    return {
      files: EMPTY_RUN_STATE.retained,
      status: buildStatus(EMPTY_RUN_STATE, 'cancelled', 'complete', 0),
    };
  }

  const discovery = await repoProvider.discoverWorkingSetFiles(workspaceRoot, {
    maxCandidates: MAX_WORKING_SET_FILES + 1,
    signal,
    excludePath: targetFilePath,
  });
  if (discovery.outcome === 'aborted') {
    return {
      files: EMPTY_RUN_STATE.retained,
      status: buildStatus(
        EMPTY_RUN_STATE,
        'cancelled',
        'aborted',
        discovery.candidates.length,
      ),
    };
  }
  // Git failure keeps whatever candidates earlier phases observed; the
  // acquisition below stays bounded and the status stays partial.
  const discoveryOutcome: WorkingSetDiscoveryOutcome =
    discovery.outcome === 'no-working-set' ? 'complete' : discovery.outcome;

  const budgetBytes = createDefaultByteBudget().bytes;
  const planned = await planCandidates(
    [...discovery.candidates].sort(),
    budgetBytes,
  );
  const eligibleFiles = planned.length;
  const { state, stop } = await acquirePlanned(
    planned,
    astExtractor,
    budgetBytes,
    signal,
  );

  return {
    files: state.retained,
    status: buildStatus(state, stop, discoveryOutcome, eligibleFiles),
  };
}

/**
 * Drive the bounded acquisition loop over planned candidates. Enforces the
 * file-count, aggregate-source-byte, and retained-declaration policies with
 * fixed precedence (file-count → source-bytes → declarations) before
 * over-budget reads/parses start. Cancellation dominates when the signal is
 * the binding cause. In-flight chunk items always settle before the returned
 * promise resolves, so no invocation-owned work is left running.
 */
async function acquirePlanned(
  planned: readonly PlannedCandidate[],
  astExtractor: ASTQueryExtractor,
  budgetBytes: number,
  signal: AbortSignal | undefined,
): Promise<{
  state: WorkingSetRunState;
  stop: WorkingSetPartialReason | null;
}> {
  let state = EMPTY_RUN_STATE;
  let stop: WorkingSetPartialReason | null = null;
  let index = 0;
  let shouldContinue = true;

  while (shouldContinue && index < planned.length && !signalAborted(signal)) {
    if (state.retainedFiles >= MAX_WORKING_SET_FILES) {
      stop = 'file-count';
      shouldContinue = false;
    } else {
      const chunkSize = boundedChunkSize(
        state.retainedFiles,
        planned.length,
        index,
      );
      const chunk = planned.slice(index, index + chunkSize);
      state = processPlannedSkips(state, chunk);
      const admission = admitChunk(state, chunk, budgetBytes);
      state = admission.state;
      const retention = await settleAndRetain(
        admission,
        state,
        astExtractor,
        budgetBytes,
        signal,
      );
      state = retention.state;
      index += chunk.length;
      if (admission.stopAfter !== null) {
        stop = admission.stopAfter;
        shouldContinue = false;
      } else if (retention.stop !== null) {
        stop = retention.stop;
        shouldContinue = false;
      }
    }
  }
  if (stop === null && signalAborted(signal)) {
    stop = 'cancelled';
  }
  return { state, stop };
}

/** Compute a chunk size that never exceeds concurrency, remaining budget, or supply. */
function boundedChunkSize(
  retainedFiles: number,
  totalPlanned: number,
  index: number,
): number {
  return Math.min(
    WORKING_SET_ACQUISITION_CONCURRENCY,
    MAX_WORKING_SET_FILES - retainedFiles,
    totalPlanned - index,
  );
}

/** Acquire, retain, and return the settled state plus any retention stop. */
async function settleAndRetain(
  admission: AdmissionResult,
  state: WorkingSetRunState,
  astExtractor: ASTQueryExtractor,
  budgetBytes: number,
  signal: AbortSignal | undefined,
): Promise<{
  state: WorkingSetRunState;
  stop: WorkingSetPartialReason | null;
}> {
  if (admission.admitted.length === 0 || signalAborted(signal)) {
    return { state, stop: null };
  }
  const declarationLimit =
    MAX_WORKING_SET_DECLARATIONS - state.retainedDeclarations + 1;
  const items = await Promise.all(
    admission.admitted.map((candidate) =>
      acquireAdmittedItem(
        candidate,
        budgetBytes,
        declarationLimit,
        astExtractor,
      ),
    ),
  );
  const retention = retainItems(state, admission.admitted, items, budgetBytes);
  return { state: retention.state, stop: retention.stop };
}

/** Stat all (bounded, at most 51) discovered candidates concurrently. */
async function planCandidates(
  candidates: readonly string[],
  budgetBytes: number,
): Promise<PlannedCandidate[]> {
  return Promise.all(
    candidates.map((candidate) => planCandidate(candidate, budgetBytes)),
  );
}

/** Count every skip already known from planning (independent of admission). */
function processPlannedSkips(
  state: WorkingSetRunState,
  chunk: readonly PlannedCandidate[],
): WorkingSetRunState {
  let next = state;
  for (const candidate of chunk) {
    if (candidate.kind !== 'admit') {
      next = countSkip(next, candidate.kind);
    }
  }
  return next;
}

interface AdmissionResult {
  readonly state: WorkingSetRunState;
  readonly admitted: readonly AdmittedCandidate[];
  /**
   * Present when a candidate could not be admitted against the remaining
   * aggregate byte budget: acquisition stops after the already-admitted
   * candidates settle, and the non-fitting candidate (and everything after
   * it) is never read.
   */
  readonly stopAfter: WorkingSetPartialReason | null;
}

/**
 * Sequentially admit chunk candidates against the remaining aggregate byte
 * budget. Assigning allowances before any read starts bounds concurrent
 * in-flight materialization to the remaining budget even with four workers.
 */
function admitChunk(
  state: WorkingSetRunState,
  chunk: readonly PlannedCandidate[],
  budgetBytes: number,
): AdmissionResult {
  const admitted: AdmittedCandidate[] = [];
  let assigned = 0;
  for (const candidate of chunk) {
    if (candidate.kind !== 'admit') {
      continue;
    }
    if (state.retainedSourceBytes + assigned + candidate.size > budgetBytes) {
      return { state, admitted, stopAfter: 'source-bytes' };
    }
    admitted.push({ path: candidate.path, allowance: candidate.size });
    assigned += candidate.size;
  }
  return { state, admitted, stopAfter: null };
}

interface RetentionResult {
  readonly state: WorkingSetRunState;
  readonly stop: WorkingSetPartialReason | null;
}

/**
 * Retain settled items sequentially in deterministic order. Byte charges use
 * the authoritative actual byte length; a declaration one-over sentinel drops
 * its file and stops acquisition.
 */
function retainItems(
  state: WorkingSetRunState,
  admitted: readonly AdmittedCandidate[],
  items: readonly AcquiredItem[],
  budgetBytes: number,
): RetentionResult {
  let next = state;
  for (let position = 0; position < items.length; position++) {
    const item = items[position];
    if (item.kind === 'skipped') {
      next = countSkip(next, item.reason);
      continue;
    }
    const overBudget =
      next.retainedSourceBytes + item.sourceBytes > budgetBytes;
    if (overBudget) {
      return { state: next, stop: 'source-bytes' };
    }
    const declarations = Object.freeze([...item.declarations]);
    const overDeclarations =
      declarations.length >
      MAX_WORKING_SET_DECLARATIONS - next.retainedDeclarations;
    if (overDeclarations) {
      return { state: next, stop: 'declarations' };
    }
    next = retainFile(
      next,
      Object.freeze({
        filePath: admitted[position].path,
        declarations,
      }),
      item.sourceBytes,
    );
  }
  return { state: next, stop: null };
}
