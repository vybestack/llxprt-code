/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  getResponseText,
  getResponseTextFromParts,
  getFunctionCalls,
  getFunctionCallsFromParts,
  getFunctionCallsAsJson,
  getFunctionCallsFromPartsAsJson,
  getStructuredResponse,
  getStructuredResponseFromParts,
  convertToFunctionResponse,
  createFunctionResponsePart,
  limitFunctionResponsePart,
  limitStringOutput,
  toParts,
} from './generateContentResponseUtilities.js';
import type {
  GenerateContentResponse,
  Part,
  SafetyRating,
} from '@google/genai';
import { FinishReason } from '@google/genai';

const mockTextPart = (text: string): Part => ({ text });
const mockFunctionCallPart = (
  name: string,
  args?: Record<string, unknown>,
): Part => ({
  functionCall: { name, args: args ?? {} },
});

const mockResponse = (
  parts: Part[],
  finishReason: FinishReason = FinishReason.STOP,
  safetyRatings: SafetyRating[] = [],
): GenerateContentResponse => ({
  candidates: [
    {
      content: {
        parts,
        role: 'model',
      },
      index: 0,
      finishReason,
      safetyRatings,
    },
  ],
  promptFeedback: {
    safetyRatings: [],
  },
  text: undefined,
  data: undefined,
  functionCalls: undefined,
  executableCode: undefined,
  codeExecutionResult: undefined,
});

const minimalMockResponse = (
  candidates: GenerateContentResponse['candidates'],
): GenerateContentResponse => ({
  candidates,
  promptFeedback: { safetyRatings: [] },
  text: undefined,
  data: undefined,
  functionCalls: undefined,
  executableCode: undefined,
  codeExecutionResult: undefined,
});

describe('generateContentResponseUtilities', () => {
  describe('getResponseText', () => {
    it('should return undefined for no candidates', () => {
      expect(getResponseText(minimalMockResponse(undefined))).toBeUndefined();
    });
    it('should return undefined for empty candidates array', () => {
      expect(getResponseText(minimalMockResponse([]))).toBeUndefined();
    });
    it('should return undefined for no parts', () => {
      const response = mockResponse([]);
      expect(getResponseText(response)).toBeUndefined();
    });
    it('should extract text from a single text part', () => {
      const response = mockResponse([mockTextPart('Hello')]);
      expect(getResponseText(response)).toBe('Hello');
    });
    it('should concatenate text from multiple text parts', () => {
      const response = mockResponse([
        mockTextPart('Hello '),
        mockTextPart('World'),
      ]);
      expect(getResponseText(response)).toBe('Hello World');
    });
    it('should ignore function call parts', () => {
      const response = mockResponse([
        mockTextPart('Hello '),
        mockFunctionCallPart('testFunc'),
        mockTextPart('World'),
      ]);
      expect(getResponseText(response)).toBe('Hello World');
    });
    it('should return undefined if only function call parts exist', () => {
      const response = mockResponse([
        mockFunctionCallPart('testFunc'),
        mockFunctionCallPart('anotherFunc'),
      ]);
      expect(getResponseText(response)).toBeUndefined();
    });
  });

  describe('getResponseTextFromParts', () => {
    it('should return undefined for no parts', () => {
      expect(getResponseTextFromParts([])).toBeUndefined();
    });
    it('should extract text from a single text part', () => {
      expect(getResponseTextFromParts([mockTextPart('Hello')])).toBe('Hello');
    });
    it('should concatenate text from multiple text parts', () => {
      expect(
        getResponseTextFromParts([
          mockTextPart('Hello '),
          mockTextPart('World'),
        ]),
      ).toBe('Hello World');
    });
    it('should ignore function call parts', () => {
      expect(
        getResponseTextFromParts([
          mockTextPart('Hello '),
          mockFunctionCallPart('testFunc'),
          mockTextPart('World'),
        ]),
      ).toBe('Hello World');
    });
    it('should return undefined if only function call parts exist', () => {
      expect(
        getResponseTextFromParts([
          mockFunctionCallPart('testFunc'),
          mockFunctionCallPart('anotherFunc'),
        ]),
      ).toBeUndefined();
    });
  });

  describe('getFunctionCalls', () => {
    it('should return undefined for no candidates', () => {
      expect(getFunctionCalls(minimalMockResponse(undefined))).toBeUndefined();
    });
    it('should return undefined for empty candidates array', () => {
      expect(getFunctionCalls(minimalMockResponse([]))).toBeUndefined();
    });
    it('should return undefined for no parts', () => {
      const response = mockResponse([]);
      expect(getFunctionCalls(response)).toBeUndefined();
    });
    it('should extract a single function call', () => {
      const func = { name: 'testFunc', args: { a: 1 } };
      const response = mockResponse([
        mockFunctionCallPart(func.name, func.args),
      ]);
      expect(getFunctionCalls(response)).toStrictEqual([func]);
    });
    it('should extract multiple function calls', () => {
      const func1 = { name: 'testFunc1', args: { a: 1 } };
      const func2 = { name: 'testFunc2', args: { b: 2 } };
      const response = mockResponse([
        mockFunctionCallPart(func1.name, func1.args),
        mockFunctionCallPart(func2.name, func2.args),
      ]);
      expect(getFunctionCalls(response)).toStrictEqual([func1, func2]);
    });
    it('should ignore text parts', () => {
      const func = { name: 'testFunc', args: { a: 1 } };
      const response = mockResponse([
        mockTextPart('Some text'),
        mockFunctionCallPart(func.name, func.args),
        mockTextPart('More text'),
      ]);
      expect(getFunctionCalls(response)).toStrictEqual([func]);
    });
    it('should return undefined if only text parts exist', () => {
      const response = mockResponse([
        mockTextPart('Some text'),
        mockTextPart('More text'),
      ]);
      expect(getFunctionCalls(response)).toBeUndefined();
    });
  });

  describe('getFunctionCallsFromParts', () => {
    it('should return undefined for no parts', () => {
      expect(getFunctionCallsFromParts([])).toBeUndefined();
    });
    it('should extract a single function call', () => {
      const func = { name: 'testFunc', args: { a: 1 } };
      expect(
        getFunctionCallsFromParts([mockFunctionCallPart(func.name, func.args)]),
      ).toStrictEqual([func]);
    });
    it('should extract multiple function calls', () => {
      const func1 = { name: 'testFunc1', args: { a: 1 } };
      const func2 = { name: 'testFunc2', args: { b: 2 } };
      expect(
        getFunctionCallsFromParts([
          mockFunctionCallPart(func1.name, func1.args),
          mockFunctionCallPart(func2.name, func2.args),
        ]),
      ).toStrictEqual([func1, func2]);
    });
    it('should ignore text parts', () => {
      const func = { name: 'testFunc', args: { a: 1 } };
      expect(
        getFunctionCallsFromParts([
          mockTextPart('Some text'),
          mockFunctionCallPart(func.name, func.args),
          mockTextPart('More text'),
        ]),
      ).toStrictEqual([func]);
    });
    it('should return undefined if only text parts exist', () => {
      expect(
        getFunctionCallsFromParts([
          mockTextPart('Some text'),
          mockTextPart('More text'),
        ]),
      ).toBeUndefined();
    });
  });

  describe('getFunctionCallsAsJson', () => {
    it('should return JSON string of function calls', () => {
      const func1 = { name: 'testFunc1', args: { a: 1 } };
      const func2 = { name: 'testFunc2', args: { b: 2 } };
      const response = mockResponse([
        mockFunctionCallPart(func1.name, func1.args),
        mockTextPart('text in between'),
        mockFunctionCallPart(func2.name, func2.args),
      ]);
      const expectedJson = JSON.stringify([func1, func2], null, 2);
      expect(getFunctionCallsAsJson(response)).toBe(expectedJson);
    });
    it('should return undefined if no function calls', () => {
      const response = mockResponse([mockTextPart('Hello')]);
      expect(getFunctionCallsAsJson(response)).toBeUndefined();
    });
  });

  describe('getFunctionCallsFromPartsAsJson', () => {
    it('should return JSON string of function calls from parts', () => {
      const func1 = { name: 'testFunc1', args: { a: 1 } };
      const func2 = { name: 'testFunc2', args: { b: 2 } };
      const parts = [
        mockFunctionCallPart(func1.name, func1.args),
        mockTextPart('text in between'),
        mockFunctionCallPart(func2.name, func2.args),
      ];
      const expectedJson = JSON.stringify([func1, func2], null, 2);
      expect(getFunctionCallsFromPartsAsJson(parts)).toBe(expectedJson);
    });
    it('should return undefined if no function calls in parts', () => {
      const parts = [mockTextPart('Hello')];
      expect(getFunctionCallsFromPartsAsJson(parts)).toBeUndefined();
    });
  });

  describe('getStructuredResponse', () => {
    it('should return only text if only text exists', () => {
      const response = mockResponse([mockTextPart('Hello World')]);
      expect(getStructuredResponse(response)).toBe('Hello World');
    });
    it('should return only function call JSON if only function calls exist', () => {
      const func = { name: 'testFunc', args: { data: 'payload' } };
      const response = mockResponse([
        mockFunctionCallPart(func.name, func.args),
      ]);
      const expectedJson = JSON.stringify([func], null, 2);
      expect(getStructuredResponse(response)).toBe(expectedJson);
    });
    it('should return text and function call JSON if both exist', () => {
      const text = 'Consider this data:';
      const func = { name: 'processData', args: { item: 42 } };
      const response = mockResponse([
        mockTextPart(text),
        mockFunctionCallPart(func.name, func.args),
      ]);
      const expectedJson = JSON.stringify([func], null, 2);
      expect(getStructuredResponse(response)).toBe(`${text}\n${expectedJson}`);
    });
    it('should return undefined if neither text nor function calls exist', () => {
      const response = mockResponse([]);
      expect(getStructuredResponse(response)).toBeUndefined();
    });
  });

  describe('getStructuredResponseFromParts', () => {
    it('should return only text if only text exists in parts', () => {
      const parts = [mockTextPart('Hello World')];
      expect(getStructuredResponseFromParts(parts)).toBe('Hello World');
    });
    it('should return only function call JSON if only function calls exist in parts', () => {
      const func = { name: 'testFunc', args: { data: 'payload' } };
      const parts = [mockFunctionCallPart(func.name, func.args)];
      const expectedJson = JSON.stringify([func], null, 2);
      expect(getStructuredResponseFromParts(parts)).toBe(expectedJson);
    });
    it('should return text and function call JSON if both exist in parts', () => {
      const text = 'Consider this data:';
      const func = { name: 'processData', args: { item: 42 } };
      const parts = [
        mockTextPart(text),
        mockFunctionCallPart(func.name, func.args),
      ];
      const expectedJson = JSON.stringify([func], null, 2);
      expect(getStructuredResponseFromParts(parts)).toBe(
        `${text}\n${expectedJson}`,
      );
    });
    it('should return undefined if neither text nor function calls exist in parts', () => {
      const parts: Part[] = [];
      expect(getStructuredResponseFromParts(parts)).toBeUndefined();
    });
  });

  describe('formatting helper characterization', () => {
    const configWithTruncation = {
      getEphemeralSettings: () => ({
        'tool-output-max-tokens': 50,
        'tool-output-truncate-mode': 'warn',
      }),
    };

    it('creates a functionResponse part with the provided id, name, and output', () => {
      expect(
        createFunctionResponsePart('call-1', 'read_file', 'done'),
      ).toStrictEqual({
        functionResponse: {
          id: 'call-1',
          name: 'read_file',
          response: { output: 'done' },
        },
      });
    });

    it('passes string output through unchanged when no config is provided', () => {
      expect(limitStringOutput('plain output', 'read_file')).toBe(
        'plain output',
      );
    });

    it('returns the limiter message when warn mode truncates the entire string output', () => {
      const oversizedText = Array.from(
        { length: 200 },
        (_, index) => `word${index}`,
      ).join(' ');

      const limited = limitStringOutput(
        oversizedText,
        'read_file',
        configWithTruncation,
      );

      expect(limited).toContain('read_file output exceeded token limit');
      expect(limited).toContain(
        'The results were found but are too large to display',
      );
    });

    it('rewrites only functionResponse.output when output limiting applies', () => {
      const oversizedText = Array.from(
        { length: 200 },
        (_, index) => `word${index}`,
      ).join(' ');
      const inputPart: Part = {
        functionResponse: {
          id: 'call-2',
          name: 'read_file',
          response: {
            output: oversizedText,
            summary: 'preserved',
          },
        },
      };

      const limitedPart = limitFunctionResponsePart(
        inputPart,
        'read_file',
        configWithTruncation,
      );

      expect(limitedPart).toStrictEqual({
        functionResponse: {
          id: 'call-2',
          name: 'read_file',
          response: {
            output: expect.stringContaining(
              'read_file output exceeded token limit',
            ),
            summary: 'preserved',
          },
        },
      });
    });

    it('normalizes strings and preserves non-null parts in toParts', () => {
      const functionResponsePart: Part = {
        functionResponse: {
          id: 'call-3',
          name: 'tool',
          response: { output: 'kept' },
        },
      };

      expect(
        toParts(['alpha', functionResponsePart, null, 'beta']),
      ).toStrictEqual([
        { text: 'alpha' },
        functionResponsePart,
        { text: 'beta' },
      ]);
    });

    it('wraps string llmContent in a single functionResponse', () => {
      expect(
        convertToFunctionResponse('tool', 'call-4', 'simple output'),
      ).toStrictEqual([
        {
          functionResponse: {
            id: 'call-4',
            name: 'tool',
            response: { output: 'simple output' },
          },
        },
      ]);
    });

    it('aggregates text parts with newlines into one functionResponse output', () => {
      expect(
        convertToFunctionResponse('tool', 'call-5', [
          { text: 'line 1' },
          { text: 'line 2' },
        ]),
      ).toStrictEqual([
        {
          functionResponse: {
            id: 'call-5',
            name: 'tool',
            response: { output: 'line 1\nline 2' },
          },
        },
      ]);
    });

    it('passes through functionResponse content using the current call id and tool name', () => {
      const originalResponse = {
        output: 'existing output',
        extra: { nested: true },
      };

      expect(
        convertToFunctionResponse('tool', 'call-6', {
          functionResponse: {
            id: 'old-id',
            name: 'old-name',
            response: originalResponse,
          },
        }),
      ).toStrictEqual([
        {
          functionResponse: {
            id: 'call-6',
            name: 'tool',
            response: originalResponse,
          },
        },
      ]);
    });

    it('returns binary sibling parts after the generated functionResponse part', () => {
      const fileDataPart: Part = {
        fileData: {
          fileUri: 'gs://bucket/example.txt',
          mimeType: 'text/plain',
        },
      };
      const inlineDataPart: Part = {
        inlineData: {
          data: 'YWJj',
          mimeType: 'text/plain',
        },
      };

      expect(
        convertToFunctionResponse('tool', 'call-7', [
          { text: 'summary' },
          inlineDataPart,
          fileDataPart,
        ]),
      ).toStrictEqual([
        {
          functionResponse: {
            id: 'call-7',
            name: 'tool',
            response: { output: 'summary' },
          },
        },
        fileDataPart,
        inlineDataPart,
      ]);
    });

    it('describes binary-only content in the functionResponse while preserving siblings', () => {
      const inlineDataPart: Part = {
        inlineData: {
          data: 'YWJj',
          mimeType: 'text/plain',
        },
      };

      expect(
        convertToFunctionResponse('tool', 'call-8', [inlineDataPart]),
      ).toStrictEqual([
        {
          functionResponse: {
            id: 'call-8',
            name: 'tool',
            response: { output: 'Binary content provided (1 item(s)).' },
          },
        },
        inlineDataPart,
      ]);
    });

    it('limits oversized string content before wrapping it in a functionResponse', () => {
      const oversizedText = Array.from(
        { length: 200 },
        (_, index) => `word${index}`,
      ).join(' ');

      const converted = convertToFunctionResponse(
        'read_file',
        'call-9',
        oversizedText,
        configWithTruncation,
      );

      expect(converted).toStrictEqual([
        {
          functionResponse: {
            id: 'call-9',
            name: 'read_file',
            response: {
              output: expect.stringContaining(
                'read_file output exceeded token limit',
              ),
            },
          },
        },
      ]);
    });
  });
});
