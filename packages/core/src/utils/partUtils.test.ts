/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  getResponseText,
  partToString,
  partListUnionToString,
} from './partUtils.js';

describe('partUtils', () => {
  describe('partToString (default behavior)', () => {
    it('should return empty string for undefined or null', () => {
      expect(partToString(undefined)).toBe('');
      expect(partToString(null)).toBe('');
    });

    it('should return string input unchanged', () => {
      expect(partToString('hello')).toBe('hello');
    });

    it('should concatenate strings from an array', () => {
      expect(partToString(['a', 'b'])).toBe('ab');
    });

    it('should return text property when provided a text part', () => {
      expect(partToString({ text: 'hi' })).toBe('hi');
    });

    it('should return empty string for non-text parts', () => {
      expect(
        partToString({ inlineData: { mimeType: 'image/png', data: '' } }),
      ).toBe('');
      expect(partToString({ functionCall: { name: 'test' } })).toBe('');
    });
  });

  describe('partToString (verbose)', () => {
    const verboseOptions = { verbose: true };

    it('should return empty string for undefined or null', () => {
      expect(partToString(undefined, verboseOptions)).toBe('');
      expect(partToString(null, verboseOptions)).toBe('');
    });

    it('should return string input unchanged', () => {
      expect(partToString('hello', verboseOptions)).toBe('hello');
    });

    it('should join parts if the value is an array', () => {
      const parts = ['hello', { text: ' world' }];
      expect(partToString(parts, verboseOptions)).toBe('hello world');
    });

    it('should return the text property if the part is an object with text', () => {
      expect(partToString({ text: 'hello world' }, verboseOptions)).toBe(
        'hello world',
      );
    });

    it('should return descriptive string for videoMetadata part', () => {
      expect(partToString({ videoMetadata: {} }, verboseOptions)).toBe(
        '[Video Metadata]',
      );
    });

    it('should return descriptive string for thought part', () => {
      expect(partToString({ thought: 'thinking' }, verboseOptions)).toBe(
        '[Thought: thinking]',
      );
    });

    it('should return descriptive string for codeExecutionResult part', () => {
      expect(partToString({ codeExecutionResult: {} }, verboseOptions)).toBe(
        '[Code Execution Result]',
      );
    });

    it('should return descriptive string for executableCode part', () => {
      expect(partToString({ executableCode: {} }, verboseOptions)).toBe(
        '[Executable Code]',
      );
    });

    it('should return descriptive string for fileData part', () => {
      expect(partToString({ fileData: {} }, verboseOptions)).toBe(
        '[File Data]',
      );
    });

    it('should return descriptive string for functionCall part', () => {
      expect(
        partToString({ functionCall: { name: 'myFunction' } }, verboseOptions),
      ).toBe('[Function Call: myFunction]');
    });

    it('should return descriptive string for functionResponse part', () => {
      expect(
        partToString(
          { functionResponse: { name: 'myFunction' } },
          verboseOptions,
        ),
      ).toBe('[Function Response: myFunction]');
    });

    it('should return descriptive string for inlineData part', () => {
      expect(
        partToString(
          { inlineData: { mimeType: 'image/png', data: '' } },
          verboseOptions,
        ),
      ).toBe('<image/png>');
    });

    it('should return an empty string for an unknown part type', () => {
      expect(partToString({}, verboseOptions)).toBe('');
    });

    it('should handle complex nested arrays with various part types', () => {
      const parts = [
        'start ',
        { text: 'middle' },
        [
          { functionCall: { name: 'func1' } },
          ' end',
          { inlineData: { mimeType: 'audio/mp3', data: '' } },
        ],
      ];
      expect(partToString(parts, verboseOptions)).toBe(
        'start middle[Function Call: func1] end<audio/mp3>',
      );
    });
  });

  describe('getResponseText', () => {
    it('returns null when there are no candidates', () => {
      expect(getResponseText({ candidates: [] })).toBeNull();
    });

    it('returns null when the first candidate has no parts', () => {
      expect(
        getResponseText({ candidates: [{ content: { parts: [] } }] }),
      ).toBeNull();
    });

    it('returns concatenated text from the first candidate', () => {
      const response = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'alpha' },
                { inlineData: { mimeType: 'text/plain', data: 'x' } },
                { text: ' beta' },
              ],
            },
          },
        ],
      };

      expect(getResponseText(response)).toBe('alpha beta');
    });
  });

  describe('partListUnionToString (verbose mode)', () => {
    it('stringifies a plain string', () => {
      expect(partListUnionToString('hello world')).toBe('hello world');
    });

    it('stringifies a single Part with text', () => {
      expect(partListUnionToString({ text: 'part text' })).toBe('part text');
    });

    it('stringifies an array of Parts', () => {
      const result = partListUnionToString([{ text: 'a' }, { text: 'b' }]);
      // verbose mode concatenates text from all parts
      expect(result).toContain('a');
      expect(result).toContain('b');
    });
  });
});
