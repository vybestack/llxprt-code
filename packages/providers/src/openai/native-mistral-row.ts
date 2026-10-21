/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { StreamingToolIdMapper } from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';

export interface NativeMistralResolver {
  resolve(rawId: string): Promise<{ readonly id: string }>;
}

function conversionId(
  speaker: IContent['speaker'],
  block: ContentBlock,
): string | undefined {
  if (speaker === 'ai' && block.type === 'tool_call') return block.id;
  if (speaker === 'tool' && block.type === 'tool_response') return block.callId;
  return undefined;
}

export async function nativeMistralRow(
  row: IContent,
  resolver: NativeMistralResolver,
): Promise<StreamingToolIdMapper> {
  const ids = new Map<string, string>();
  for (const block of row.blocks) {
    const rawId = conversionId(row.speaker, block);
    if (rawId !== undefined) ids.set(rawId, (await resolver.resolve(rawId)).id);
  }
  function resolve(rawId: string): string {
    const id = ids.get(rawId);
    if (id === undefined)
      throw new Error('Mistral converter requested an unprepared row id');
    return id;
  }
  return {
    observe(): void {},
    resolveToolCallId: (call) => resolve(call.id),
    resolveToolResponseId: (response) => resolve(response.callId),
  };
}
