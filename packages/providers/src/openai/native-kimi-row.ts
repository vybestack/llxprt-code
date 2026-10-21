/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { StreamingToolIdMapper } from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';

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

export async function nativeKimiRow(
  row: IContent,
  index: number,
  resolver: NativeKimiResolver,
): Promise<StreamingToolIdMapper> {
  let counter = await resolver.counterBefore(index);
  const ids: string[] = [];
  for (const block of row.blocks) {
    const use = conversionUse(row.speaker, block);
    if (use === undefined) continue;
    const mapped = await resolver.mappedId(use.id);
    if (mapped !== undefined) ids.push(mapped);
    else {
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
