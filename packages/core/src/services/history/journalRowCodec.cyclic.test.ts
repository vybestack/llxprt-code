/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from './IContent.js';
import { encodeContentRow, UNOWNED_ROW } from './journalRowCodec.js';

interface Cyclic {
  label: string;
  self?: Cyclic;
}

function cyclic(label: string): Cyclic {
  const value: Cyclic = { label };
  value.self = value;
  return value;
}

describe('journal row codec and payloads that refer to themselves', () => {
  it('stores cyclic tool call parameters with the marker the old store used, leaving the caller object alone', () => {
    const parameters = cyclic('parameters');
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'tool_call', id: 'call-1', name: 'tool', parameters }],
    };

    const draft = encodeContentRow(content, { owner: UNOWNED_ROW });

    const text = new TextDecoder().decode(draft.blocks[0].bytes);
    expect(JSON.parse(text)).toMatchObject({
      parameters: { label: 'parameters', self: { _circular: true } },
    });
    expect(parameters.self).toBe(parameters);
  });

  it('stores cyclic tool results with the marker', () => {
    const content: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call-1',
          toolName: 'tool',
          result: cyclic('result'),
        },
      ],
    };

    const draft = encodeContentRow(content, { owner: UNOWNED_ROW });

    const text = new TextDecoder().decode(draft.blocks[0].bytes);
    expect(JSON.parse(text)).toMatchObject({
      result: { label: 'result', self: { _circular: true } },
    });
  });
});
