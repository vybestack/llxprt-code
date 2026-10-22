/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { StreamingToolIdMapper } from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import type { NativeRowIds } from './native-row-ids.js';

export interface NativeKimiResolver {
  mappedId(rawId: string): Promise<string | undefined>;
  counterBefore(index: number): Promise<number>;
}

function conversionUse(
  speaker: IContent['speaker'],
  block: ContentBlock,
): { readonly id: string; readonly name: string } | undefined {
  if (speaker === 'ai' && block.type === 'tool_call')
    return { id: block.id, name: block.name };
  if (speaker === 'tool' && block.type === 'tool_response')
    return { id: block.callId, name: block.toolName };
  return undefined;
}

async function kimiRowIds(
  row: IContent,
  index: number,
  resolver: NativeKimiResolver,
): Promise<string[]> {
  let counter: number | undefined;
  const ids: string[] = [];
  for (const block of row.blocks) {
    const use = conversionUse(row.speaker, block);
    if (use === undefined) continue;
    const mapped = await resolver.mappedId(use.id);
    if (mapped !== undefined) ids.push(mapped);
    else {
      counter ??= await resolver.counterBefore(index);
      if (
        !Number.isSafeInteger(counter) ||
        counter < 0 ||
        !Number.isSafeInteger(counter + 1)
      )
        throw new RangeError(
          'Kimi fallback counter must be a nonnegative safe integer',
        );
      ids.push(`functions.${use.name}:${counter++}`);
    }
  }
  return ids;
}

function rowMapper(ids: readonly string[]): StreamingToolIdMapper {
  let next = 0;
  function resolve(): string {
    if (next >= ids.length)
      throw new Error('Kimi converter requested an unprepared row occurrence');
    return ids[next++];
  }
  return {
    observe(): void {},
    resolveToolCallId: resolve,
    resolveToolResponseId: resolve,
  };
}

export function nativeKimiRowIds(resolver: NativeKimiResolver): NativeRowIds {
  return async (row, index) => {
    const ids = await kimiRowIds(row, index, resolver);
    return () => rowMapper(ids);
  };
}

export async function nativeKimiRow(
  row: IContent,
  index: number,
  resolver: NativeKimiResolver,
): Promise<StreamingToolIdMapper> {
  return rowMapper(await kimiRowIds(row, index, resolver));
}
