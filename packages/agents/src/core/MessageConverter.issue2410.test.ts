/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #2410:
 * Empty `{speaker:"human", blocks:[]}` IContent items are injected into
 * subagent conversation history, causing z.ai to return HTTP 400 error 1213
 * ("prompt parameter not received normally").
 *
 * The root cause: `[].every(isFunctionResponsePart)` is vacuously true, so
 * an empty message array creates `{role:'user', parts:[]}`. These tests verify
 * the boundary guards in MessageConverter prevent that.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeToolInteractionInput,
  createUserContentWithFunctionResponseFix,
  convertMixedPartsToIContent,
} from './MessageConverter.js';

describe('issue #2410 – empty message arrays must not create zero-part Content', () => {
  describe('createUserContentWithFunctionResponseFix', () => {
    it('returns a Content with zero parts for an empty array (not a fabricated user turn)', () => {
      const result = createUserContentWithFunctionResponseFix([]);
      expect(result.role).toBe('user');
      expect(result.parts).toHaveLength(0);
    });

    it('converts a non-empty function-response array into a user Content with parts', () => {
      const parts = [
        {
          functionResponse: {
            id: 'call_1',
            name: 'read_file',
            response: { output: 'hello' },
          },
        },
      ];
      const result = createUserContentWithFunctionResponseFix(parts);
      expect(result.role).toBe('user');
      expect(result.parts).toHaveLength(1);
      expect(result.parts[0]).toHaveProperty('functionResponse');
    });
  });

  describe('normalizeToolInteractionInput', () => {
    it('returns an empty Content array for an empty message array', () => {
      const result = normalizeToolInteractionInput([]);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it('still handles a non-empty function-response array correctly', () => {
      const parts = [
        {
          functionResponse: {
            id: 'call_1',
            name: 'read_file',
            response: { output: 'hello' },
          },
        },
      ];
      const result = normalizeToolInteractionInput(parts);
      const content = Array.isArray(result) ? result[0] : result;
      expect(content).toBeDefined();
      expect(content.parts).toHaveLength(1);
      expect(content.parts[0]).toHaveProperty('functionResponse');
    });

    it('still handles string input correctly', () => {
      const result = normalizeToolInteractionInput('hello');
      const content = Array.isArray(result) ? result[0] : result;
      expect(content).toBeDefined();
      expect(content.parts).toHaveLength(1);
      expect(content.parts[0]).toHaveProperty('text', 'hello');
    });
  });

  describe('convertMixedPartsToIContent', () => {
    it('returns an IContent with zero blocks for an empty parts array', () => {
      const result = convertMixedPartsToIContent([]);
      expect(result.blocks).toHaveLength(0);
      expect(result.speaker).toBe('human');
    });

    it('still converts all-function-response parts to a tool message', () => {
      const parts = [
        {
          functionResponse: {
            id: 'call_1',
            name: 'read_file',
            response: { output: 'hello' },
          },
        },
      ];
      const result = convertMixedPartsToIContent(parts);
      expect(result.speaker).toBe('tool');
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].type).toBe('tool_response');
    });

    it('still converts text parts to an AI message', () => {
      const parts = [{ text: 'hello world' }];
      const result = convertMixedPartsToIContent(parts);
      expect(result.speaker).toBe('ai');
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].type).toBe('text');
    });
  });
});
