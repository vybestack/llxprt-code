import { describe, it, expect } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import type { IContent } from '../../services/history/IContent.js';

function callConvert(
  provider: OpenAIProvider,
  contents: IContent[],
  mode: 'native' | 'textual' = 'native',
) {
  return (
    (
      provider as unknown as {
        convertToOpenAIMessages(
          c: IContent[],
          m?: 'native' | 'textual',
        ): ReturnType<OpenAIProvider['convertToOpenAIMessages']>;
      }
    ).convertToOpenAIMessages(contents, mode) ?? []
  );
}

describe('OpenAIProvider.convertToOpenAIMessages', () => {
  const provider = new OpenAIProvider('test-key');

  it('normalizes tool-call arguments that are undefined or non-JSON strings', () => {
    const contents: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_123',
            name: 'lookup',
            parameters: undefined,
          },
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_456',
            name: 'lookup',
            parameters: '{"city":"sf"}',
          },
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_789',
            name: 'lookup',
            parameters: '--raw-text--',
          },
        ],
      },
    ];

    const messages = callConvert(provider, contents);
    const assistantMessages = messages.filter(
      (m): m is Extract<typeof m, { role: 'assistant' }> =>
        'role' in m && m.role === 'assistant',
    );
    const [first, second, third] = assistantMessages;

    expect(first?.tool_calls?.[0]?.function.arguments).toBe('{}');
    expect(second?.tool_calls?.[0]?.function.arguments).toBe('{"city":"sf"}');
    expect(
      JSON.parse(third?.tool_calls?.[0]?.function.arguments || '{}').raw,
    ).toBe('--raw-text--');
  });

  it('builds structured tool responses with error info and truncation', () => {
    const hugeResult = 'a'.repeat(6000);
    const contents: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_abc',
            toolName: 'read_file',
            result: hugeResult,
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_err',
            toolName: 'write_file',
            result: undefined,
            error: 'validation failed',
          },
        ],
      },
    ];

    const messages = callConvert(provider, contents);
    const toolMessages = messages.filter(
      (m): m is Extract<typeof m, { role: 'tool' }> =>
        'role' in m && m.role === 'tool',
    );

    expect(toolMessages).toHaveLength(2);

    const successPayload = JSON.parse(toolMessages[0]?.content as string);
    expect(toolMessages[0]?.tool_call_id).toBe('call_abc');
    expect(successPayload.status).toBe('success');
    expect(successPayload.toolName).toBe('read_file');
    expect(successPayload.result).toContain('[truncated');

    const errorPayload = JSON.parse(toolMessages[1]?.content as string);
    expect(toolMessages[1]?.tool_call_id).toBe('call_err');
    expect(errorPayload.status).toBe('error');
    expect(errorPayload.error).toBe('validation failed');
    expect(errorPayload.result).toBe('[no tool result]');
  });

  it('replays tool transcripts as text when textual mode is requested', () => {
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'please inspect file' }],
      },
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Checking file contents' },
          {
            type: 'tool_call',
            id: 'hist_tool_001',
            name: 'read_file',
            parameters: { path: '/tmp/file.txt' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_001',
            toolName: 'read_file',
            result: 'line1\nline2',
          },
        ],
      },
    ];

    const messages = callConvert(provider, contents, 'textual');
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: 'please inspect file',
    });
    expect(messages[1]?.role).toBe('assistant');
    expect(messages[1]?.content).toContain('[TOOL CALL');
    expect(messages[1]?.content).toContain('Checking file contents');
    expect(messages[2]?.role).toBe('user');
    expect(messages[2]?.content).toContain('[TOOL RESULT]');
    expect(messages[2]?.content).toContain('line1');
  });
});
