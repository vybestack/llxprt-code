/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { estimatePieceFact } from './anthropic-estimate-facts.js';
import { getO200kBaseEncoder } from '../tokenizers/o200kBaseCounter.js';

describe('Anthropic atom tokenizer work', () => {
  for (const count of [2048, 8192]) {
    it(`counts shared payloads once across cache variants for ${count} rows`, async () => {
      const encoder = await getO200kBaseEncoder();
      const encode = spyOn(encoder, 'encode');
      let totalTokens = 0;
      try {
        for (let at = 0; at < count; at++) {
          const text = `row ${at} ${'bounded payload 雪 '.repeat(16)}`;
          const fact = await estimatePieceFact(
            [
              { type: 'text', text },
              {
                type: 'tool_use',
                id: `call_${at}`,
                name: 'read_file',
                input: { text },
              },
              { type: 'tool_result', tool_use_id: `call_${at}`, content: text },
            ],
            'assistant',
          );
          totalTokens += fact.blocks.reduce((total, block) => {
            expect(block.variants).toHaveLength(3);
            return total + block.variants[0].tokens;
          }, 0);
        }
        expect(totalTokens).toBeGreaterThan(count * 100);
        expect(encode.mock.calls.length).toBeLessThanOrEqual(count * 3 + 256);
      } finally {
        encode.mockRestore();
      }
    }, 180000);
  }
});
