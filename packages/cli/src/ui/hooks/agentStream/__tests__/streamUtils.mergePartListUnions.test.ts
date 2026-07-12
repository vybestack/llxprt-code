/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for streamUtils.ts `mergePartListUnions`.
 *
 * Split out of streamUtils.test.ts to keep each test file within the
 * project's max-lines limit. Covers neutral ContentBlock normalization,
 * preservation of all ContentBlock variants, and IContent/IContent[]
 * flattening. `mergePartListUnions` is a pure function with no dependency on
 * the module mocks used by the sibling suite, so this file intentionally
 * imports the real implementation without any `vi.mock` setup.
 */

import { describe, it, expect } from 'vitest';
import { mergePartListUnions } from '../streamUtils.js';

// ─── mergePartListUnions ──────────────────────────────────────────────────────

describe('mergePartListUnions', () => {
  // mergePartListUnions accepts AgentRequestInput[] (neutral AgentMessageInput).
  // Legacy { text } shapes are passed via unknown cast to exercise the
  // runtime normalization path.
  type Input = Parameters<typeof mergePartListUnions>[0];

  it('merges string items into neutral ContentBlock text parts', () => {
    const result = mergePartListUnions(['hello', 'world']);
    expect(result).toStrictEqual([
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ]);
  });

  it('merges legacy { text } objects into neutral ContentBlock text parts', () => {
    const result = mergePartListUnions([{ text: 'foo' }] as unknown as Input);
    expect(result).toStrictEqual([{ type: 'text', text: 'foo' }]);
  });

  it('passes through already-neutral ContentBlock objects', () => {
    const result = mergePartListUnions([
      { type: 'text', text: 'foo' },
    ] as unknown as Input);
    expect(result).toStrictEqual([{ type: 'text', text: 'foo' }]);
  });

  it('merges arrays of string/legacy-object into ContentBlock[]', () => {
    const result = mergePartListUnions([
      ['a', { text: 'b' }],
    ] as unknown as Input);
    expect(result).toStrictEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(mergePartListUnions([])).toStrictEqual([]);
  });

  it('flattens nested arrays into ContentBlock[]', () => {
    const result = mergePartListUnions([['a', 'b'], ['c'], 'd'] as Input);
    expect(result).toStrictEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
      { type: 'text', text: 'c' },
      { type: 'text', text: 'd' },
    ]);
  });

  it('drops unsupported deeply nested arrays without emitting invalid blocks', () => {
    const result = mergePartListUnions([
      'x',
      { text: 'y' },
      [['z']],
    ] as unknown as Input);
    expect(result).toStrictEqual([
      { type: 'text', text: 'x' },
      { type: 'text', text: 'y' },
    ]);
  });
});

// ─── mergePartListUnions — ContentBlock variant preservation ──────────────────

describe('mergePartListUnions — preserves all ContentBlock variants', () => {
  type Input = Parameters<typeof mergePartListUnions>[0];

  it('preserves thinking blocks', () => {
    const result = mergePartListUnions([
      { type: 'thinking', thought: 'I should think about this' },
    ] as unknown as Input);
    expect(result).toStrictEqual([
      { type: 'thinking', thought: 'I should think about this' },
    ]);
  });

  it('preserves tool_call blocks', () => {
    const result = mergePartListUnions([
      {
        type: 'tool_call',
        id: 'call-1',
        name: 'read_file',
        parameters: { path: '/foo' },
      },
    ] as unknown as Input);
    expect(result).toStrictEqual([
      {
        type: 'tool_call',
        id: 'call-1',
        name: 'read_file',
        parameters: { path: '/foo' },
      },
    ]);
  });

  it('preserves tool_response blocks', () => {
    const result = mergePartListUnions([
      {
        type: 'tool_response',
        callId: 'call-1',
        toolName: 'read_file',
        result: 'contents',
      },
    ] as unknown as Input);
    expect(result).toStrictEqual([
      {
        type: 'tool_response',
        callId: 'call-1',
        toolName: 'read_file',
        result: 'contents',
      },
    ]);
  });

  it('preserves media blocks', () => {
    const result = mergePartListUnions([
      {
        type: 'media',
        mimeType: 'image/png',
        data: 'data',
        encoding: 'base64',
      },
    ] as unknown as Input);
    expect(result).toStrictEqual([
      {
        type: 'media',
        mimeType: 'image/png',
        data: 'data',
        encoding: 'base64',
      },
    ]);
  });

  it('preserves code blocks', () => {
    const result = mergePartListUnions([
      { type: 'code', code: 'console.log("hello")' },
    ] as unknown as Input);
    expect(result).toStrictEqual([
      { type: 'code', code: 'console.log("hello")' },
    ]);
  });

  it('preserves mixed ContentBlock variants in order', () => {
    const result = mergePartListUnions([
      { type: 'text', text: 'hello' },
      { type: 'thinking', thought: 'thinking...' },
      {
        type: 'tool_call',
        id: 'c1',
        name: 'search',
        parameters: {},
      },
      {
        type: 'tool_response',
        callId: 'c1',
        toolName: 'search',
        result: 'found',
      },
      { type: 'media', mimeType: 'image/png', data: 'd', encoding: 'base64' },
      { type: 'code', code: 'x = 1' },
    ] as unknown as Input);
    expect(result).toHaveLength(6);
    expect(result.map((b) => b.type)).toStrictEqual([
      'text',
      'thinking',
      'tool_call',
      'tool_response',
      'media',
      'code',
    ]);
  });
});

describe('mergePartListUnions — flattens IContent/IContent[] blocks', () => {
  type Input = Parameters<typeof mergePartListUnions>[0];

  it('flattens a single IContent by extracting its blocks', () => {
    const iContent = {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'part1' },
        { type: 'text', text: 'part2' },
      ],
    };
    const result = mergePartListUnions([iContent] as unknown as Input);
    expect(result).toStrictEqual([
      { type: 'text', text: 'part1' },
      { type: 'text', text: 'part2' },
    ]);
  });

  it('flattens IContent with mixed block types preserving order', () => {
    const iContent = {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'before' },
        {
          type: 'tool_call',
          id: 'c1',
          name: 'read',
          parameters: {},
        },
        { type: 'text', text: 'after' },
      ],
    };
    const result = mergePartListUnions([iContent] as unknown as Input);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ type: 'text', text: 'before' });
    expect(result[1]).toMatchObject({ type: 'tool_call', name: 'read' });
    expect(result[2]).toMatchObject({ type: 'text', text: 'after' });
  });

  it('flattens IContent[] (multi-turn) in order', () => {
    const turn1 = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'turn1' }],
    };
    const turn2 = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'c1',
          toolName: 'read',
          result: 'ok',
        },
      ],
    };
    const result = mergePartListUnions([turn1, turn2] as unknown as Input);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: 'text', text: 'turn1' });
    expect(result[1]).toMatchObject({
      type: 'tool_response',
      toolName: 'read',
    });
  });

  it('flattens IContent[] nested inside arrays (AgentRequestInput union)', () => {
    const turn = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'nested' }],
    };
    const result = mergePartListUnions([[turn]] as unknown as Input);
    expect(result).toStrictEqual([{ type: 'text', text: 'nested' }]);
  });

  it('flattens mixed strings, ContentBlocks, and IContent without loss', () => {
    const iContent = {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'from-icontent' },
        { type: 'code', code: 'x=1' },
      ],
    };
    const result = mergePartListUnions([
      'bare string',
      { type: 'text', text: 'block' },
      iContent,
    ] as unknown as Input);
    expect(result).toHaveLength(4);
    expect(result.map((b) => b.type)).toStrictEqual([
      'text',
      'text',
      'text',
      'code',
    ]);
  });

  it('preserves multi-turn IContent blocks across separate inputs', () => {
    const t1 = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'q' }],
    };
    const t2 = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'a' }],
    };
    const t3 = {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'c1',
          name: 'write',
          parameters: {},
        },
      ],
    };
    const t4 = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'c1',
          toolName: 'write',
          result: 'ok',
        },
      ],
    };
    const result = mergePartListUnions([t1, t2, t3, t4] as unknown as Input);
    expect(result).toHaveLength(4);
    expect(result.map((b) => b.type)).toStrictEqual([
      'text',
      'text',
      'tool_call',
      'tool_response',
    ]);
  });
});
