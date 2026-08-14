/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Heap-snapshot analyzer for Bun/JSC's V8-format `.heapsnapshot` files.
 *
 *   npm run mem:analyze -- <file.heapsnapshot> [--top 25] [--min-mb 1]
 *
 * It reports what is in the heap (aggregate self_size by type/name) and who is
 * holding it (strong-edge retainer paths from the largest objects). Weak edges
 * are ignored when building retainers, because a weak reference does not keep
 * an object alive.
 *
 * LIMITATIONS — stated explicitly because they are easy to misread:
 *  - This reports self_size, NOT retained size. A container (array, closure,
 *    map) has a small self_size while retaining a great deal of memory, so the
 *    retainer chains matter more than the size table.
 *  - Each node keeps one retainer path — the shortest strong-edge path found
 *    by breadth-first search from the snapshot root — not the full set.
 *  - A retainer path is labeled `proven` ONLY when the walk from the object
 *    reaches the snapshot root within the depth budget; a depth-limited walk
 *    is labeled `truncated` and proves nothing about reachability from the
 *    root; an object the strong-edge BFS never reached is `unreachable`.
 *  - The analyzer is general-purpose and makes no assumption about the host
 *    application's object graph.
 */

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type MetaTypes = ReadonlyArray<readonly string[] | string>;

interface SnapshotMeta {
  readonly node_fields: readonly string[];
  readonly node_types: MetaTypes;
  readonly edge_fields: readonly string[];
  readonly edge_types: MetaTypes;
}

interface HeapSnapshot {
  readonly snapshot: {
    readonly node_count: number;
    readonly edge_count: number;
    readonly meta: SnapshotMeta;
  };
  readonly nodes: readonly number[];
  readonly edges: readonly number[];
  readonly strings: readonly string[];
}

export class SnapshotFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotFormatError';
  }
}

export class AnalyzerParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyzerParseError';
  }
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'number');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isMetaTypesArray(value: unknown): value is Array<string[] | string> {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((el) => typeof el === 'string' || isStringArray(el));
}

function enumAt(metaTypes: MetaTypes, fieldIndex: number): readonly string[] {
  const entry = metaTypes[fieldIndex];
  return Array.isArray(entry) ? entry : [];
}

interface FieldMap {
  readonly nodeLen: number;
  readonly edgeLen: number;
  readonly fType: number;
  readonly fName: number;
  readonly fSelf: number;
  readonly fEdges: number;
  readonly eType: number;
  readonly eName: number;
  readonly eTo: number;
  readonly nodeTypes: readonly string[];
  readonly edgeTypes: readonly string[];
}

interface AggregateRow {
  readonly key: string;
  readonly bytes: number;
  readonly count: number;
  readonly largest: number;
}

interface MutableAggregate {
  key: string;
  bytes: number;
  count: number;
  largest: number;
}

/** Proof status of a retainer path. */
export type RetainerStatus = 'proven' | 'truncated' | 'unreachable';

export interface RetainerPath {
  readonly status: RetainerStatus;
  /**
   * Root-first chain: `ROOT <label>` followed by one `<edge> -> <node>` per
   * hop. Empty for `unreachable`.
   */
  readonly steps: readonly string[];
}

export interface BigObject {
  readonly index: number;
  readonly bytes: number;
  readonly type: string;
  readonly name: string;
  readonly path: RetainerPath;
}

export interface AnalysisReport {
  readonly totalSelf: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly aggregates: readonly AggregateRow[];
  readonly bigObjects: readonly BigObject[];
}

export interface AnalyzeOptions {
  readonly top: number;
  readonly minBytes: number;
  readonly maxRetainerDepth: number;
}

/** Sole source of analyzer defaults; CLI parsing reads these. */
export const DEFAULT_ANALYZE_OPTIONS: AnalyzeOptions = {
  top: 25,
  minBytes: Math.round(0.5 * 1024 * 1024),
  maxRetainerDepth: 12,
};

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SnapshotFormatError(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function buildFieldMap(meta: SnapshotMeta): FieldMap {
  return {
    nodeLen: meta.node_fields.length,
    edgeLen: meta.edge_fields.length,
    fType: meta.node_fields.indexOf('type'),
    fName: meta.node_fields.indexOf('name'),
    fSelf: meta.node_fields.indexOf('self_size'),
    fEdges: meta.node_fields.indexOf('edge_count'),
    eType: meta.edge_fields.indexOf('type'),
    eName: meta.edge_fields.indexOf('name_or_index'),
    eTo: meta.edge_fields.indexOf('to_node'),
    nodeTypes: enumAt(meta.node_types, meta.node_fields.indexOf('type')),
    edgeTypes: enumAt(meta.edge_types, meta.edge_fields.indexOf('type')),
  };
}

function assertValidFieldMap(fields: FieldMap): void {
  const nodeFields: ReadonlyArray<readonly [string, number]> = [
    ['type', fields.fType],
    ['name', fields.fName],
    ['self_size', fields.fSelf],
    ['edge_count', fields.fEdges],
  ];
  for (const [label, index] of nodeFields) {
    if (index < 0) {
      throw new SnapshotFormatError(`node field ${label} not found in meta`);
    }
  }
  if (fields.eType < 0 || fields.eName < 0 || fields.eTo < 0) {
    throw new SnapshotFormatError('required edge fields not found in meta');
  }
  if (fields.nodeTypes.length === 0) {
    throw new SnapshotFormatError(
      'node type enum not found in meta (node_types must list type names)',
    );
  }
  if (fields.edgeTypes.length === 0) {
    throw new SnapshotFormatError(
      'edge type enum not found in meta (edge_types must list type names)',
    );
  }
}

function isFiniteNonnegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && Number.isFinite(value);
}

/**
 * Cross-validates counts, strides, indexes, and enum references so no
 * malformed fixture can silently produce wrong numbers: node/edge array
 * lengths must match their declared counts times their field strides, every
 * node's edge_count must sum to the declared edge_count, every to_node must
 * be stride-aligned and in range, and every type/enum/string index must be in
 * bounds (name_or_index is a numeric slot index for element/hidden edges, a
 * string index otherwise).
 */
function assertConsistentStructure(
  snapshot: HeapSnapshot,
  fields: FieldMap,
): void {
  const { nodes, edges } = snapshot;
  const nodeCount = assertFiniteCount(
    snapshot.snapshot.node_count,
    'node_count',
  );
  const edgeCount = assertFiniteCount(
    snapshot.snapshot.edge_count,
    'edge_count',
  );
  assertTableLength(
    nodes.length,
    nodeCount,
    fields.nodeLen,
    'nodes',
    'node_count',
  );
  assertTableLength(
    edges.length,
    edgeCount,
    fields.edgeLen,
    'edges',
    'edge_count',
  );
  const totalEdges = assertNodesTable(snapshot, fields, nodeCount);
  if (totalEdges !== edgeCount) {
    throw new SnapshotFormatError(
      `per-node edge counts sum to ${totalEdges}, not the declared edge_count ${edgeCount}`,
    );
  }
  assertEdgesTable(snapshot, fields, nodeCount, edgeCount);
}

/** Validates a declared count and returns it. */
function assertFiniteCount(count: number, label: string): number {
  if (!isFiniteNonnegativeInteger(count)) {
    throw new SnapshotFormatError(
      `${label} must be a finite nonnegative integer (got ${count})`,
    );
  }
  return count;
}

/** Validates a flat table's length against count x stride. */
function assertTableLength(
  actual: number,
  count: number,
  stride: number,
  table: string,
  countLabel: string,
): void {
  if (actual !== count * stride) {
    throw new SnapshotFormatError(
      `${table} length ${actual} does not match ${countLabel} ${count} x stride ${stride}`,
    );
  }
}

/**
 * Validates every node row (type enum, self_size, name index, edge count) and
 * returns the sum of per-node edge counts.
 */
function assertNodesTable(
  snapshot: HeapSnapshot,
  fields: FieldMap,
  nodeCount: number,
): number {
  const { nodes, strings } = snapshot;
  let totalEdges = 0;
  for (let i = 0; i < nodeCount; i++) {
    const base = i * fields.nodeLen;
    const typeIndex = nodes[base + fields.fType];
    if (
      !isFiniteNonnegativeInteger(typeIndex) ||
      typeIndex >= fields.nodeTypes.length
    ) {
      throw new SnapshotFormatError(
        `node ${i}: type index ${typeIndex} is outside the node type enum (0..${fields.nodeTypes.length - 1})`,
      );
    }
    const selfSize = nodes[base + fields.fSelf];
    if (!Number.isFinite(selfSize) || selfSize < 0) {
      throw new SnapshotFormatError(
        `node ${i}: self_size ${selfSize} must be a finite nonnegative number`,
      );
    }
    const nameIndex = nodes[base + fields.fName];
    if (!isFiniteNonnegativeInteger(nameIndex) || nameIndex >= strings.length) {
      throw new SnapshotFormatError(
        `node ${i}: name index ${nameIndex} is outside the strings table (0..${strings.length - 1})`,
      );
    }
    const edgeCountHere = nodes[base + fields.fEdges];
    if (!isFiniteNonnegativeInteger(edgeCountHere)) {
      throw new SnapshotFormatError(
        `node ${i}: edge_count ${edgeCountHere} must be a finite nonnegative integer`,
      );
    }
    totalEdges += edgeCountHere;
  }
  return totalEdges;
}

/** Validates every edge row: type enum, stride-aligned in-range to_node, and
 * name_or_index (an integer slot for element/hidden edges, a string index
 * otherwise). */
function assertEdgesTable(
  snapshot: HeapSnapshot,
  fields: FieldMap,
  nodeCount: number,
  edgeCount: number,
): void {
  const { edges, strings } = snapshot;
  for (let e = 0; e < edgeCount; e++) {
    const base = e * fields.edgeLen;
    const typeIndex = edges[base + fields.eType];
    if (
      !isFiniteNonnegativeInteger(typeIndex) ||
      typeIndex >= fields.edgeTypes.length
    ) {
      throw new SnapshotFormatError(
        `edge ${e}: type index ${typeIndex} is outside the edge type enum (0..${fields.edgeTypes.length - 1})`,
      );
    }
    const toNode = edges[base + fields.eTo];
    if (
      !Number.isFinite(toNode) ||
      toNode < 0 ||
      toNode % fields.nodeLen !== 0 ||
      toNode >= nodeCount * fields.nodeLen
    ) {
      throw new SnapshotFormatError(
        `edge ${e}: to_node ${toNode} is not stride-aligned or is outside the node table`,
      );
    }
    const edgeType = fields.edgeTypes[typeIndex];
    const nameOrIndex = edges[base + fields.eName];
    if (edgeType === 'element' || edgeType === 'hidden') {
      if (!isFiniteNonnegativeInteger(nameOrIndex)) {
        throw new SnapshotFormatError(
          `edge ${e}: ${edgeType} name_or_index ${nameOrIndex} must be a nonnegative integer slot index`,
        );
      }
    } else if (
      !isFiniteNonnegativeInteger(nameOrIndex) ||
      nameOrIndex >= strings.length
    ) {
      throw new SnapshotFormatError(
        `edge ${e}: name_or_index ${nameOrIndex} is outside the strings table (0..${strings.length - 1})`,
      );
    }
  }
}

/** Validates an unknown parsed value is a well-formed V8 heap snapshot. */
export function validateSnapshotStructure(value: unknown): HeapSnapshot {
  const root = readObject(value, 'snapshot');
  const snapRecord = readObject(root['snapshot'], 'snapshot.snapshot');
  const metaRecord = readObject(snapRecord['meta'], 'snapshot.snapshot.meta');
  const nodeFields = metaRecord['node_fields'];
  if (!isStringArray(nodeFields)) {
    throw new SnapshotFormatError('meta.node_fields must be a string array');
  }
  const edgeFields = metaRecord['edge_fields'];
  if (!isStringArray(edgeFields)) {
    throw new SnapshotFormatError('meta.edge_fields must be a string array');
  }
  const nodeTypes = metaRecord['node_types'];
  if (!isMetaTypesArray(nodeTypes)) {
    throw new SnapshotFormatError('meta.node_types must be a meta-types array');
  }
  const edgeTypes = metaRecord['edge_types'];
  if (!isMetaTypesArray(edgeTypes)) {
    throw new SnapshotFormatError('meta.edge_types must be a meta-types array');
  }
  const nodes = root['nodes'];
  if (!isNumberArray(nodes)) {
    throw new SnapshotFormatError('snapshot.nodes must be a number array');
  }
  const edges = root['edges'];
  if (!isNumberArray(edges)) {
    throw new SnapshotFormatError('snapshot.edges must be a number array');
  }
  const strings = root['strings'];
  if (!isStringArray(strings)) {
    throw new SnapshotFormatError('snapshot.strings must be a string array');
  }
  const nodeCount = snapRecord['node_count'];
  const edgeCount = snapRecord['edge_count'];
  if (typeof nodeCount !== 'number' || typeof edgeCount !== 'number') {
    throw new SnapshotFormatError('node_count/edge_count must be numbers');
  }
  const meta: SnapshotMeta = {
    node_fields: nodeFields,
    node_types: nodeTypes,
    edge_fields: edgeFields,
    edge_types: edgeTypes,
  };
  const snapshot: HeapSnapshot = {
    snapshot: { node_count: nodeCount, edge_count: edgeCount, meta },
    nodes,
    edges,
    strings,
  };
  const fields = buildFieldMap(meta);
  assertValidFieldMap(fields);
  assertConsistentStructure(snapshot, fields);
  return snapshot;
}

function aggKey(type: string, name: string): string {
  const display =
    name.length > 48 ? `${name.slice(0, 48)}...` : name || '(anonymous)';
  return `${type}:${display}`;
}

function buildEdgeStarts(
  nodes: readonly number[],
  nodeCount: number,
  fields: FieldMap,
): Uint32Array {
  const starts = new Uint32Array(nodeCount + 1);
  let running = 0;
  for (let i = 0; i < nodeCount; i++) {
    starts[i] = running;
    running += nodes[i * fields.nodeLen + fields.fEdges];
  }
  starts[nodeCount] = running;
  return starts;
}

interface RetainerMaps {
  readonly retainerOf: Int32Array;
  readonly retainerEdge: Int32Array;
}

/**
 * Builds one retainer per node via breadth-first search from the snapshot
 * root (node 0) over STRONG edges only.
 *
 * BFS (not "first inbound edge seen while scanning node indices") guarantees
 * each recorded retainer is the one CLOSEST to the root, so the recorded
 * chain is the shortest strong-edge path and does not depend on arbitrary
 * node ordering in the snapshot. Weak edges are skipped because they do not
 * keep an object alive. The resulting parent links form a tree (a node is
 * assigned a parent exactly once, when first discovered), so walking them
 * upward can never cycle.
 */
function buildRetainers(
  edges: readonly number[],
  edgeStarts: Uint32Array,
  nodeCount: number,
  fields: FieldMap,
): RetainerMaps {
  const retainerOf = new Int32Array(nodeCount).fill(-1);
  const retainerEdge = new Int32Array(nodeCount).fill(-1);
  const queue = new Int32Array(nodeCount);
  let head = 0;
  let tail = 0;
  if (nodeCount > 0) {
    queue[tail++] = 0;
  }
  while (head < tail) {
    const from = queue[head++];
    const start = edgeStarts[from];
    const end = edgeStarts[from + 1];
    for (let e = start; e < end; e++) {
      const edgeType =
        fields.edgeTypes[edges[e * fields.edgeLen + fields.eType]];
      if (edgeType === 'weak') {
        continue;
      }
      const to = Math.floor(
        edges[e * fields.edgeLen + fields.eTo] / fields.nodeLen,
      );
      if (to > 0 && to < nodeCount && retainerOf[to] === -1) {
        retainerOf[to] = from;
        retainerEdge[to] = e;
        queue[tail++] = to;
      }
    }
  }
  return { retainerOf, retainerEdge };
}

function aggregateSelf(
  snapshot: HeapSnapshot,
  fields: FieldMap,
  nodeCount: number,
): { readonly rows: AggregateRow[]; readonly total: number } {
  const { nodes } = snapshot;
  const byKey = new Map<string, MutableAggregate>();
  let total = 0;
  for (let i = 0; i < nodeCount; i++) {
    const self = nodes[i * fields.nodeLen + fields.fSelf];
    total += self;
    const type =
      fields.nodeTypes[nodes[i * fields.nodeLen + fields.fType]] ?? '?';
    const name =
      snapshot.strings[nodes[i * fields.nodeLen + fields.fName]] ?? '';
    const key = aggKey(type, name);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { key, bytes: self, count: 1, largest: self });
    } else {
      existing.bytes += self;
      existing.count += 1;
      if (self > existing.largest) {
        existing.largest = self;
      }
    }
  }
  const rows: AggregateRow[] = [...byKey.values()]
    .map((m) => ({
      key: m.key,
      bytes: m.bytes,
      count: m.count,
      largest: m.largest,
    }))
    .sort((a, b) => b.bytes - a.bytes);
  return { rows, total };
}

function edgeLabel(
  snapshot: HeapSnapshot,
  edges: readonly number[],
  fields: FieldMap,
  edgeIndex: number,
): string {
  if (edgeIndex < 0) {
    return '?';
  }
  const type =
    fields.edgeTypes[edges[edgeIndex * fields.edgeLen + fields.eType]] ?? '?';
  const raw = edges[edgeIndex * fields.edgeLen + fields.eName];
  const name =
    type === 'element' || type === 'hidden'
      ? `[${raw}]`
      : (snapshot.strings[raw] ?? '?');
  return `${name} (${type})`;
}

function nodeLabel(
  snapshot: HeapSnapshot,
  fields: FieldMap,
  index: number,
): string {
  const type =
    fields.nodeTypes[snapshot.nodes[index * fields.nodeLen + fields.fType]] ??
    '?';
  const name =
    snapshot.strings[snapshot.nodes[index * fields.nodeLen + fields.fName]] ??
    '';
  return `${type}:${name || '(anonymous)'}`;
}

/**
 * Reconstructs the root-to-object path from the BFS parent tree.
 *
 * `proven`: the walk reached the snapshot root within maxDepth hops — the
 * emitted chain is an exact strong-edge reachability proof.
 * `truncated`: the chain is real but the depth budget ran out before the
 * root; it says nothing about reachability from the root.
 * `unreachable`: the strong-edge BFS never reached this object (it is a GC
 * root itself, or only weakly referenced).
 */
function retainerPath(
  snapshot: HeapSnapshot,
  fields: FieldMap,
  retainers: RetainerMaps,
  start: number,
  maxDepth: number,
): RetainerPath {
  if (start === 0) {
    return {
      status: 'proven',
      steps: [`ROOT ${nodeLabel(snapshot, fields, 0)}`],
    };
  }
  if (retainers.retainerOf[start] === -1) {
    return { status: 'unreachable', steps: [] };
  }
  // Walk child-first from the object toward the root; emit root-first.
  const steps: string[] = [];
  let current = start;
  for (;;) {
    const parent = retainers.retainerOf[current];
    const label = edgeLabel(
      snapshot,
      snapshot.edges,
      fields,
      retainers.retainerEdge[current],
    );
    steps.push(`${label} -> ${nodeLabel(snapshot, fields, current)}`);
    if (parent === 0) {
      steps.push(`ROOT ${nodeLabel(snapshot, fields, 0)}`);
      return { status: 'proven', steps: steps.reverse() };
    }
    if (steps.length >= maxDepth) {
      return { status: 'truncated', steps: steps.reverse() };
    }
    current = parent;
  }
}

function collectBigObjects(
  snapshot: HeapSnapshot,
  fields: FieldMap,
  retainers: RetainerMaps,
  nodeCount: number,
  options: AnalyzeOptions,
): BigObject[] {
  const { nodes } = snapshot;
  const big: BigObject[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const self = nodes[i * fields.nodeLen + fields.fSelf];
    if (self >= options.minBytes) {
      const type =
        fields.nodeTypes[nodes[i * fields.nodeLen + fields.fType]] ?? '?';
      const name =
        snapshot.strings[nodes[i * fields.nodeLen + fields.fName]] ?? '';
      big.push({
        index: i,
        bytes: self,
        type,
        name,
        path: retainerPath(
          snapshot,
          fields,
          retainers,
          i,
          options.maxRetainerDepth,
        ),
      });
    }
  }
  return big.sort((a, b) => b.bytes - a.bytes);
}

/** Analyzes a validated snapshot into a structured report. Pure (no I/O). */
export function analyzeSnapshot(
  snapshot: HeapSnapshot,
  options: AnalyzeOptions = DEFAULT_ANALYZE_OPTIONS,
): AnalysisReport {
  const fields = buildFieldMap(snapshot.snapshot.meta);
  assertValidFieldMap(fields);
  const nodeCount = snapshot.snapshot.node_count;
  const edgeStarts = buildEdgeStarts(snapshot.nodes, nodeCount, fields);
  const retainers = buildRetainers(
    snapshot.edges,
    edgeStarts,
    nodeCount,
    fields,
  );
  const { rows, total } = aggregateSelf(snapshot, fields, nodeCount);
  const bigObjects = collectBigObjects(
    snapshot,
    fields,
    retainers,
    nodeCount,
    options,
  );
  return {
    totalSelf: total,
    nodeCount,
    edgeCount: snapshot.snapshot.edge_count,
    aggregates: rows,
    bigObjects,
  };
}

function fmt(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  if (bytes < 1024 ** 3) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  }
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function renderAggregates(report: AnalysisReport, top: number): string[] {
  const lines = [
    `Top ${top} by total self size`,
    '='.repeat(78),
    'bytes'.padStart(12) +
      'count'.padStart(12) +
      'largest'.padStart(12) +
      '  type:name',
  ];
  for (const row of report.aggregates.slice(0, top)) {
    lines.push(
      fmt(row.bytes).padStart(12) +
        row.count.toLocaleString().padStart(12) +
        fmt(row.largest).padStart(12) +
        `  ${row.key}`,
    );
  }
  return lines;
}

function renderBigObjects(
  report: AnalysisReport,
  options: AnalyzeOptions,
): string[] {
  const lines = [
    '',
    `Largest individual objects (>= ${fmt(options.minBytes)}) and who retains them`,
    '='.repeat(78),
  ];
  const shown = report.bigObjects.slice(0, options.top);
  if (shown.length === 0) {
    lines.push(
      `(no single object >= ${fmt(options.minBytes)}; lower --min-mb)`,
    );
  }
  for (const obj of shown) {
    const preview =
      obj.name.length > 60 ? `${obj.name.slice(0, 60)}...` : obj.name;
    lines.push(`\n${fmt(obj.bytes)}  ${obj.type}  ${preview || '(anonymous)'}`);
    if (obj.path.status === 'unreachable') {
      lines.push(
        '    <- (no strong retainer recorded; likely a GC root or weakly held)',
      );
      continue;
    }
    lines.push(
      obj.path.status === 'proven'
        ? '    root-to-object strong path (proven):'
        : '    path toward root, TRUNCATED at the depth limit — reachability NOT proven:',
    );
    for (const [i, step] of obj.path.steps.entries()) {
      lines.push(`    ${'  '.repeat(i)}${i === 0 ? '' : '-> '}${step}`);
    }
  }
  return lines;
}

/** Renders an AnalysisReport to text. Pure (no I/O). */
export function renderAnalysis(
  report: AnalysisReport,
  options: AnalyzeOptions = DEFAULT_ANALYZE_OPTIONS,
): string {
  const blocks = [
    `Heap total (sum of self_size): ${fmt(report.totalSelf)}`,
    `Nodes: ${report.nodeCount.toLocaleString()}`,
    '',
    ...renderAggregates(report, options.top),
    ...renderBigObjects(report, options),
    '',
    'self_size only — NOT retained size. A container (array, closure, map) has',
    'a small self_size while retaining far more, so read the retainer chains.',
    'Weak edges are ignored; each object shows its shortest strong retainer',
    'path found by breadth-first search from the snapshot root, labeled proven',
    'only when the walk actually reached the root.',
  ];
  return blocks.join('\n');
}

export function loadSnapshot(path: string): HeapSnapshot {
  const sizeMb = statSync(path).size / (1024 * 1024);
  process.stderr.write(`reading ${path} (${sizeMb.toFixed(0)} MB)...\n`);
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return validateSnapshotStructure(parsed);
}

export interface AnalyzeCliOptions {
  readonly file: string;
  readonly top: number;
  readonly minBytes: number;
  readonly maxRetainerDepth: number;
}

const USAGE = `Usage: mem:analyze -- <file.heapsnapshot> [--top N] [--min-mb N]`;

/** Requires the next argv slot after `index` to be a non-flag value. */
function expectNonFlagValue(
  argv: readonly string[],
  index: number,
  name: string,
): string {
  const raw = argv[index + 1];
  if (raw === undefined) {
    throw new AnalyzerParseError(`missing value for ${name}. ${USAGE}`);
  }
  if (raw.length === 0 || raw.startsWith('-')) {
    throw new AnalyzerParseError(
      `invalid value for ${name}: ${raw} (expected a non-flag value). ${USAGE}`,
    );
  }
  return raw;
}

/** Parses a positive finite number option value, failing fast otherwise. */
function parsePositiveNumberOption(
  argv: readonly string[],
  index: number,
  name: string,
): number {
  const raw = expectNonFlagValue(argv, index, name);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new AnalyzerParseError(
      `invalid value for ${name}: ${raw} (expected a positive finite number). ${USAGE}`,
    );
  }
  return value;
}

/** Parses a positive integer option value, failing fast otherwise. */
function parsePositiveIntOption(
  argv: readonly string[],
  index: number,
  name: string,
): number {
  const value = parsePositiveNumberOption(argv, index, name);
  if (!Number.isInteger(value)) {
    throw new AnalyzerParseError(
      `invalid value for ${name}: ${String(argv[index + 1])} (expected an integer). ${USAGE}`,
    );
  }
  return value;
}

/**
 * Parses analyzer argv, failing fast on unknown options, missing or
 * flag-shaped values, nonpositive/nonfinite/non-integer counts, and a missing
 * snapshot file argument. Defaults come exclusively from
 * DEFAULT_ANALYZE_OPTIONS. Exported for testing.
 */
export function parseAnalyzeArgs(argv: readonly string[]): AnalyzeCliOptions {
  let file: string | undefined;
  let top: number | undefined;
  let minMb: number | undefined;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--top') {
      top = parsePositiveIntOption(argv, i, arg);
      i += 2;
    } else if (arg === '--min-mb') {
      minMb = parsePositiveNumberOption(argv, i, arg);
      i += 2;
    } else if (arg.startsWith('-')) {
      throw new AnalyzerParseError(`unknown option: ${arg}. ${USAGE}`);
    } else if (file !== undefined) {
      throw new AnalyzerParseError(
        `unexpected extra argument: ${arg}. ${USAGE}`,
      );
    } else {
      file = arg;
      i += 1;
    }
  }

  if (file === undefined) {
    throw new AnalyzerParseError(`missing snapshot file argument. ${USAGE}`);
  }

  return {
    file,
    top: top ?? DEFAULT_ANALYZE_OPTIONS.top,
    minBytes:
      (minMb ?? DEFAULT_ANALYZE_OPTIONS.minBytes / (1024 * 1024)) * 1024 * 1024,
    maxRetainerDepth: DEFAULT_ANALYZE_OPTIONS.maxRetainerDepth,
  };
}

function main(): void {
  let options: AnalyzeCliOptions;
  try {
    options = parseAnalyzeArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }
  try {
    const snapshot = loadSnapshot(options.file);
    const report = analyzeSnapshot(snapshot, options);
    process.stdout.write(`\n${renderAnalysis(report, options)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
