/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { convertToFunctionResponse } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { DEFAULT_GEMINI_MODEL } from '@vybestack/llxprt-code-core/config/models.js';
import type {
  ContentBlock,
  MediaBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

describe('convertToFunctionResponse', () => {
  const toolName = 'testTool';
  const callId = 'call1';

  it('should handle simple string llmContent', () => {
    const llmContent = 'Simple text output';
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual<ContentBlock[]>([
      {
        type: 'tool_response',
        callId,
        toolName,
        result: { output: 'Simple text output' },
      },
    ]);
  });

  it('should handle llmContent as a single Part with text', () => {
    const llmContent = { text: 'Text from Part object' };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual<ContentBlock[]>([
      {
        type: 'tool_response',
        callId,
        toolName,
        result: { output: 'Text from Part object' },
      },
    ]);
  });

  it('should handle llmContent as a PartListUnion array with a single text Part', () => {
    const llmContent = [{ text: 'Text from array' }];
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual<ContentBlock[]>([
      {
        type: 'tool_response',
        callId,
        toolName,
        result: { output: 'Text from array' },
      },
    ]);
  });

  it('should handle llmContent with inlineData', () => {
    const inlineData = { mimeType: 'image/png', data: 'base64...' };
    const llmContent = { inlineData };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual<ContentBlock[]>([
      {
        type: 'tool_response',
        callId,
        toolName,
        result: {
          output: 'Binary content provided (1 item(s)).',
        },
      },
      {
        type: 'media',
        mimeType: 'image/png',
        data: 'base64...',
        encoding: 'base64',
      },
    ]);
  });

  it('should handle llmContent with fileData', () => {
    const fileData = { mimeType: 'application/pdf', fileUri: 'gs://...' };
    const llmContent = { fileData };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual<ContentBlock[]>([
      {
        type: 'tool_response',
        callId,
        toolName,
        result: {
          output: 'Binary content provided (1 item(s)).',
        },
      },
      {
        type: 'media',
        mimeType: 'application/pdf',
        data: 'gs://...',
        encoding: 'url',
      },
    ]);
  });

  it('should handle llmContent as an array of multiple Parts (text and inlineData)', () => {
    const llmContent = [
      { text: 'Some textual description' },
      { inlineData: { mimeType: 'image/jpeg', data: 'base64data...' } },
      { text: 'Another text part' },
    ];
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual<ContentBlock[]>([
      {
        type: 'tool_response',
        callId,
        toolName,
        result: { output: 'Some textual description\nAnother text part' },
      },
      {
        type: 'media',
        mimeType: 'image/jpeg',
        data: 'base64data...',
        encoding: 'base64',
      },
    ]);
  });

  it('should handle llmContent as an array with a single inlineData Part', () => {
    const llmContent = [
      { inlineData: { mimeType: 'image/gif', data: 'gifdata...' } },
    ];
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual<ContentBlock[]>([
      {
        type: 'tool_response',
        callId,
        toolName,
        result: {
          output: 'Binary content provided (1 item(s)).',
        },
      },
      {
        type: 'media',
        mimeType: 'image/gif',
        data: 'gifdata...',
        encoding: 'base64',
      },
    ]);
  });

  it('should handle llmContent as a generic Part (not text, inlineData, or fileData)', () => {
    const llmContent = { functionCall: { name: 'test', args: {} } };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual<ContentBlock[]>([
      {
        type: 'tool_response',
        callId,
        toolName,
        result: {},
      },
    ]);
  });

  it('should handle empty string llmContent', () => {
    const llmContent = '';
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual<ContentBlock[]>([
      {
        type: 'tool_response',
        callId,
        toolName,
        result: { output: '' },
      },
    ]);
  });

  it('should handle llmContent as an empty array', () => {
    const llmContent: unknown[] = [];
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual<ContentBlock[]>([
      {
        type: 'tool_response',
        callId,
        toolName,
        result: {},
      },
    ]);
  });

  it('should handle llmContent as a Part with undefined inlineData/fileData/text', () => {
    const llmContent = {}; // An empty part object
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual<ContentBlock[]>([
      {
        type: 'tool_response',
        callId,
        toolName,
        result: {},
      },
    ]);
  });

  it('should ensure correct id when llmContent contains functionResponse without id', () => {
    const llmContent = {
      functionResponse: {
        name: 'originalTool',
        response: { output: 'Tool completed successfully' },
      },
    };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual<ContentBlock[]>([
      {
        type: 'tool_response',
        callId,
        toolName,
        result: { output: 'Tool completed successfully' },
      },
    ]);
  });

  it('should override id when llmContent contains functionResponse with different id', () => {
    const llmContent = {
      functionResponse: {
        id: 'wrong_id',
        name: 'originalTool',
        response: { output: 'Tool completed successfully' },
      },
    };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual<ContentBlock[]>([
      {
        type: 'tool_response',
        callId,
        toolName,
        result: { output: 'Tool completed successfully' },
      },
    ]);
  });

  it('should trim string outputs using tool-output limits when config is provided', () => {
    const llmContent = Array(5000).fill('long-line').join('\n');
    const config = {
      getEphemeralSettings: () => ({
        'tool-output-max-tokens': 50,
        'tool-output-truncate-mode': 'truncate',
      }),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    const result = convertToFunctionResponse(
      toolName,
      callId,
      llmContent,
      config,
    );
    const primary = result[0] as ToolResponseBlock | undefined;
    const output = (primary?.result as Record<string, unknown> | undefined)?.[
      'output'
    ] as string | undefined;
    expect(output).toContain('[Output truncated due to token limit]');
  });

  // Type-level sanity checks (no runtime execution) to keep block-shape imports honest.
  it('returns ContentBlock[] typed values', () => {
    const result = convertToFunctionResponse(toolName, callId, 'x');
    // Exercise the discriminated union without assertions at runtime.
    for (const block of result) {
      if (block.type === 'tool_response') {
        const _t: ToolResponseBlock = block;
        void _t;
      } else if (block.type === 'media') {
        const _m: MediaBlock = block;
        void _m;
      }
    }
    expect(result.length).toBeGreaterThan(0);
  });
});
