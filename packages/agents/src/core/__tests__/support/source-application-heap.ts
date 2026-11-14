/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { generateHeapSnapshot } from 'bun';
import { z } from 'zod';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';

const snapshotSchema = z.object({
  nodes: z.array(z.number()),
  nodeClassNames: z.array(z.string()),
});
const compilerStorage = new Set([
  'FunctionCodeBlock',
  'UnlinkedFunctionCodeBlock',
  'ProgramCodeBlock',
  'UnlinkedProgramCodeBlock',
  'EvalCodeBlock',
  'UnlinkedEvalCodeBlock',
  'ModuleProgramCodeBlock',
  'UnlinkedModuleProgramCodeBlock',
]);

export function applicationHeapBytes(snapshot: unknown): number {
  const parsed = snapshotSchema.parse(snapshot);
  if (parsed.nodes.length % 4 !== 0)
    throw new Error('Incomplete Inspector node');
  let total = 0;
  for (let index = 0; index < parsed.nodes.length; index += 4) {
    const bytes = parsed.nodes[index + 1];
    const classIndex = parsed.nodes[index + 2];
    if (
      !Number.isSafeInteger(classIndex) ||
      classIndex < 0 ||
      classIndex >= parsed.nodeClassNames.length
    )
      throw new Error('Invalid Inspector node');
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error('Invalid Inspector node');
    if (!compilerStorage.has(parsed.nodeClassNames[classIndex])) total += bytes;
  }
  return total;
}

export async function sourceApplicationHeap(): Promise<number> {
  await settledHeap();
  return applicationHeapBytes(generateHeapSnapshot());
}
