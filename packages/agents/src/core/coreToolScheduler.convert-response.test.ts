/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { convertToFunctionResponse } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { DEFAULT_GEMINI_MODEL } from '@vybestack/llxprt-code-core/config/models.js';
import type { Part, PartListUnion } from '@google/genai';

describe('convertToFunctionResponse', () => {
  const toolName = 'testTool';
  const callId = 'call1';

  it('should handle simple string llmContent', () => {
    const llmContent = 'Simple text output';
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: { output: 'Simple text output' },
        },
      },
    ]);
  });

  it('should handle llmContent as a single Part with text', () => {
    const llmContent: Part = { text: 'Text from Part object' };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: { output: 'Text from Part object' },
        },
      },
    ]);
  });

  it('should handle llmContent as a PartListUnion array with a single text Part', () => {
    const llmContent: PartListUnion = [{ text: 'Text from array' }];
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: { output: 'Text from array' },
        },
      },
    ]);
  });

  it('should handle llmContent with inlineData', () => {
    const llmContent: Part = {
      inlineData: { mimeType: 'image/png', data: 'base64...' },
    };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: {
            output: 'Binary content provided (1 item(s)).',
          },
        },
      },
      llmContent,
    ]);
  });

  it('should handle llmContent with fileData', () => {
    const llmContent: Part = {
      fileData: { mimeType: 'application/pdf', fileUri: 'gs://...' },
    };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: {
            output: 'Binary content provided (1 item(s)).',
          },
        },
      },
      llmContent,
    ]);
  });

  it('should handle llmContent as an array of multiple Parts (text and inlineData)', () => {
    const llmContent: PartListUnion = [
      { text: 'Some textual description' },
      { inlineData: { mimeType: 'image/jpeg', data: 'base64data...' } },
      { text: 'Another text part' },
    ];
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: { output: 'Some textual description\nAnother text part' },
        },
      },
      { inlineData: { mimeType: 'image/jpeg', data: 'base64data...' } },
    ]);
  });

  it('should handle llmContent as an array with a single inlineData Part', () => {
    const llmContent: PartListUnion = [
      { inlineData: { mimeType: 'image/gif', data: 'gifdata...' } },
    ];
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: {
            output: 'Binary content provided (1 item(s)).',
          },
        },
      },
      llmContent[0],
    ]);
  });

  it('should handle llmContent as a generic Part (not text, inlineData, or fileData)', () => {
    const llmContent: Part = { functionCall: { name: 'test', args: {} } };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: {},
        },
      },
    ]);
  });

  it('should handle empty string llmContent', () => {
    const llmContent = '';
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: { output: '' },
        },
      },
    ]);
  });

  it('should handle llmContent as an empty array', () => {
    const llmContent: PartListUnion = [];
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: {},
        },
      },
    ]);
  });

  it('should handle llmContent as a Part with undefined inlineData/fileData/text', () => {
    const llmContent: Part = {}; // An empty part object
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          name: toolName,
          id: callId,
          response: {},
        },
      },
    ]);
  });

  it('should ensure correct id when llmContent contains functionResponse without id', () => {
    const llmContent: Part = {
      functionResponse: {
        name: 'originalTool',
        response: { output: 'Tool completed successfully' },
      },
    };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          id: callId,
          name: toolName,
          response: { output: 'Tool completed successfully' },
        },
      },
    ]);
  });

  it('should override id when llmContent contains functionResponse with different id', () => {
    const llmContent: Part = {
      functionResponse: {
        id: 'wrong_id',
        name: 'originalTool',
        response: { output: 'Tool completed successfully' },
      },
    };
    const result = convertToFunctionResponse(toolName, callId, llmContent);
    expect(result).toStrictEqual([
      {
        functionResponse: {
          id: callId,
          name: toolName,
          response: { output: 'Tool completed successfully' },
        },
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
    expect(
      result[0]?.functionResponse?.response?.['output'] as string,
    ).toContain('[Output truncated due to token limit]');
  });
});
