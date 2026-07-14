/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeResponseOutcome,
  getResponseTextFromBlocks,
  getToolCallBlocks,
  getToolCallBlocksAsJson,
  getStructuredResponseFromBlocks,
  convertToFunctionResponse,
  createToolResponseBlock,
  limitToolResponseBlock,
  limitStringOutput,
  legacyPartsToBlocks,
  createErrorResponse,
} from './generateContentResponseUtilities.js';
import type {
  TextBlock,
  ToolCallBlock,
  ThinkingBlock,
} from '../services/history/IContent.js';

const textBlock = (text: string): TextBlock => ({ type: 'text', text });
const thinkingBlock = (thought: string): ThinkingBlock => ({
  type: 'thinking',
  thought,
  isHidden: true,
  sourceField: 'thought',
});
const toolCallBlock = (
  name: string,
  args?: Record<string, unknown>,
  id?: string,
): ToolCallBlock => ({
  type: 'tool_call',
  id: id ?? 'call-1',
  name,
  parameters: args ?? {},
});

describe('generateContentResponseUtilities', () => {
  describe('analyzeResponseOutcome', () => {
    it('should detect visible text', () => {
      const outcome = analyzeResponseOutcome([textBlock('Hello')]);
      expect(outcome).toStrictEqual({
        hasVisibleText: true,
        hasThinking: false,
        hasToolCalls: false,
        isActionable: true,
      });
    });

    it('should treat whitespace-only text as not visible', () => {
      const outcome = analyzeResponseOutcome([textBlock('   ')]);
      expect(outcome).toStrictEqual({
        hasVisibleText: false,
        hasThinking: false,
        hasToolCalls: false,
        isActionable: false,
      });
    });

    it('should detect thinking blocks', () => {
      const outcome = analyzeResponseOutcome([thinkingBlock('thinking...')]);
      expect(outcome).toStrictEqual({
        hasVisibleText: false,
        hasThinking: true,
        hasToolCalls: false,
        isActionable: false,
      });
    });

    it('should detect tool calls', () => {
      const outcome = analyzeResponseOutcome([toolCallBlock('testFunc')]);
      expect(outcome).toStrictEqual({
        hasVisibleText: false,
        hasThinking: false,
        hasToolCalls: true,
        isActionable: true,
      });
    });

    it('should detect mixed blocks', () => {
      const outcome = analyzeResponseOutcome([
        textBlock('Hello'),
        thinkingBlock('thinking...'),
        toolCallBlock('func'),
      ]);
      expect(outcome).toStrictEqual({
        hasVisibleText: true,
        hasThinking: true,
        hasToolCalls: true,
        isActionable: true,
      });
    });

    it('should return all false for empty blocks', () => {
      const outcome = analyzeResponseOutcome([]);
      expect(outcome).toStrictEqual({
        hasVisibleText: false,
        hasThinking: false,
        hasToolCalls: false,
        isActionable: false,
      });
    });

    it('should not count thinking block as visible text', () => {
      const outcome = analyzeResponseOutcome([
        thinkingBlock('thinking only'),
        textBlock(''),
      ]);
      expect(outcome.hasVisibleText).toBe(false);
      expect(outcome.hasThinking).toBe(true);
      expect(outcome.isActionable).toBe(false);
    });
  });

  describe('getResponseTextFromBlocks', () => {
    it('should return undefined for no blocks', () => {
      expect(getResponseTextFromBlocks([])).toBeUndefined();
    });
    it('should extract text from a single text block', () => {
      expect(getResponseTextFromBlocks([textBlock('Hello')])).toBe('Hello');
    });
    it('should concatenate text from multiple text blocks', () => {
      expect(
        getResponseTextFromBlocks([textBlock('Hello '), textBlock('World')]),
      ).toBe('Hello World');
    });
    it('should ignore tool call blocks', () => {
      expect(
        getResponseTextFromBlocks([
          textBlock('Hello '),
          toolCallBlock('testFunc'),
          textBlock('World'),
        ]),
      ).toBe('Hello World');
    });
    it('should return undefined if only tool call blocks exist', () => {
      expect(
        getResponseTextFromBlocks([
          toolCallBlock('testFunc'),
          toolCallBlock('anotherFunc'),
        ]),
      ).toBeUndefined();
    });
    it('should filter out thinking blocks', () => {
      expect(
        getResponseTextFromBlocks([
          thinkingBlock('thinking...'),
          textBlock('visible'),
          thinkingBlock('more thinking'),
        ]),
      ).toBe('visible');
    });
    it('should return undefined when text blocks are only whitespace', () => {
      expect(
        getResponseTextFromBlocks([textBlock('  '), textBlock('\n\t')]),
      ).toBeUndefined();
    });
    it('should return undefined when only thinking blocks exist', () => {
      expect(
        getResponseTextFromBlocks([thinkingBlock('thinking...')]),
      ).toBeUndefined();
    });
  });

  describe('getToolCallBlocks', () => {
    it('should return empty for no blocks', () => {
      expect(getToolCallBlocks([])).toStrictEqual([]);
    });
    it('should extract a single tool call block', () => {
      const block = toolCallBlock('testFunc', { a: 1 });
      expect(getToolCallBlocks([block])).toStrictEqual([block]);
    });
    it('should extract multiple tool call blocks', () => {
      const block1 = toolCallBlock('testFunc1', { a: 1 });
      const block2 = toolCallBlock('testFunc2', { b: 2 });
      expect(getToolCallBlocks([block1, block2])).toStrictEqual([
        block1,
        block2,
      ]);
    });
    it('should ignore text blocks', () => {
      const block = toolCallBlock('testFunc', { a: 1 });
      expect(
        getToolCallBlocks([textBlock('Some text'), block, textBlock('text')]),
      ).toStrictEqual([block]);
    });
    it('should return empty if only text blocks exist', () => {
      expect(
        getToolCallBlocks([textBlock('Some text'), textBlock('More text')]),
      ).toStrictEqual([]);
    });
  });

  describe('getToolCallBlocksAsJson', () => {
    it('should return JSON string of tool call blocks', () => {
      const blocks = [
        toolCallBlock('testFunc1', { a: 1 }, 'id-1'),
        toolCallBlock('testFunc2', { b: 2 }, 'id-2'),
      ];
      const expected = JSON.stringify(
        [
          { id: 'id-1', name: 'testFunc1', args: { a: 1 } },
          { id: 'id-2', name: 'testFunc2', args: { b: 2 } },
        ],
        null,
        2,
      );
      expect(getToolCallBlocksAsJson(blocks)).toBe(expected);
    });
    it('should return "[]" if no tool calls', () => {
      expect(getToolCallBlocksAsJson([textBlock('Hello')])).toBe('[]');
    });
  });

  describe('getStructuredResponseFromBlocks', () => {
    it('should return only text if only text exists', () => {
      expect(getStructuredResponseFromBlocks([textBlock('Hello World')])).toBe(
        'Hello World',
      );
    });
    it('should return only tool call JSON if only tool calls exist', () => {
      const block = toolCallBlock('testFunc', { data: 'payload' });
      const expected = JSON.stringify(
        [{ id: block.id, name: block.name, args: block.parameters }],
        null,
        2,
      );
      expect(getStructuredResponseFromBlocks([block])).toBe(expected);
    });
    it('should return text and tool call JSON if both exist', () => {
      const block = toolCallBlock('processData', { item: 42 });
      const expected = JSON.stringify(
        [{ id: block.id, name: block.name, args: block.parameters }],
        null,
        2,
      );
      expect(
        getStructuredResponseFromBlocks([
          textBlock('Consider this data:'),
          block,
        ]),
      ).toBe(`Consider this data:\n${expected}`);
    });
    it('should return undefined if neither text nor tool calls exist', () => {
      expect(getStructuredResponseFromBlocks([])).toBeUndefined();
    });
  });

  describe('formatting helper characterization', () => {
    const configWithTruncation = {
      getEphemeralSettings: () => ({
        'tool-output-max-tokens': 50,
        'tool-output-truncate-mode': 'warn',
      }),
    };

    it('creates a tool_response block with the provided callId, toolName, and output', () => {
      expect(
        createToolResponseBlock('call-1', 'read_file', 'done'),
      ).toStrictEqual({
        type: 'tool_response',
        callId: 'call-1',
        toolName: 'read_file',
        result: { output: 'done' },
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

    it('rewrites only tool_response.result.output when output limiting applies', () => {
      const oversizedText = Array.from(
        { length: 200 },
        (_, index) => `word${index}`,
      ).join(' ');
      const block = createToolResponseBlock(
        'call-2',
        'read_file',
        oversizedText,
      );
      block.result = { output: oversizedText, summary: 'preserved' };

      const limitedBlock = limitToolResponseBlock(
        block,
        'read_file',
        configWithTruncation,
      );

      expect(limitedBlock.result).toStrictEqual({
        output: expect.stringContaining(
          'read_file output exceeded token limit',
        ),
        summary: 'preserved',
      });
    });

    it('converts legacy string parts to text blocks via legacyPartsToBlocks', () => {
      const blocks = legacyPartsToBlocks(['alpha', { text: 'beta' }]);
      expect(blocks).toStrictEqual([textBlock('alpha'), textBlock('beta')]);
    });

    it('converts legacy thought parts to thinking blocks', () => {
      const blocks = legacyPartsToBlocks([{ text: 'hidden', thought: true }]);
      expect(blocks).toStrictEqual([thinkingBlock('hidden')]);
    });

    it('does not treat non-true thought markers as thinking blocks', () => {
      const blocks = legacyPartsToBlocks([
        { text: 'visible', thought: 'true' },
      ]);
      expect(blocks).toStrictEqual([textBlock('visible')]);
    });

    it('converts legacy function call and response parts', () => {
      const blocks = legacyPartsToBlocks([
        { functionCall: { id: 'call-a', name: 'lookup', args: { q: 'x' } } },
        {
          functionResponse: {
            id: 'call-a',
            name: 'lookup',
            response: { output: 'found' },
          },
        },
      ]);

      expect(blocks).toStrictEqual([
        toolCallBlock('lookup', { q: 'x' }, 'call-a'),
        {
          type: 'tool_response',
          callId: 'call-a',
          toolName: 'lookup',
          result: { output: 'found' },
        },
      ]);
    });

    it('converts legacy fileData parts to url media blocks', () => {
      const blocks = legacyPartsToBlocks([
        {
          fileData: { fileUri: 'gs://bucket/file.txt', mimeType: 'text/plain' },
        },
      ]);

      expect(blocks).toStrictEqual([
        {
          type: 'media',
          mimeType: 'text/plain',
          data: 'gs://bucket/file.txt',
          encoding: 'url',
        },
      ]);
    });
    it('wraps string llmContent in a single tool_response block', () => {
      const result = convertToFunctionResponse(
        'tool',
        'call-4',
        'simple output',
      );
      expect(result).toStrictEqual([
        createToolResponseBlock('call-4', 'tool', 'simple output'),
      ]);
    });

    it('aggregates text parts with newlines into one tool_response output', () => {
      const result = convertToFunctionResponse('tool', 'call-5', [
        { text: 'line 1' },
        { text: 'line 2' },
      ]);
      expect(result).toStrictEqual([
        {
          type: 'tool_response',
          callId: 'call-5',
          toolName: 'tool',
          result: { output: 'line 1\nline 2' },
        },
      ]);
    });

    it('passes through tool_response content using the current call id and tool name', () => {
      const originalResponse = {
        output: 'existing output',
        extra: { nested: true },
      };

      const result = convertToFunctionResponse('tool', 'call-6', {
        functionResponse: {
          id: 'old-id',
          name: 'old-name',
          response: originalResponse,
        },
      });

      expect(result).toStrictEqual([
        {
          type: 'tool_response',
          callId: 'call-6',
          toolName: 'tool',
          result: originalResponse,
        },
      ]);
    });

    it('preserves normalized ContentBlock inputs before legacy conversion', () => {
      const result = convertToFunctionResponse('tool', 'call-6b', [
        {
          type: 'tool_response',
          callId: 'already-normalized',
          toolName: 'existing-tool',
          result: { output: 'normalized output' },
        },
      ]);

      expect(result).toStrictEqual([
        {
          type: 'tool_response',
          callId: 'call-6b',
          toolName: 'tool',
          result: { output: 'normalized output' },
        },
      ]);
    });

    it('returns media sibling blocks after the generated tool_response block', () => {
      const result = convertToFunctionResponse('tool', 'call-7', [
        { text: 'summary' },
        {
          inlineData: {
            data: 'YWJj',
            mimeType: 'text/plain',
          },
        },
        {
          fileData: {
            fileUri: 'gs://bucket/example.txt',
            mimeType: 'text/plain',
          },
        },
      ]);

      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('tool_response');
      expect(
        (result[0] as { result: { output: string } }).result,
      ).toStrictEqual({
        output: 'summary',
      });
      expect(result[1]).toStrictEqual({
        type: 'media',
        mimeType: 'text/plain',
        data: 'YWJj',
        encoding: 'base64',
      });
      expect(result[2]).toStrictEqual({
        type: 'media',
        mimeType: 'text/plain',
        data: 'gs://bucket/example.txt',
        encoding: 'url',
      });
    });

    it('describes binary-only content in the tool_response while preserving siblings', () => {
      const result = convertToFunctionResponse('tool', 'call-8', [
        {
          inlineData: {
            data: 'YWJj',
            mimeType: 'text/plain',
          },
        },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0]).toStrictEqual({
        type: 'tool_response',
        callId: 'call-8',
        toolName: 'tool',
        result: { output: 'Binary content provided (1 item(s)).' },
      });
      expect(result[1]).toStrictEqual({
        type: 'media',
        mimeType: 'text/plain',
        data: 'YWJj',
        encoding: 'base64',
      });
    });

    it('limits oversized string content before wrapping it in a tool_response', () => {
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

      expect(converted).toHaveLength(1);
      expect(converted[0].type).toBe('tool_response');
      expect(
        (converted[0] as { result: { output: string } }).result.output,
      ).toContain('read_file output exceeded token limit');
    });
  });

  describe('createErrorResponse', () => {
    it('creates a tool_response block with the error message in result', () => {
      const request = {
        callId: 'call-err',
        name: 'failingTool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      };
      const error = new Error('Something went wrong');
      const result = createErrorResponse(request, error, undefined);

      expect(result.callId).toBe('call-err');
      expect(result.error).toBe(error);
      expect(result.resultDisplay).toBe('Something went wrong');
      // Only a tool_response block (no functionCall) — orphan tool_use protection (#244)
      expect(result.responseParts).toHaveLength(1);
      expect(result.responseParts[0]).toStrictEqual({
        type: 'tool_response',
        callId: 'call-err',
        toolName: 'failingTool',
        result: { error: 'Something went wrong' },
      });
    });
  });
});
