/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect } from 'vitest';
import { buildResponsesInputFromContent } from './buildResponsesInputFromContent.js';
import type { IContent } from '../../services/history/IContent.js';

describe('buildResponsesInputFromContent - MediaBlock support', () => {
  it('converts MediaBlock in user messages to input_image parts', () => {
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'What is in this image?' },
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            encoding: 'base64',
          },
        ],
      },
    ];

    const result = buildResponsesInputFromContent(contents);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: 'What is in this image?',
        },
        {
          type: 'input_image',
          image_url:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        },
      ],
    });
  });

  it('handles multiple MediaBlocks in a single user message', () => {
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Compare these images:' },
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'data1',
            encoding: 'base64',
          },
          {
            type: 'media',
            mimeType: 'image/jpeg',
            data: 'data2',
            encoding: 'base64',
          },
        ],
      },
    ];

    const result = buildResponsesInputFromContent(contents);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: 'Compare these images:',
        },
        {
          type: 'input_image',
          image_url: 'data:image/png;base64,data1',
        },
        {
          type: 'input_image',
          image_url: 'data:image/jpeg;base64,data2',
        },
      ],
    });
  });

  it('converts MediaBlock in tool responses to multipart output array', () => {
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Take a screenshot' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_123',
            name: 'screenshot',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_123',
            toolName: 'screenshot',
            result: 'Screenshot taken',
          },
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'screenshotdata',
            encoding: 'base64',
          },
        ],
      },
    ];

    const result = buildResponsesInputFromContent(contents);

    expect(result).toHaveLength(3);
    expect(result[2]).toEqual({
      type: 'function_call_output',
      call_id: 'call_123',
      output: [
        {
          type: 'input_text',
          text: 'Screenshot taken',
        },
        {
          type: 'input_image',
          image_url: 'data:image/png;base64,screenshotdata',
        },
      ],
    });
  });

  it('handles user message with only MediaBlocks (no text)', () => {
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'imagedata',
            encoding: 'base64',
          },
        ],
      },
    ];

    const result = buildResponsesInputFromContent(contents);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: 'user',
      content: [
        {
          type: 'input_image',
          image_url: 'data:image/png;base64,imagedata',
        },
      ],
    });
  });

  it('handles tool response with only MediaBlocks (no text result)', () => {
    const contents: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_456',
            name: 'read_image',
            parameters: { path: 'test.png' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_456',
            toolName: 'read_image',
            result: '',
          },
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'imagedata',
            encoding: 'base64',
          },
        ],
      },
    ];

    const result = buildResponsesInputFromContent(contents);

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      type: 'function_call_output',
      call_id: 'call_456',
      output: [
        {
          type: 'input_image',
          image_url: 'data:image/png;base64,imagedata',
        },
      ],
    });
  });

  it('handles MediaBlock with URL encoding', () => {
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'https://example.com/image.png',
            encoding: 'url',
          },
        ],
      },
    ];

    const result = buildResponsesInputFromContent(contents);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: 'user',
      content: [
        {
          type: 'input_image',
          image_url: 'https://example.com/image.png',
        },
      ],
    });
  });

  it('preserves backward compatibility for text-only messages', () => {
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hi there' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_789',
            name: 'get_weather',
            parameters: { city: 'NYC' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_789',
            toolName: 'get_weather',
            result: 'Sunny, 72F',
          },
        ],
      },
    ];

    const result = buildResponsesInputFromContent(contents);

    expect(result).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      {
        type: 'function_call',
        call_id: 'call_789',
        name: 'get_weather',
        arguments: '{"city":"NYC"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_789',
        output: 'Sunny, 72F',
      },
    ]);
  });

  it('converts PDF MediaBlock in user message to input_file', () => {
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Summarize this document' },
          {
            type: 'media',
            mimeType: 'application/pdf',
            data: 'JVBERi0xLjQ=',
            encoding: 'base64',
            filename: 'report.pdf',
          },
        ],
      },
    ];

    const result = buildResponsesInputFromContent(contents);

    expect(result).toHaveLength(1);
    const userMsg = result[0] as { role: string; content: unknown[] };
    expect(userMsg.role).toBe('user');
    expect(userMsg.content).toHaveLength(2);
    expect(userMsg.content[0]).toEqual({
      type: 'input_text',
      text: 'Summarize this document',
    });
    expect(userMsg.content[1]).toEqual({
      type: 'input_file',
      file_data: 'data:application/pdf;base64,JVBERi0xLjQ=',
      filename: 'report.pdf',
    });
  });

  it('converts PDF MediaBlock in tool response to input_file', () => {
    const contents: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_pdf1',
            name: 'read_file',
            parameters: { path: 'doc.pdf' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_pdf1',
            toolName: 'read_file',
            result: 'PDF content',
          },
          {
            type: 'media',
            mimeType: 'application/pdf',
            data: 'JVBERi0xLjQ=',
            encoding: 'base64',
            filename: 'doc.pdf',
          },
        ],
      },
    ];

    const result = buildResponsesInputFromContent(contents);

    const toolOutput = result[1] as {
      type: string;
      output: unknown[];
    };
    expect(toolOutput.type).toBe('function_call_output');
    expect(toolOutput.output).toHaveLength(2);
    expect(toolOutput.output[1]).toEqual({
      type: 'input_file',
      file_data: 'data:application/pdf;base64,JVBERi0xLjQ=',
      filename: 'doc.pdf',
    });
  });

  it('produces text placeholder for unsupported media in user message', () => {
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Listen to this' },
          {
            type: 'media',
            mimeType: 'audio/mpeg',
            data: 'audiodata',
            encoding: 'base64',
            filename: 'song.mp3',
          },
        ],
      },
    ];

    const result = buildResponsesInputFromContent(contents);

    expect(result).toHaveLength(1);
    const userMsg = result[0] as { role: string; content: unknown[] };
    expect(userMsg.content).toHaveLength(2);
    const placeholder = userMsg.content[1] as { type: string; text: string };
    expect(placeholder.type).toBe('input_text');
    expect(placeholder.text).toContain('audio/mpeg');
    expect(placeholder.text).toContain('song.mp3');
    expect(placeholder.text).toContain('OpenAI Responses');
  });

  it('never silently drops media - each MediaBlock produces output', () => {
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Mixed media' },
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'imgdata',
            encoding: 'base64',
          },
          {
            type: 'media',
            mimeType: 'application/pdf',
            data: 'pdfdata',
            encoding: 'base64',
          },
          {
            type: 'media',
            mimeType: 'video/mp4',
            data: 'viddata',
            encoding: 'base64',
          },
        ],
      },
    ];

    const result = buildResponsesInputFromContent(contents);

    const userMsg = result[0] as { role: string; content: unknown[] };
    expect(userMsg.content).toHaveLength(4);
    expect((userMsg.content[1] as { type: string }).type).toBe('input_image');
    expect((userMsg.content[2] as { type: string }).type).toBe('input_file');
    expect((userMsg.content[3] as { type: string }).type).toBe('input_text');
  });
});
