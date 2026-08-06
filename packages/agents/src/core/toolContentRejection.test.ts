/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from '../testApi.js';
import {
  isToolContentRejection,
  describeRejectedPayload,
  buildToolContentRejectionAdvice,
  extractToolName,
} from './toolContentRejection.js';
import type { MediaBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';

const VERBATIM_2719_MESSAGE =
  "The image data you provided does not represent a valid image. Please check your input and try again with one of the supported image formats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].";

describe('toolContentRejection', () => {
  describe('isToolContentRejection', () => {
    it('returns true for the verbatim #2719 message at status 400', () => {
      expect(isToolContentRejection(400, VERBATIM_2719_MESSAGE)).toBe(true);
    });

    it.each([
      ['OpenAI unsupported image', 'You uploaded an unsupported image format.'],
      [
        'Anthropic media type mismatch',
        'image does not match the provided media type',
      ],
      ['Could not process image', 'Could not process image'],
      ['Invalid base64 data', 'Invalid base64 data'],
      ['Unsupported document type', 'Unsupported document type'],
      ['unable to decode audio', 'unable to decode audio'],
      [
        'Invalid MIME type',
        'Invalid MIME type. Only image types are supported.',
      ],
      ['Unsupported video format', 'Unsupported video format'],
    ])('returns true for provider phrasing variant: %s', (_name, message) => {
      expect(isToolContentRejection(400, message)).toBe(true);
    });

    it.each([
      [
        'Anthropic pydantic base64 string',
        'messages.0.content.1.image.source.base64.data: Input should be a valid string',
      ],
      [
        'Gemini multimodal function responses',
        'Multimodal function responses are not supported for this model',
      ],
      [
        'Gateway failed to download media',
        'Failed to download file from https://example.com/image.png',
      ],
    ])('returns true for real provider/gateway 400: %s', (_name, message) => {
      expect(isToolContentRejection(400, message)).toBe(true);
    });

    it.each([
      [
        'image inside read_image function name',
        "Invalid schema for function 'read_image': exceeds maximum nesting depth",
      ],
      [
        'image inside image_path arg',
        'Invalid tool call: image_path is required',
      ],
    ])(
      'returns false when a content term appears inside a larger identifier: %s',
      (_name, message) => {
        expect(isToolContentRejection(400, message)).toBe(false);
      },
    );

    it.each([
      // Word boundary must NOT prevent legitimate matches.
      ['image.source.base64', 'image.source.base64 is malformed'],
      ['image/jpeg in a list', "['image/jpeg', 'image/png'] is unsupported"],
    ])(
      'still matches a content term bounded by non-word characters: %s',
      (_name, message) => {
        expect(isToolContentRejection(400, message)).toBe(true);
      },
    );

    it.each([
      [
        'request-shape error',
        "Invalid JSON payload received. Unknown name 'foo'",
      ],
      ['parameter error', "Invalid value for 'temperature': must be <= 2"],
      [
        'context overflow',
        "This model's maximum context length is 128000 tokens",
      ],
      [
        'tool-schema depth',
        "Invalid schema for function 'x': exceeds maximum nesting depth",
      ],
      ['missing model param', "missing required parameter: 'model'"],
      ['tool-arg error', 'Invalid tool call: file_path is required'],
    ])('returns false for non-content 400: %s', (_name, message) => {
      expect(isToolContentRejection(400, message)).toBe(false);
    });

    // Accepted precision/recall trade-off (AC8). A parameter-validation error
    // whose parameter name IS a standalone content word is indistinguishable
    // from a real content rejection by message text alone, so it over-matches.
    // Recall is preferred: the issue requires that "any similar error should
    // recover", and narrowing the vocabulary to exclude these would drop real
    // provider rejections. The cost is bounded elsewhere — recovery also
    // requires the failing request to carry tool evidence, and the shared
    // one-shot guard allows at most one advice injection per round-trip, so
    // the worst case is a single wasted round-trip.
    it.each([
      ['document', 'Invalid parameter: document is required'],
      ['audio', 'Invalid parameter: audio is required'],
      ['video', 'Invalid parameter: video is required'],
    ])(
      'deliberately over-matches a parameter error whose parameter name is the standalone content word %s',
      (_name, message) => {
        expect(isToolContentRejection(400, message)).toBe(true);
      },
    );

    it.each([
      ['413', 413],
      ['429', 429],
      ['500', 500],
      ['undefined', undefined],
    ])(
      'returns false for status %s with an otherwise matching message',
      (_name, status) => {
        expect(isToolContentRejection(status, VERBATIM_2719_MESSAGE)).toBe(
          false,
        );
      },
    );

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['empty string', ''],
      ['whitespace only', '   '],
      ['non-string object', { message: 'invalid image' }],
    ])('returns false for a %s message at status 400', (_name, message) => {
      expect(isToolContentRejection(400, message)).toBe(false);
    });

    it('is case-insensitive (all-upper variant matches)', () => {
      expect(
        isToolContentRejection(400, VERBATIM_2719_MESSAGE.toUpperCase()),
      ).toBe(true);
    });
  });

  describe('extractToolName', () => {
    it('extracts the name from a neutral tool_response', () => {
      expect(
        extractToolName({ type: 'tool_response', toolName: 'read_file' }),
      ).toBe('read_file');
    });

    it('extracts the name from a neutral tool_call', () => {
      expect(extractToolName({ type: 'tool_call', name: 'search_file' })).toBe(
        'search_file',
      );
    });

    it('returns undefined for a tool_response whose toolName is not a non-empty string', () => {
      expect(
        extractToolName({ type: 'tool_response', toolName: '' }),
      ).toBeUndefined();
      expect(
        extractToolName({ type: 'tool_response', toolName: 123 }),
      ).toBeUndefined();
      expect(extractToolName({ type: 'tool_response' })).toBeUndefined();
    });

    it('returns undefined for a tool_call whose name is not a non-empty string', () => {
      expect(extractToolName({ type: 'tool_call', name: '' })).toBeUndefined();
      expect(extractToolName({ type: 'tool_call', name: 123 })).toBeUndefined();
    });

    it('returns undefined for a non-tool part', () => {
      expect(extractToolName({ type: 'text', text: 'hi' })).toBeUndefined();
    });
  });

  describe('describeRejectedPayload', () => {
    it('extracts tool names from ContentBlock[] tool_response blocks, de-duplicated in first-seen order', () => {
      const request = [
        { type: 'text', text: 'Hi' },
        {
          type: 'tool_response',
          callId: 'read_file',
          toolName: 'read_file',
          result: { content: 'x' },
        },
        {
          type: 'tool_response',
          callId: 'search_file',
          toolName: 'search_file',
          result: { content: 'y' },
        },
        {
          type: 'tool_response',
          callId: 'read_file-2',
          toolName: 'read_file',
          result: { content: 'z' },
        },
      ];
      expect(describeRejectedPayload(request).toolNames).toStrictEqual([
        'read_file',
        'search_file',
      ]);
    });

    it('extracts the same names from the equivalent IContent[] shape', () => {
      const request = [
        {
          speaker: 'human',
          blocks: [
            {
              type: 'tool_response',
              callId: 'read_file',
              toolName: 'read_file',
              result: { content: 'x' },
            },
            {
              type: 'tool_response',
              callId: 'search_file',
              toolName: 'search_file',
              result: { content: 'y' },
            },
          ],
        },
      ];
      expect(describeRejectedPayload(request).toolNames).toStrictEqual([
        'read_file',
        'search_file',
      ]);
    });

    it('extracts media descriptors with and without filename, de-duplicated', () => {
      const withFilename: MediaBlock = {
        type: 'media',
        mimeType: 'image/png',
        data: 'AAA',
        encoding: 'base64',
        filename: 'shader.fh',
      };
      const withoutFilename: MediaBlock = {
        type: 'media',
        mimeType: 'image/png',
        data: 'BBB',
        encoding: 'base64',
      };
      const duplicate: MediaBlock = {
        type: 'media',
        mimeType: 'image/png',
        data: 'CCC',
        encoding: 'base64',
        filename: 'shader.fh',
      };
      const request = [
        { type: 'text', text: 'Hi' },
        withFilename,
        withoutFilename,
        duplicate,
      ];
      expect(describeRejectedPayload(request).mediaDescriptors).toStrictEqual([
        'shader.fh (image/png)',
        'image/png',
      ]);
    });

    it.each([
      ['plain string request', 'just a string'],
      ['empty array', []],
    ])('returns empty arrays for %s', (_name, request) => {
      const result = describeRejectedPayload(request);
      expect(result.toolNames).toStrictEqual([]);
      expect(result.mediaDescriptors).toStrictEqual([]);
    });
  });

  describe('buildToolContentRejectionAdvice', () => {
    it('includes the tool clause, media clause, provider message, and the read-as-text guidance', () => {
      const advice = buildToolContentRejectionAdvice(
        {
          toolNames: ['read_file'],
          mediaDescriptors: ['shader.fh (image/png)'],
        },
        'The image data is not valid.',
      );
      expect(advice).toContain('HTTP 400');
      expect(advice).toContain('not added to the conversation');
      expect(advice).toContain('The tools involved were: read_file.');
      expect(advice).toContain(
        'The rejected content was: shader.fh (image/png).',
      );
      expect(advice).toContain(
        'Provider message: "The image data is not valid."',
      );
      expect(advice).toContain('read it as text');
    });

    it('omits the tool clause when there are no tool names and the media clause when there are no media descriptors', () => {
      const advice = buildToolContentRejectionAdvice(
        { toolNames: [], mediaDescriptors: [] },
        'invalid image',
      );
      expect(advice).not.toContain('The tools involved were');
      expect(advice).not.toContain('The rejected content was');
      expect(advice).toContain('Provider message: "invalid image"');
    });

    it('truncates a 1000-character provider message to 300 characters plus an ellipsis', () => {
      const long = 'a'.repeat(1000);
      const advice = buildToolContentRejectionAdvice(
        { toolNames: [], mediaDescriptors: [] },
        long,
      );
      // The quoted body should be exactly 300 chars + the ellipsis.
      expect(advice).toContain(`${'a'.repeat(300)}\u2026`);
      expect(advice).not.toContain(`${'a'.repeat(301)}`);
    });

    it('truncates on code points so an astral character is never split into a lone surrogate', () => {
      // The emoji straddles the 300-character limit: a naive UTF-16 slice
      // would cut it in half and emit an unpaired surrogate.
      const long = `${'a'.repeat(299)}\u{1F44D}${'b'.repeat(50)}`;
      const advice = buildToolContentRejectionAdvice(
        { toolNames: [], mediaDescriptors: [] },
        long,
      );

      expect(advice).toContain(`${'a'.repeat(299)}\u{1F44D}\u2026`);
      for (const char of advice) {
        const code = char.codePointAt(0) ?? 0;
        expect(code >= 0xd800 && code <= 0xdfff).toBe(false);
      }
    });

    it('drops the Provider message sentence for a blank provider message', () => {
      const advice = buildToolContentRejectionAdvice(
        { toolNames: ['read_file'], mediaDescriptors: [] },
        '   ',
      );
      expect(advice).not.toContain('Provider message');
      expect(advice).toContain('The tools involved were: read_file.');
      // Spacing around the dropped sentence is correct (single space).
      expect(advice).toContain('declared type. That content was not added');
    });

    it('contains no hardcoded file extension or tool name (AC4 guard)', () => {
      const advice = buildToolContentRejectionAdvice(
        {
          toolNames: ['some_tool'],
          mediaDescriptors: ['somefile.xyz (image/png)'],
        },
        'invalid image',
      );
      expect(advice).not.toContain('.fh');
      expect(advice).not.toContain('read_file');
      expect(advice).not.toContain('search_file');
    });
  });
});
