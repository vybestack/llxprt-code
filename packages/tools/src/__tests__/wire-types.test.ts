/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  type ContentPart,
  type ContentPartUnion,
  type ContentPartListUnion,
  type ToolCallRequest,
  type ToolCallResponse,
  type FunctionDeclaration,
  type InlineData,
  type ToolDeclarations,
  type CallableTool,
} from '../types/wire-types.js';

describe('provider-neutral wire types', () => {
  describe('ContentPart', () => {
    it('accepts a text part', () => {
      const part: ContentPart = { text: 'hello' };
      expect(part.text).toBe('hello');
    });

    it('accepts a functionResponse part', () => {
      const part: ContentPart = {
        functionResponse: {
          name: 'test',
          response: { content: [{ type: 'text', text: 'result' }] },
        },
      };
      expect(part.functionResponse?.name).toBe('test');
    });

    it('accepts an inlineData part', () => {
      const part: ContentPart = {
        inlineData: { mimeType: 'text/plain', data: 'aGVsbG8=' },
      };
      expect(part.inlineData?.mimeType).toBe('text/plain');
    });
  });

  describe('ContentPartUnion and ContentPartListUnion', () => {
    it('a plain string is assignable to ContentPartUnion', () => {
      const content: ContentPartUnion = 'hello world';
      expect(content).toBe('hello world');
    });

    it('a ContentPart is assignable to ContentPartUnion', () => {
      const part: ContentPartUnion = { text: 'hello' } satisfies ContentPart;
      expect(part).toEqual({ text: 'hello' });
    });

    it('an array of parts is assignable to ContentPartListUnion', () => {
      const parts: ContentPartListUnion = [{ text: 'a' }, { text: 'b' }];
      expect(parts).toHaveLength(2);
    });

    it('a single part is assignable to ContentPartListUnion', () => {
      const part: ContentPartListUnion = { text: 'single' };
      expect(part).toEqual({ text: 'single' });
    });

    it('a string is assignable to ContentPartListUnion', () => {
      const content: ContentPartListUnion = 'just text';
      expect(content).toBe('just text');
    });
  });

  describe('ToolCallRequest', () => {
    it('requires name (no optional)', () => {
      const call: ToolCallRequest = {
        name: 'test_tool',
        args: { param: 'value' },
      };
      expect(call.name).toBe('test_tool');
      expect(call.args?.param).toBe('value');
    });

    it('name is a required field — accessing it does not need a non-null assertion', () => {
      const call: ToolCallRequest = { name: 'do_thing' };
      // This compiles without `!` because name is required.
      const name: string = call.name;
      expect(name).toBe('do_thing');
    });
  });

  describe('ToolCallResponse', () => {
    it('accepts name and response', () => {
      const resp: ToolCallResponse = {
        name: 'test_tool',
        response: { result: 'ok' },
      };
      expect(resp.name).toBe('test_tool');
      expect(resp.response?.result).toBe('ok');
    });
  });

  describe('FunctionDeclaration', () => {
    it('accepts name, description, and parametersJsonSchema', () => {
      const decl: FunctionDeclaration = {
        name: 'read_file',
        description: 'Reads a file',
        parametersJsonSchema: { type: 'OBJECT' },
      };
      expect(decl.name).toBe('read_file');
      expect(decl.parametersJsonSchema).toEqual({ type: 'OBJECT' });
    });
  });

  describe('ToolDeclarations', () => {
    it('accepts a list of function declarations', () => {
      const tool: ToolDeclarations = {
        functionDeclarations: [{ name: 'tool_a' }, { name: 'tool_b' }],
      };
      expect(tool.functionDeclarations).toHaveLength(2);
    });
  });

  describe('CallableTool interface', () => {
    it('returns neutral declarations and response parts', async () => {
      const fake: CallableTool = {
        tool: async () => ({
          functionDeclarations: [{ name: 'x' }],
        }),
        callTool: async () => [{ text: 'result' }],
      };

      await expect(fake.tool()).resolves.toEqual({
        functionDeclarations: [{ name: 'x' }],
      });
      await expect(fake.callTool([])).resolves.toEqual([{ text: 'result' }]);
    });
  });

  describe('InlineData', () => {
    it('accepts mimeType, data, and optional displayName', () => {
      const data: InlineData = {
        mimeType: 'image/png',
        data: 'base64data',
        displayName: 'screenshot.png',
      };
      expect(data.mimeType).toBe('image/png');
      expect(data.displayName).toBe('screenshot.png');
    });
  });
});
