/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { measureContent } from './token-usage-measurement.js';

describe('neutral tool-result measurement cost', () => {
  it('measures a single result once for both row and result accounting', () => {
    let calls = 0;
    const result = measureContent(
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_a',
            toolName: 'read',
            result: 'payload',
          },
        ],
      },
      (text) => {
        calls++;
        return text.length;
      },
    );
    expect(result.measurement.tokens).toBe(result.serialized.length);
    expect(result.measurement.toolResults).toStrictEqual([
      {
        callId: 'call_a',
        blockToolName: 'read',
        resultTokens: result.serialized.length,
        wasTruncated: false,
      },
    ]);
    expect(calls).toBe(1);
  });
  it('measures a multi-block row separately from its result', () => {
    const inputs: string[] = [];
    const result = measureContent(
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_a',
            toolName: 'read',
            result: 'payload',
          },
          { type: 'text', text: 'tail' },
        ],
      },
      (text) => {
        inputs.push(text);
        return text.length;
      },
    );
    expect(result.measurement.tokens).toBe(result.serialized.length);
    expect(result.measurement.toolResults[0].resultTokens).toBe(
      inputs[0].length,
    );
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toBe(`${inputs[0]}\ntail`);
  });
});
