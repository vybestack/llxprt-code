/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildOpenAIResponsesInput } from '../OpenAIResponsesInputBuilder.js';

const PAIRS = 1000;

function countedHistory(reads: { count: number }): IContent[] {
  const history: IContent[] = [];
  for (let index = 0; index < PAIRS; index += 1) {
    const id = `call-${index}`;
    history.push({
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          get id() {
            reads.count += 1;
            return id;
          },
          name: 'inspect',
          parameters: { index },
        },
      ],
    });
    history.push({
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          get callId() {
            reads.count += 1;
            return id;
          },
          toolName: 'inspect',
          result: { index },
        },
      ],
    });
  }
  return history;
}

describe('OpenAIResponsesInputBuilder tool pairing scale', () => {
  it('reads every tool id a bounded number of times regardless of history length', () => {
    const reads = { count: 0 };
    const history = countedHistory(reads);
    const input = buildOpenAIResponsesInput(history, {
      includeReasoningInContext: true,
      outputLimiterConfig: { getEphemeralSettings: () => ({}) },
      debug: () => {},
      mediaPdfEnabled: true,
    });
    expect(input).toHaveLength(PAIRS * 2);
    // Pairing is one pass over the history plus one read per emitted block.
    // A per-block rescan of the history reads ids quadratically.
    expect(reads.count).toBeLessThanOrEqual(PAIRS * 2 * 3);
  });
});
