/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { firstTruthyString } from '../utils/falsyFallback.js';
import { normalizeToHistoryToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import type { StreamingState } from './OpenAIStreamProcessorState.js';

export function* completeChatToolArguments(
  content: IContent,
  state: StreamingState,
): Generator<IContent> {
  const calls = state.cachedPipelineResult?.normalized ?? [];
  for (const [index, block] of content.blocks.entries()) {
    const call =
      block.type === 'tool_call'
        ? calls.find(
            (candidate) =>
              normalizeToHistoryToolId(
                firstTruthyString(candidate.id, `call_${candidate.index}`),
              ) === block.id,
          )
        : undefined;
    yield {
      speaker: content.speaker,
      blocks: [block],
      ...(index === content.blocks.length - 1 && content.metadata !== undefined
        ? { metadata: content.metadata }
        : {}),
      ...(call !== undefined && block.type === 'tool_call'
        ? {
            toolArgumentDelta: {
              sourceId: String(call.index),
              id: block.id,
              name: block.name,
              nameMode: 'replace',
              arguments: '',
              complete: true,
              replacementArguments: JSON.stringify(block.parameters),
            },
          }
        : {}),
    };
  }
}
