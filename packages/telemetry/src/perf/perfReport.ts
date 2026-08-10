/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Longitudinal perf report data model + stable human formatter (P11,
 * REQ-3167-9, D7).
 *
 * Groups operations by build identity (`llxprt_version` + `git_sha`) within
 * exact comparison dimensions (provider, model, render_mode, terminal_cols,
 * terminal_rows). Computes sample count, contaminated sample count
 * (`concurrent_instances >= 2`, NOT contended), p50 for meaningful timing /
 * counter / token metrics, terminal status counts, and per-file memory slopes
 * from P10.
 *
 * Without `--baseline`: prints grouped matched-dimension p50 / sample /
 * self-health, NO delta.
 *
 * With `--baseline <version|sha>`: each non-baseline group is compared ONLY
 * against baseline rows sharing identical dimensions; unmatched groups are
 * reported as unmatched, NEVER pooled. p50 deltas are absolute and/or percent,
 * grounded in finite math.
 *
 * D1 read-time join: token-usage / session rows carrying a `prompt_id` are
 * joined to a perf operation by deriving the operation_id at read time via
 * `promptId.split('#continuation#')[0]`. Since no persisted token-usage source
 * exists in the perf JSONL format, a typed row consumer API is exposed for
 * P12 / report integration rather than inventing a file format.
 */

import type {
  PerfOperationRecord,
  PerfMemorySampleRecord,
  PerfTerminalStatus,
} from './perfRecords.js';
import { joinKeyFromPromptId } from './perfRecords.js';
import type { PerfConsumerCounts } from './perfConsumer.js';
import {
  derivePerOperationMemorySlope,
  derivePerMinuteMemorySlope,
} from './perfSlopeBridge.js';
import type {
  PerOperationMemorySlope,
  PerMinuteMemorySlope,
} from './perfSlopeBridge.js';

// ===========================================================================
// D1 read-time join API (typed row consumer for P12 / report integration)
// ===========================================================================

/**
 * A token-usage / session-recording turn row that carries a `prompt_id`. These
 * rows are streamed from the telemetry-owned token-usage JSONL directory by
 * {@link consumeTokenUsageDirectory}; they are NOT persisted in the perf JSONL
 * format. This type is the read-time join input for the report.
 *
 * `promptId` is the initial prompt id or a continuation
 * (`${initial}#continuation#${n}`). The join key is derived by taking the
 * first segment before `#continuation#`. `actualPromptTokens` is the per-send
 * prompt/context token count; `outputTokens` is optional (omitted when the
 * provider did not report it).
 */
export interface PerfTokenUsageRow {
  readonly promptId: string;
  readonly actualPromptTokens: number;
  readonly outputTokens?: number;
}

/**
 * Groups token-usage rows by derived operation id. N continuation rows
 * (sharing the same prefix before `#continuation#`) join to one operation
 * without persisted child ids (D1). The original rows are never mutated.
 *
 * Returns a Map: operationId → token rows for that operation.
 */
export function joinTokenRowsByOperation(
  tokenRows: readonly PerfTokenUsageRow[],
): ReadonlyMap<string, readonly PerfTokenUsageRow[]> {
  const map = new Map<string, PerfTokenUsageRow[]>();
  for (const row of tokenRows) {
    const operationId = joinKeyFromPromptId(row.promptId);
    const list = map.get(operationId);
    if (list !== undefined) {
      list.push(row);
    } else {
      map.set(operationId, [row]);
    }
  }
  return map;
}

/**
 * Aggregated token usage for a single operation id — the SUMMED
 * `actual_prompt_tokens` (context) and `output_tokens` across all continuation
 * rows that join to that operation. This is the O(operation IDs) aggregation
 * that production consumes incrementally instead of retaining all raw rows.
 */
export interface AggregatedTokenUsage {
  readonly contextTokens: number;
  readonly outputTokens: number;
}

/**
 * Aggregates token-usage rows by derived operation id into the compact
 * {@link AggregatedTokenUsage} form. Provided as a bounded helper for tests
 * that have in-memory rows; production uses {@link streamAndAggregateTokenUsage}
 * to stream files and aggregate incrementally with O(operation IDs) memory.
 */
export function aggregateTokenUsageByOperation(
  tokenRows: readonly PerfTokenUsageRow[],
): ReadonlyMap<string, AggregatedTokenUsage> {
  const byOp = new Map<string, AggregatedTokenUsage>();
  for (const row of tokenRows) {
    const operationId = joinKeyFromPromptId(row.promptId);
    const existing = byOp.get(operationId);
    if (existing !== undefined) {
      byOp.set(operationId, {
        contextTokens: existing.contextTokens + row.actualPromptTokens,
        outputTokens: existing.outputTokens + (row.outputTokens ?? 0),
      });
    } else {
      byOp.set(operationId, {
        contextTokens: row.actualPromptTokens,
        outputTokens: row.outputTokens ?? 0,
      });
    }
  }
  return byOp;
}

/**
 * Streams token-usage files from a directory one file at a time and aggregates
 * by derived operation id incrementally, WITHOUT retaining all raw rows.
 * O(operation IDs) memory, not O(total rows). Files are visited in sorted
 * order; each file is streamed line-by-line. A missing directory yields an
 * empty aggregation. Other genuine filesystem errors propagate.
 */
async function streamAndAggregateTokenUsage(
  tokenUsageDir: string,
): Promise<Map<string, AggregatedTokenUsage>> {
  const { streamTokenUsageDirectory } = await import('./tokenUsageReader.js');
  const byOp = new Map<string, AggregatedTokenUsage>();
  for await (const { entry } of streamTokenUsageDirectory(tokenUsageDir)) {
    if (entry.kind !== 'turn') continue;
    const operationId = joinKeyFromPromptId(entry.row.promptId);
    const existing = byOp.get(operationId);
    if (existing !== undefined) {
      byOp.set(operationId, {
        contextTokens: existing.contextTokens + entry.row.actualPromptTokens,
        outputTokens: existing.outputTokens + (entry.row.outputTokens ?? 0),
      });
    } else {
      byOp.set(operationId, {
        contextTokens: entry.row.actualPromptTokens,
        outputTokens: entry.row.outputTokens ?? 0,
      });
    }
  }
  return byOp;
}

// ===========================================================================
// Data model
// ===========================================================================

/** The exact comparison dimensions — never pooled. */
export interface ReportDimensions {
  readonly provider: string;
  readonly model: string;
  readonly render_mode: string;
  readonly terminal_cols: number;
  readonly terminal_rows: number;
}

/** Build identity (the x-axis). */
export interface ReportBuildIdentity {
  readonly llxprt_version: string;
  readonly git_sha: string;
}

/** Per-file memory slopes computed from P10 functions (per run/file, not pooled). */
export interface ReportFileMemorySlopes {
  readonly sourceFile: string;
  readonly runUuid: string;
  readonly perOperation: PerOperationMemorySlope;
  readonly perMinute: PerMinuteMemorySlope;
}

/**
 * A group of operations sharing the same build identity AND dimensions.
 */
export interface ReportGroup {
  readonly dimensions: ReportDimensions;
  readonly build: ReportBuildIdentity;
  readonly sampleCount: number;
  /** Operations with `concurrent_instances >= 2` (contamination, NOT contended). */
  readonly contaminatedSampleCount: number;
  /** p50 for each meaningful metric, or null if no samples. */
  readonly p50: Readonly<Record<string, number | null>>;
  readonly terminalStatusCounts: Readonly<Record<PerfTerminalStatus, number>>;
  readonly memorySlopes: readonly ReportFileMemorySlopes[];
}

/**
 * Baseline comparison result for a non-baseline group.
 */
export interface BaselineComparison {
  readonly matched: boolean;
  /** The p50 deltas vs the baseline group (only present when matched). */
  readonly deltas?: Readonly<
    Record<
      string,
      { readonly absolute: number; readonly percent: number | null }
    >
  >;
}

/**
 * A report group optionally annotated with its baseline comparison.
 */
export interface ReportGroupWithBaseline extends ReportGroup {
  readonly isBaseline: boolean;
  readonly baselineComparison?: BaselineComparison;
}

/**
 * Self-health surfaced in the report.
 *
 * Reader health (`skipped`, `truncated`) always derives from consumer
 * counts. Process-local health (`lastWriteErrorCode`, `evictionCount`) is
 * modelled as a three-state value:
 *   - `undefined` — process-local health is unavailable (not wired by the
 *     caller; e.g. batch reads or default-off CLI). This is NOT a false fact.
 *   - `null` (lastWriteErrorCode) — known: the last write succeeded.
 *   - `0` (evictionCount) — known: zero evictions occurred.
 * Distinguishing `undefined` from `null`/`0` prevents the report from
 * claiming "no write errors" or "zero evictions" when those facts were
 * simply never supplied.
 */
export interface ReportSelfHealth {
  readonly skipped: number;
  readonly truncated: number;
  readonly lastWriteErrorCode: string | null | undefined;
  readonly evictionCount: number | undefined;
}

/** The full report result. */
export interface ReportResult {
  readonly groups: readonly ReportGroupWithBaseline[];
  readonly counts: PerfConsumerCounts;
  readonly selfHealth: ReportSelfHealth;
  readonly baseline: {
    readonly value: string;
    readonly found: boolean;
  } | null;
}

// ===========================================================================
// Metric keys (meaningful recorded timing / counter / token metrics)
// ===========================================================================

/** The p50-eligible metric keys from the operation record. */
const P50_METRIC_KEYS = [
  'operation_elapsed_ms',
  'client_prepare_ms',
  'stream_handler_ms',
  'ink_render_ms',
  'client_finalize_ms',
  'stdout_write_sync_ms',
  'provider_attempt_sum_ms',
  'provider_union_ms',
  'tool_call_sum_ms',
  'tool_union_ms',
  'agent_activity_union_ms',
  'approval_wait_ms',
  'unclassified_elapsed_ms',
  'ink_render_count',
  'stdout_write_calls',
  'provider_attempts',
  'tool_calls',
  'context_tokens',
  'output_tokens',
  'stdout_bytes',
] as const;

export type P50MetricKey = (typeof P50_METRIC_KEYS)[number];

// ===========================================================================
// Internal grouping types
// ===========================================================================

interface GroupedOperation {
  readonly op: PerfOperationRecord;
  readonly sourceFile: string;
  readonly runUuid: string;
}

interface ReportGroupData {
  readonly dims: ReportDimensions;
  readonly build: ReportBuildIdentity;
  readonly ops: GroupedOperation[];
}

// ===========================================================================
// Helpers
// ===========================================================================

function p50(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return sorted[mid - 1];
}

function dimensionKey(d: ReportDimensions): string {
  return [
    d.provider,
    d.model,
    d.render_mode,
    d.terminal_cols,
    d.terminal_rows,
  ].join('|');
}

function buildKey(b: ReportBuildIdentity): string {
  return `${b.llxprt_version}@${b.git_sha}`;
}

function dimsFromOperation(op: PerfOperationRecord): ReportDimensions {
  return {
    provider: op.provider,
    model: op.model,
    render_mode: op.render_mode,
    terminal_cols: op.terminal_cols,
    terminal_rows: op.terminal_rows,
  };
}

function buildFromOperation(op: PerfOperationRecord): ReportBuildIdentity {
  return { llxprt_version: op.llxprt_version, git_sha: op.git_sha };
}

function extractMetric(op: PerfOperationRecord, key: P50MetricKey): number {
  return op[key];
}

function isBaselineBuild(
  build: ReportBuildIdentity,
  baseline: string,
): boolean {
  return build.llxprt_version === baseline || build.git_sha === baseline;
}

const TERMINAL_STATUSES: readonly PerfTerminalStatus[] = [
  'completed',
  'error',
  'cancelled_before_send',
  'cancelled_during_api',
  'cancelled_during_tool',
  'cancelled_during_approval',
  'superseded',
];

// ===========================================================================
// Report builder
// ===========================================================================

/**
 * Builds a longitudinal report from all `perf-*.jsonl` files in a directory.
 *
 * Groups operations by build identity within exact dimensions. Computes p50,
 * contamination, terminal status counts, and per-file memory slopes.
 *
 * Without baseline: groups + p50 / sample / self-health, NO delta.
 * With baseline: each non-baseline group is compared to the baseline group
 * with matching dimensions; unmatched groups reported as unmatched.
 *
 * Self-health (`lastWriteErrorCode`, `evictionCount`): when not provided they
 * remain `undefined` (unavailable), NOT `null`/`0` (known-no-error/zero). P12
 * wires the live sink/retention state; the CLI command injects it when the
 * active perf runtime is available. When unavailable the report formats them
 * honestly as "unavailable" rather than claiming zero errors/evictions.
 *
 * `tokenUsageDir` (optional) is a telemetry-owned token-usage JSONL directory.
 * When provided, its turn rows are STREAMED file-by-file and aggregated by
 * derived operation id incrementally (O(operation IDs) memory, never retaining
 * all raw rows) so that one initial send plus its N continuations contribute
 * SUMMED `actual_prompt_tokens`/`output_tokens` to the single matched perf
 * operation (D1 continuation join). Unmatched operations retain their
 * persisted perf token totals. The join never imports packages/agents and
 * never mutates the token rows.
 */
export async function buildReport(
  dir: string,
  baseline?: string,
  selfHealth?: Partial<ReportSelfHealth>,
  tokenUsageDir?: string,
): Promise<ReportResult> {
  const { consumePerfDirectory } = await import('./perfConsumer.js');
  const { entries, counts } = await consumePerfDirectory(dir);

  const groupedOps: GroupedOperation[] = [];
  const memorySamplesByFile = new Map<string, PerfMemorySampleRecord[]>();

  for (const ce of entries) {
    if (ce.entry.kind !== 'ok') continue;
    if (ce.entry.record.record_type === 'operation') {
      groupedOps.push({
        op: ce.entry.record,
        sourceFile: ce.sourceFile,
        runUuid: ce.runUuid,
      });
    } else {
      const list = memorySamplesByFile.get(ce.sourceFile);
      if (list !== undefined) {
        list.push(ce.entry.record);
      } else {
        memorySamplesByFile.set(ce.sourceFile, [ce.entry.record]);
      }
    }
  }

  // Stream and aggregate token rows by operation id incrementally — never
  // retain all raw rows for the entire directory.
  let aggregatedTokens: ReadonlyMap<string, AggregatedTokenUsage> | undefined;
  if (tokenUsageDir !== undefined) {
    aggregatedTokens = await streamAndAggregateTokenUsage(tokenUsageDir);
  }

  return assembleReport(
    groupedOps,
    memorySamplesByFile,
    counts,
    baseline,
    selfHealth,
    aggregatedTokens,
  );
}

/**
 * Groups operations by (dimensions, build) into a map keyed by the composite key.
 */
function groupOperationsByDimension(
  groupedOps: readonly GroupedOperation[],
): Map<string, ReportGroupData> {
  const groupMap = new Map<string, ReportGroupData>();
  for (const gop of groupedOps) {
    const dims = dimsFromOperation(gop.op);
    const build = buildFromOperation(gop.op);
    const key = `${dimensionKey(dims)}::${buildKey(build)}`;
    let g = groupMap.get(key);
    if (g === undefined) {
      g = { dims, build, ops: [] };
      groupMap.set(key, g);
    }
    g.ops.push(gop);
  }
  return groupMap;
}

/**
 * Resolves a token metric for one operation from the aggregated join map, or
 * `undefined` when there is no join match (caller falls back to the persisted
 * perf total). Extracted so {@link computeP50Values} stays shallow.
 */
function joinedTokenValue(
  op: PerfOperationRecord,
  metricKey: P50MetricKey,
  aggregatedTokens: ReadonlyMap<string, AggregatedTokenUsage>,
): number | undefined {
  const joined = aggregatedTokens.get(op.operation_id);
  if (joined === undefined) return undefined;
  if (metricKey === 'context_tokens') return joined.contextTokens;
  if (metricKey === 'output_tokens') return joined.outputTokens;
  return undefined;
}

/**
 * Computes p50 values for all P50 metric keys from the given operation records.
 *
 * When `aggregatedTokens` is provided, matched operations (operation_id present
 * in the join map) use the SUMMED joined token metrics (actual_prompt_tokens →
 * context_tokens, output_tokens → output_tokens) instead of the persisted perf
 * token totals. This is the read-time continuation join (D1): N continuation
 * rows collapse onto the single perf operation. Unmatched operations retain
 * their persisted perf token totals. The join never adds to persisted totals
 * (it replaces them for matched operations), so continuations are never
 * double-counted.
 */
function computeP50Values(
  opsRecords: readonly PerfOperationRecord[],
  aggregatedTokens?: ReadonlyMap<string, AggregatedTokenUsage>,
): Record<string, number | null> {
  const p50Values: Record<string, number | null> = {};
  for (const metricKey of P50_METRIC_KEYS) {
    const values = opsRecords.map((o) => {
      if (aggregatedTokens !== undefined) {
        const joined = joinedTokenValue(o, metricKey, aggregatedTokens);
        if (joined !== undefined) return joined;
      }
      return extractMetric(o, metricKey);
    });
    p50Values[metricKey] = p50(values);
  }
  return p50Values;
}

/**
 * Counts terminal statuses for each of the seven statuses.
 */
function countTerminalStatuses(
  opsRecords: readonly PerfOperationRecord[],
): Record<PerfTerminalStatus, number> {
  const terminalStatusCounts = {} as Record<PerfTerminalStatus, number>;
  for (const status of TERMINAL_STATUSES) {
    terminalStatusCounts[status] = opsRecords.filter(
      (o) => o.status === status,
    ).length;
  }
  return terminalStatusCounts;
}

/**
 * Computes per-file memory slopes (per run/file, never pooled across files).
 *
 * The run UUID always comes from an actual operation in the file (never an
 * invented `unknown` fallback): the consumer guarantees a non-null run UUID
 * for every perf JSONL file, and `sourceFile` is derived from the same op set.
 */
function computeMemorySlopes(
  ops: readonly GroupedOperation[],
  memorySamplesByFile: ReadonlyMap<string, PerfMemorySampleRecord[]>,
): ReportFileMemorySlopes[] {
  const byFile = new Map<
    string,
    { readonly runUuid: string; readonly fileOps: PerfOperationRecord[] }
  >();
  for (const gop of ops) {
    let entry = byFile.get(gop.sourceFile);
    if (entry === undefined) {
      entry = { runUuid: gop.runUuid, fileOps: [] };
      byFile.set(gop.sourceFile, entry);
    }
    entry.fileOps.push(gop.op);
  }

  const memorySlopes: ReportFileMemorySlopes[] = [];
  for (const [sourceFile, { runUuid, fileOps }] of byFile) {
    const fileSamples = memorySamplesByFile.get(sourceFile) ?? [];
    memorySlopes.push({
      sourceFile,
      runUuid,
      perOperation: derivePerOperationMemorySlope(fileOps),
      perMinute: derivePerMinuteMemorySlope(fileSamples),
    });
  }
  return memorySlopes;
}

/**
 * Builds a single `ReportGroupWithBaseline` from grouped operation data.
 */
function buildGroup(
  g: ReportGroupData,
  memorySamplesByFile: ReadonlyMap<string, PerfMemorySampleRecord[]>,
  baseline: string | undefined,
  aggregatedTokens?: ReadonlyMap<string, AggregatedTokenUsage>,
): ReportGroupWithBaseline {
  const opsRecords = g.ops.map((o) => o.op);
  const group: ReportGroup = {
    dimensions: g.dims,
    build: g.build,
    sampleCount: opsRecords.length,
    contaminatedSampleCount: opsRecords.filter(
      (o) => o.concurrent_instances >= 2,
    ).length,
    p50: computeP50Values(opsRecords, aggregatedTokens),
    terminalStatusCounts: countTerminalStatuses(opsRecords),
    memorySlopes: computeMemorySlopes(g.ops, memorySamplesByFile),
  };
  return {
    ...group,
    isBaseline: baseline !== undefined && isBaselineBuild(g.build, baseline),
  };
}

/**
 * Computes pooled baseline p50 lookups by dimension key.
 *
 * When `--baseline` is an exact version (or sha) matching multiple git_sha
 * builds with the same dimensions, ALL matching baseline operation rows for
 * those dimensions are pooled and the p50 is computed over every row — not
 * just whichever baseline build group was last in a Map (the previous
 * overwrite bug). Baseline build groups are preserved as separate output
 * groups; only the comparison baseline is pooled.
 */
function buildPooledBaselineByDims(
  baselineOps: readonly GroupedOperation[],
  aggregatedTokens?: ReadonlyMap<string, AggregatedTokenUsage>,
): ReadonlyMap<string, Readonly<Record<string, number | null>>> {
  const byDims = new Map<string, PerfOperationRecord[]>();
  for (const gop of baselineOps) {
    const dk = dimensionKey(dimsFromOperation(gop.op));
    const list = byDims.get(dk);
    if (list !== undefined) {
      list.push(gop.op);
    } else {
      byDims.set(dk, [gop.op]);
    }
  }

  const result = new Map<string, Readonly<Record<string, number | null>>>();
  for (const [dk, ops] of byDims) {
    result.set(dk, computeP50Values(ops, aggregatedTokens));
  }
  return result;
}

/**
 * Computes the baseline comparison for a non-baseline group. Returns
 * `matched: false` when no baseline shares the group's dimensions; otherwise
 * computes per-metric absolute and percent deltas.
 */
function compareAgainstBaseline(
  group: ReportGroupWithBaseline,
  baselineP50: Readonly<Record<string, number | null>>,
): BaselineComparison {
  const deltas: Record<
    string,
    { readonly absolute: number; readonly percent: number | null }
  > = {};
  for (const metricKey of P50_METRIC_KEYS) {
    const current = group.p50[metricKey];
    const base = baselineP50[metricKey];
    if (current !== null && base !== null) {
      const absolute = current - base;
      const percent = base !== 0 ? (absolute / base) * 100 : null;
      deltas[metricKey] = { absolute, percent };
    }
  }
  return { matched: true, deltas };
}

/**
 * Applies baseline comparison to all non-baseline groups using the pooled
 * baseline p50 map (computed over ALL matching baseline rows per dimension).
 */
function applyBaseline(
  groups: readonly ReportGroupWithBaseline[],
  baseline: string,
  pooledBaselineByDims: ReadonlyMap<
    string,
    Readonly<Record<string, number | null>>
  >,
): {
  readonly groups: readonly ReportGroupWithBaseline[];
  readonly baselineInfo: { readonly value: string; readonly found: boolean };
} {
  const compared = groups.map((group) => {
    if (group.isBaseline) return group;
    const baselineP50 = pooledBaselineByDims.get(
      dimensionKey(group.dimensions),
    );
    if (baselineP50 === undefined) {
      return { ...group, baselineComparison: { matched: false } };
    }
    return {
      ...group,
      baselineComparison: compareAgainstBaseline(group, baselineP50),
    };
  });

  return {
    groups: compared,
    baselineInfo: {
      value: baseline,
      found: pooledBaselineByDims.size > 0,
    },
  };
}

/**
 * Resolves self-health with fallback defaults from consumer counts.
 *
 * `skipped` includes every non-parsed skipped line EXCEPT truncated (which
 * remains separately surfaced): malformed + future + unversioned + blank.
 * Truncated is never double-counted here.
 *
 * Process-local health (`lastWriteErrorCode`, `evictionCount`) is NOT
 * defaulted to a false fact: when the caller does not supply them they
 * remain `undefined` (unavailable), not `null`/`0` (known-no-error/zero).
 */
function resolveSelfHealth(
  counts: PerfConsumerCounts,
  selfHealth?: Partial<ReportSelfHealth>,
): ReportSelfHealth {
  return {
    skipped:
      selfHealth?.skipped ??
      counts.malformed +
        counts.futureVersion +
        counts.unversioned +
        counts.blank,
    truncated: selfHealth?.truncated ?? counts.truncated,
    lastWriteErrorCode: selfHealth?.lastWriteErrorCode,
    evictionCount: selfHealth?.evictionCount,
  };
}

/**
 * Assembles a report from pre-grouped data. Exposed for testing and P12
 * integration where entries may come from a non-filesystem source.
 *
 * `aggregatedTokens` (optional) is the pre-aggregated read-time join input:
 * per-operation-id SUMMED `actual_prompt_tokens`/`output_tokens` aggregated
 * incrementally from the token-usage JSONL directory. For every operation
 * present in the join map, the report's token metrics use the SUMMED values
 * instead of the persisted perf totals (D1 continuation join). Unmatched
 * operations retain their persisted perf token totals.
 */
export function assembleReport(
  groupedOps: readonly GroupedOperation[],
  memorySamplesByFile: ReadonlyMap<string, PerfMemorySampleRecord[]>,
  counts: PerfConsumerCounts,
  baseline: string | undefined,
  selfHealth?: Partial<ReportSelfHealth>,
  aggregatedTokens?: ReadonlyMap<string, AggregatedTokenUsage>,
): ReportResult {
  const groupMap = groupOperationsByDimension(groupedOps);

  const groups: ReportGroupWithBaseline[] = [];
  for (const g of groupMap.values()) {
    groups.push(buildGroup(g, memorySamplesByFile, baseline, aggregatedTokens));
  }

  // Sort groups deterministically.
  groups.sort((a, b) => {
    const dk = dimensionKey(a.dimensions).localeCompare(
      dimensionKey(b.dimensions),
    );
    if (dk !== 0) return dk;
    return buildKey(a.build).localeCompare(buildKey(b.build));
  });

  // Apply baseline comparison if requested.
  let baselineResult: ReportResult['baseline'] = null;
  let finalGroups: readonly ReportGroupWithBaseline[] = groups;

  if (baseline !== undefined) {
    const baselineOps = groupedOps.filter((gop) =>
      isBaselineBuild(buildFromOperation(gop.op), baseline),
    );
    const pooledBaselineByDims = buildPooledBaselineByDims(
      baselineOps,
      aggregatedTokens,
    );
    const result = applyBaseline(groups, baseline, pooledBaselineByDims);
    finalGroups = result.groups;
    baselineResult = result.baselineInfo;
  }

  return {
    groups: finalGroups,
    counts,
    selfHealth: resolveSelfHealth(counts, selfHealth),
    baseline: baselineResult,
  };
}

// ===========================================================================
// Stable human formatter
// ===========================================================================

/**
 * Formats a report result into a stable, human-readable string.
 *
 * The output is deterministic: groups are listed in sorted order, metrics are
 * listed in a fixed order, and no delta appears when no baseline was provided.
 */
export function formatReport(report: ReportResult): string {
  const lines: string[] = [];

  lines.push('Perf Report');
  lines.push('===========');
  lines.push('');

  const c = report.counts;
  lines.push(`Files scanned: ${c.files} (${formatBytes(c.bytes)})`);
  lines.push(
    `Records: parsed=${c.parsed}  malformed=${c.malformed}  future=${c.futureVersion}  unversioned=${c.unversioned}  truncated=${c.truncated}  blank=${c.blank}`,
  );
  lines.push('');

  const sh = report.selfHealth;
  lines.push('Self-health:');
  lines.push(`  skipped: ${sh.skipped}`);
  lines.push(`  truncated: ${sh.truncated}`);
  lines.push(
    `  last write error: ${formatWriteErrorCode(sh.lastWriteErrorCode)}`,
  );
  lines.push(`  evictions: ${sh.evictionCount ?? 'unavailable'}`);
  lines.push('');

  if (report.baseline !== null) {
    if (report.baseline.found) {
      lines.push(`Baseline: ${report.baseline.value} (matched)`);
    } else {
      lines.push(`Baseline: ${report.baseline.value} (NO MATCH FOUND)`);
    }
    lines.push('');
  }

  if (report.groups.length === 0) {
    lines.push('No operation records found.');
    return lines.join('\n');
  }

  for (const group of report.groups) {
    lines.push(formatGroup(group));
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function formatGroup(group: ReportGroupWithBaseline): string {
  const lines: string[] = [];
  const d = group.dimensions;
  const b = group.build;
  lines.push(
    `[${b.llxprt_version}@${b.git_sha}]  provider=${d.provider}  model=${d.model}  render=${d.render_mode}  cols=${d.terminal_cols}  rows=${d.terminal_rows}`,
  );
  lines.push(
    `  samples: ${group.sampleCount}  contaminated: ${group.contaminatedSampleCount}`,
  );

  const statusParts: string[] = [];
  for (const [status, count] of Object.entries(group.terminalStatusCounts)) {
    if (count > 0) {
      statusParts.push(`${status}=${count}`);
    }
  }
  if (statusParts.length > 0) {
    lines.push(`  status: ${statusParts.join('  ')}`);
  }

  const p50Lines: string[] = [];
  for (const metricKey of P50_METRIC_KEYS) {
    const val = group.p50[metricKey];
    if (val === null) continue;
    p50Lines.push(formatMetricLine(metricKey, val, group));
  }
  if (p50Lines.length > 0) {
    lines.push('  p50:');
    lines.push(...p50Lines);
  }

  if (group.baselineComparison && !group.baselineComparison.matched) {
    lines.push('  WARNING: UNMATCHED (no baseline with same dimensions)');
  }

  if (group.memorySlopes.length > 0) {
    lines.push('  memory slopes (per file):');
    for (const ms of group.memorySlopes) {
      lines.push(`    ${ms.sourceFile} (run ${ms.runUuid}):`);
      const ops = ms.perOperation;
      const mins = ms.perMinute;
      lines.push(
        `      per-op: rss=${formatNullable(ops.rss_bytes_per_operation)}  heap=${formatNullable(ops.heap_used_bytes_per_operation)}  external=${formatNullable(ops.external_bytes_per_operation)}  array_buffers=${formatNullable(ops.array_buffers_bytes_per_operation)}`,
      );
      lines.push(
        `      per-min: rss=${formatNullable(mins.rss_bytes_per_minute)}  heap=${formatNullable(mins.heap_used_bytes_per_minute)}  external=${formatNullable(mins.external_bytes_per_minute)}  array_buffers=${formatNullable(mins.array_buffers_bytes_per_minute)}`,
      );
    }
  }

  return lines.join('\n');
}

function formatMetricLine(
  metricKey: string,
  val: number,
  group: ReportGroupWithBaseline,
): string {
  let line = `  ${metricKey}: p50=${formatNumber(val)}`;
  const bc = group.baselineComparison;
  if (bc?.matched === true) {
    const delta = bc.deltas?.[metricKey];
    if (delta !== undefined) {
      line += formatDelta(delta);
    }
  }
  return line;
}

function formatPercent(percent: number | null): string {
  if (percent === null) return 'n/a%';
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(1)}%`;
}

function formatDelta(delta: {
  readonly absolute: number;
  readonly percent: number | null;
}): string {
  const sign = delta.absolute >= 0 ? '+' : '';
  return `  (delta ${sign}${formatNumber(delta.absolute)} / ${formatPercent(delta.percent)})`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(2);
}

function formatNullable(n: number | null): string {
  return n === null ? 'n/a' : formatNumber(n);
}

/**
 * Formats the process-local write-error code for the self-health surface,
 * preserving the three-state distinction: `undefined` (unavailable) →
 * 'unavailable'; `null` (known: last write succeeded) → 'none'; a string
 * errno → the code itself.
 */
function formatWriteErrorCode(code: string | null | undefined): string {
  if (code === undefined) return 'unavailable';
  return code ?? 'none';
}
