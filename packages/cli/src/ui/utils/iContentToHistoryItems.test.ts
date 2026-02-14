import { describe, expect, it } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core';
import { ToolCallStatus } from '../types.js';
import { iContentToHistoryItems } from './iContentToHistoryItems.js';

describe('iContentToHistoryItems', () => {
  it('maps human text to user history item', () => {
    const input: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({ type: 'user', text: 'Hello' });
  });

  it('maps ai text and model to gemini history item', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hi!' }],
        metadata: { model: 'claude-4' },
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      type: 'gemini',
      text: 'Hi!',
      model: 'claude-4',
    });
  });

  it('maps ai thinking + text to gemini with thinking blocks', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'hmm' },
          { type: 'text', text: 'Answer' },
        ],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      type: 'gemini',
      text: 'Answer',
      thinkingBlocks: [{ type: 'thinking', thought: 'hmm' }],
    });
  });

  it('maps tool call + tool response into tool group', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'c1', name: 'read_file', parameters: {} },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'read_file',
            result: 'content',
          },
        ],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({ type: 'tool_group' });
    if (output[0].type === 'tool_group') {
      expect(output[0].tools[0]).toMatchObject({
        callId: 'c1',
        name: 'read_file',
        resultDisplay: 'content',
        status: ToolCallStatus.Success,
      });
    }
  });

  it('maps ai text + tool_call to gemini + tool_group', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Running tool' },
          { type: 'tool_call', id: 'c1', name: 'read_file', parameters: {} },
        ],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(2);
    expect(output[0]).toMatchObject({ type: 'gemini', text: 'Running tool' });
    expect(output[1]).toMatchObject({ type: 'tool_group' });
  });

  it('maps code block to markdown in gemini text', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'code', code: 'x=1', language: 'python' }],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      type: 'gemini',
      text: '```python\nx=1\n```',
    });
  });

  it('maps tool error response to error status', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'tool_call', id: 'c1', name: 'run', parameters: {} }],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'run',
            result: { ok: false },
            error: 'Permission denied',
          },
        ],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    if (output[0].type === 'tool_group') {
      expect(output[0].tools[0].status).toBe(ToolCallStatus.Error);
    }
  });

  it('is safe when tool result stringify fails', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'tool_call', id: 'c1', name: 'run', parameters: {} }],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'run',
            result: circular,
          },
        ],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    if (output[0].type === 'tool_group') {
      expect(typeof output[0].tools[0].resultDisplay).toBe('string');
    }
  });

  it('returns empty array for empty input', () => {
    expect(iContentToHistoryItems([])).toEqual([]);
  });

  it('skips human message with only empty text blocks', () => {
    const input: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: '' }] },
    ];
    expect(iContentToHistoryItems(input)).toEqual([]);
  });

  it('silently drops tool response with no matching tool call', () => {
    const input: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'orphan',
            toolName: 'read_file',
            result: 'data',
          },
        ],
      },
    ];
    // Orphan responses are indexed but produce no visible items
    expect(iContentToHistoryItems(input)).toEqual([]);
  });
});
