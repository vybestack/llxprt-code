/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import type { DensityFilePolicy } from '@vybestack/llxprt-code-core/journal/density-file-facts.js';
import { DensityReadWriteFacts } from '@vybestack/llxprt-code-core/journal/density-read-write-facts.js';
import { nativeRecencyPolicy } from '../../nativeRecencyPolicy.js';
import { densityConfig } from '../density-disk-helpers.js';

export function toolRow(id: string, name: string, path: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'tool_call', id, name, parameters: { path } }],
  };
}
export function resultRow(id: string): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: id,
        toolName: 'read_file',
        result: `response ${id}`,
      },
    ],
  };
}
export function readWritePolicy(
  observe: () => void = () => {},
): DensityFilePolicy {
  const base = nativeRecencyPolicy(densityConfig(1)).files?.facts;
  if (base?.combined === undefined)
    throw new Error('Missing native read/write policy');
  const combined = base.combined;
  return {
    ...base,
    async *combined(snapshot, entry) {
      observe();
      yield* combined(snapshot, entry);
    },
  };
}
export async function readWriteFacts(
  snapshot: VersionSnapshot,
  revision: string,
): Promise<DensityReadWriteFacts> {
  const facts = await snapshot.densityFiles(revision);
  return new DensityReadWriteFacts(facts.reader, await facts.header());
}
