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
