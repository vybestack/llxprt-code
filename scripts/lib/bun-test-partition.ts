/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { scriptsTestFileWeight } from './scripts-test-weights.js';

/**
 * Partition selection shared by the Bun test runners that split one workspace
 * across several CI legs (issue #3185 for cli, issue #854 for agents). The
 * workflow passes the leg's `NofM` identity through one environment variable.
 */

/**
 * Environment variable consumed by this runner for partition selection.
 * Exported so the workflow wiring test can assert the YAML env key matches,
 * preventing string drift between the runner and the workflow.
 */
export const PARTITION_ENV_VAR = 'LLXPRT_CLI_TEST_PARTITION';

/**
 * A one-based partition identity parsed from the canonical `NofM` form
 * (e.g. `2of3`). `null` from {@link parsePartitionIdentity} means "no
 * partition" — run the full discovered inventory.
 */
export interface PartitionIdentity {
  /** One-based partition index (1..count). */
  readonly index: number;
  /** Number of partitions (positive integer ≥ 1). */
  readonly count: number;
}

/**
 * Canonical form: one-or-more digits, literal `of`, one-or-more digits. The
 * first digit must be 1-9 so leading zeros (`01of3`) are rejected as
 * noncanonical.
 */
const PARTITION_RE = /^([1-9][0-9]*)of([1-9][0-9]*)$/;

/**
 * Parses an optional partition identity from the canonical `NofM` form (e.g.
 * `2of3`). Returns `null` when the input is absent or blank, meaning the full
 * discovered inventory should run.
 *
 * Throws on any noncanonical, zero, negative, unsafe, or out-of-range value so
 * a misconfigured {@link PARTITION_ENV_VAR} never silently runs a partial
 * suite. The variable name appears in every error so the cause is obvious.
 *
 * Blank semantics: undefined, empty, and whitespace-only values are treated as
 * "no partition" (full run). Every nonblank value must match canonical `NofM`
 * exactly — the raw string is validated, not a trimmed copy — so surrounding
 * whitespace (` 1of3 `) is rejected rather than silently starting a partial run.
 */
export function parsePartitionIdentity(
  raw: string | undefined,
): PartitionIdentity | null {
  if (raw === undefined || raw.trim() === '') return null;
  const match = PARTITION_RE.exec(raw);
  if (match === null) {
    throw new Error(
      `${PARTITION_ENV_VAR}='${raw}' is not a canonical partition identity (expected NofM, e.g. 2of3)`,
    );
  }
  const indexStr = match[1];
  const countStr = match[2];
  const index = Number.parseInt(indexStr, 10);
  const count = Number.parseInt(countStr, 10);
  // Number.isSafeInteger rejects values outside [-(2^53 - 1), 2^53 - 1],
  // including 2^53 which round-trips through String() without precision loss
  // but is still not safely representable.
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count)) {
    throw new Error(`${PARTITION_ENV_VAR}='${raw}' contains an unsafe integer`);
  }
  if (index > count) {
    throw new Error(
      `${PARTITION_ENV_VAR}='${raw}' has index ${index} greater than count ${count}`,
    );
  }
  return { index, count };
}

/**
 * Selects one partition from a sorted list by round-robin: file position
 * modulo partition count equals partition index minus one. This maps every
 * array position to exactly one partition and preserves relative order.
 *
 * Returns the full list (a copy) when there is no partition (`null`) or when
 * the identity is `1of1`. Throws when a well-formed partitioned identity
 * (count > 1) selects no files, so an empty explicit selection fails fast
 * rather than producing a green no-op run.
 */
export function selectPartition(
  files: readonly string[],
  identity: PartitionIdentity | null,
): readonly string[] {
  if (identity === null || identity.count === 1) {
    return [...files];
  }
  const selected = files.filter(
    (_, i) => i % identity.count === identity.index - 1,
  );
  if (selected.length === 0) {
    throw new Error(
      `${PARTITION_ENV_VAR}='${identity.index}of${identity.count}' selected 0 of ${files.length} discovered test files`,
    );
  }
  return selected;
}

/**
 * Greedy longest-processing-time assignment: files are placed heaviest first
 * (ties broken by path) into the currently lightest partition (ties broken by
 * lowest index). Weights must be positive, so each of the first `count` files
 * seeds a distinct partition and no partition ends up empty. Returns the owned
 * file set for the identity's partition.
 */
function selectBalancedFiles(
  files: readonly string[],
  identity: PartitionIdentity,
  weightOf: (file: string) => number,
): ReadonlySet<string> {
  const loads: number[] = Array.from({ length: identity.count }, () => 0);
  const owners = new Map<string, number>();
  const heaviestFirst = files
    .map((file) => ({ file, weight: weightOf(file) }))
    .sort((a, b) => b.weight - a.weight || (a.file < b.file ? -1 : 1));
  for (const { file, weight } of heaviestFirst) {
    if (!(weight > 0)) {
      throw new Error(`partition weight for '${file}' must be positive`);
    }
    let lightest = 0;
    for (let i = 1; i < loads.length; i++) {
      if (loads[i] < loads[lightest]) lightest = i;
    }
    loads[lightest] += weight;
    owners.set(file, lightest);
  }
  return new Set(
    files.filter((file) => owners.get(file) === identity.index - 1),
  );
}

/**
 * Applies a partition identity to one test root's files. A root with fewer
 * files than partitions (for example the single-file eslint-rules root) runs
 * entirely on partition 1 and is empty elsewhere, so every file still runs
 * exactly once across the partitions without failing the empty legs.
 *
 * Without `weightOf` the slice is round-robin over the sorted files. With it,
 * files are balanced by weight so a few very slow files cannot pile onto one
 * leg.
 */
export function selectRootPartition<T extends { readonly file: string }>(
  entries: readonly T[],
  identity: PartitionIdentity | null,
  weightOf?: (file: string) => number,
): readonly T[] {
  if (identity !== null && entries.length < identity.count) {
    return identity.index === 1 ? entries : [];
  }
  if (weightOf !== undefined && identity !== null && identity.count > 1) {
    const owned = selectBalancedFiles(
      entries.map((entry) => entry.file),
      identity,
      weightOf,
    );
    return entries.filter((entry) => owned.has(entry.file));
  }
  const owned = new Set(
    selectPartition(
      entries.map((entry) => entry.file),
      identity,
    ),
  );
  return entries.filter((entry) => owned.has(entry.file));
}

/**
 * Applies a partition identity to a resolved file list, balancing by the
 * scripts test weights so slow files spread across the legs.
 */
export function selectWeightedPartition<T extends { readonly file: string }>(
  entries: readonly T[],
  identity: PartitionIdentity | null,
  repoRoot: string,
): readonly T[] {
  return selectRootPartition(entries, identity, (file) =>
    scriptsTestFileWeight(repoRoot, file),
  );
}

export interface EmptySelectionOptions {
  readonly workspace: string | null;
  readonly partition: PartitionIdentity | null;
}

export interface EmptySelectionOutput {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

/**
 * Exit status for a run with no files: success only when files matched before
 * partitioning, so another partition owns them.
 */
export function reportEmptySelection(
  options: EmptySelectionOptions,
  output: EmptySelectionOutput,
  totalFiles: number,
): number {
  const { workspace, partition } = options;
  if (totalFiles > 0 && partition !== null) {
    output.stdout(
      `Partition ${partition.index}of${partition.count} owns none of the ${totalFiles} native Bun test files in this root`,
    );
    return 0;
  }
  const scope = workspace ? `workspace "${workspace}"` : 'any workspace';
  output.stderr(`No native Bun test files found for ${scope}.`);
  output.stderr('Roots must be declared in scripts/bun-test-roots.ts.');
  return 1;
}
