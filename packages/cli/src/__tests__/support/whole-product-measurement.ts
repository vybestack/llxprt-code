/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { z } from 'zod';

const pinnedOptions: Readonly<Record<string, string>> = {
  BUN_JSC_forceCodeBlockLiveness: 'true',
};

export function measurementMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): 'default-jsc' | 'pinned-code-v1' {
  const mode = env.W24_MEASUREMENT_MODE ?? 'default-jsc';
  if (mode !== 'default-jsc' && mode !== 'pinned-code-v1')
    throw new Error(`Unknown measurement mode: ${mode}`);
  const expected = mode === 'pinned-code-v1' ? pinnedOptions : {};
  for (const [key, value] of Object.entries(expected)) {
    if (env[key] !== value)
      throw new Error(`Measurement mode requires ${key}=${value}`);
  }
  const options = Object.keys(env).filter(
    (key) => key.startsWith('BUN_JSC_') || key.startsWith('JSC_'),
  );
  for (const key of options) {
    if (key === 'BUN_JSC_dumpOptions' && env[key] === '1') continue;
    if (env[key] !== expected[key] || !(key in expected))
      throw new Error(`Undeclared JSC option: ${key}`);
  }
  return mode;
}

const snapshotSchema = z.object({
  nodes: z.array(z.number()),
  nodeClassNames: z.array(z.string()),
});
const historyDataTypes = new Set([
  'Object',
  'Array',
  'string',
  'String',
  'Cell Butterfly',
  'ArrayBuffer',
  'SharedArrayBuffer',
  'Buffer',
  'DataView',
  'Uint8Array',
  'Uint8ClampedArray',
  'Uint16Array',
  'Uint32Array',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'Float16Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
  'Map',
  'Set',
  'SparseArrayValueMap',
  'BigInt',
]);

export interface HistoryDataCensus {
  readonly dataBytes: number;
  readonly totalBytes: number;
  readonly types: Readonly<Record<string, { count: number; bytes: number }>>;
}

export function historyDataCensus(snapshot: unknown): HistoryDataCensus {
  const parsed = snapshotSchema.parse(snapshot);
  if (parsed.nodes.length % 4 !== 0)
    throw new Error('Incomplete Inspector node');
  const types: Record<string, { count: number; bytes: number }> = {};
  let totalBytes = 0;
  let dataBytes = 0;
  for (let index = 0; index < parsed.nodes.length; index += 4) {
    const bytes = parsed.nodes[index + 1];
    const name = parsed.nodeClassNames.at(parsed.nodes[index + 2]);
    if (name === undefined || !Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error('Invalid Inspector node');
    const previous = types[name] ?? (types[name] = { count: 0, bytes: 0 });
    previous.count += 1;
    previous.bytes += bytes;
    totalBytes += bytes;
    if (historyDataTypes.has(name)) dataBytes += bytes;
  }
  return { dataBytes, totalBytes, types };
}

const ownedSnapshotSchema = snapshotSchema.extend({
  edges: z.array(z.number()),
  edgeTypes: z.array(z.string()),
  edgeNames: z.array(z.string()),
});

/** Count the strong data graph of a named application owner, not JSC's globals. */
export function ownedHistoryDataCensus(
  snapshot: unknown,
  ownerClass: string,
): number {
  const parsed = ownedSnapshotSchema.parse(snapshot);
  if (parsed.nodes.length % 4 !== 0 || parsed.edges.length % 4 !== 0)
    throw new Error('Incomplete Inspector graph');
  const nodes = new Map<number, { bytes: number; name: string }>();
  const pending: number[] = [];
  for (let at = 0; at < parsed.nodes.length; at += 4) {
    const name = parsed.nodeClassNames[parsed.nodes[at + 2]];
    nodes.set(parsed.nodes[at], { bytes: parsed.nodes[at + 1], name });
    if (name === ownerClass) pending.push(parsed.nodes[at]);
  }
  if (pending.length !== 1) throw new Error(`Expected one ${ownerClass} owner`);
  const children = new Map<number, number[]>();
  for (let at = 0; at < parsed.edges.length; at += 4) {
    const type = parsed.edgeTypes[parsed.edges[at + 2]];
    const name = parsed.edgeNames[parsed.edges[at + 3]];
    const prototype =
      type === 'Property' && ['__proto__', 'constructor'].includes(name);
    const strongDataEdge = ['Property', 'Index', 'Internal'].includes(type);
    if (prototype || !strongDataEdge) continue;

    const from = parsed.edges[at];
    const list = children.get(from) ?? [];
    list.push(parsed.edges[at + 1]);
    children.set(from, list);
  }
  const visited = new Set<number>();
  let bytes = 0;
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const id = pending[cursor];
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodes.get(id);
    if (node === undefined) throw new Error('Missing Inspector node');
    if (node.name === ownerClass || historyDataTypes.has(node.name)) {
      bytes += node.bytes;
      for (const child of children.get(id) ?? []) pending.push(child);
    }
  }
  return bytes;
}
