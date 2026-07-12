/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { Part } from '@google/genai';
import {
  DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES,
  getImageInlineDataSize,
  enforceImageBudget,
  buildOmissionFeedback,
} from './imagePayloadBudget.js';

function inlineDataPart(mimeType: string, dataLength: number): Part {
  return {
    inlineData: { mimeType, data: 'A'.repeat(dataLength) },
  };
}

function functionResponsePart(name: string, id = 'call-1'): Part {
  return {
    functionResponse: { name, id, response: { output: 'ok' } },
  };
}

function textPart(text: string): Part {
  return { text };
}

describe('getImageInlineDataSize', () => {
  it('returns the base64 string length for inlineData parts', () => {
    const part = inlineDataPart('image/png', 500);
    expect(getImageInlineDataSize(part)).toBe(500);
  });

  it('returns 0 for text parts', () => {
    expect(getImageInlineDataSize(textPart('hello'))).toBe(0);
  });

  it('returns 0 for functionResponse parts', () => {
    expect(getImageInlineDataSize(functionResponsePart('read_file'))).toBe(0);
  });

  it.each(['application/pdf', 'video/mp4', 'audio/mpeg'])(
    'returns 0 for non-image inlineData with MIME type %s',
    (mimeType) => {
      expect(getImageInlineDataSize(inlineDataPart(mimeType, 500))).toBe(0);
    },
  );

  it('returns 0 for a part with empty inlineData.data', () => {
    const part: Part = { inlineData: { mimeType: 'image/png', data: '' } };
    expect(getImageInlineDataSize(part)).toBe(0);
  });

  it('returns 0 when inlineData exists but data is undefined', () => {
    const part: Part = { inlineData: { mimeType: 'image/png' } };
    expect(getImageInlineDataSize(part)).toBe(0);
  });

  it('returns 0 when inlineData exists but mimeType is undefined', () => {
    const part: Part = { inlineData: { data: 'AA' } };
    expect(getImageInlineDataSize(part)).toBe(0);
  });

  it.each([null, 42, true])(
    'returns 0 when inlineData.data is malformed: %s',
    (data) => {
      const part = { inlineData: { mimeType: 'image/png', data } } as Part;
      expect(getImageInlineDataSize(part)).toBe(0);
    },
  );

  it('returns 0 when inlineData is undefined', () => {
    const part: Part = { text: 'not an image' };
    expect(getImageInlineDataSize(part)).toBe(0);
  });
});

describe('enforceImageBudget', () => {
  it('passes through all parts when under budget', () => {
    const parts = [
      functionResponsePart('read_file', 'a'),
      inlineDataPart('image/png', 1000),
      functionResponsePart('read_file', 'b'),
      inlineDataPart('image/png', 1000),
    ];

    const result = enforceImageBudget(parts, 10_000);

    expect(result.parts).toHaveLength(4);
    expect(result.omitted).toHaveLength(0);
    expect(result.totalImageBytes).toBe(2000);
  });

  it('retains images whose cumulative size exactly equals the budget', () => {
    const parts = [
      inlineDataPart('image/png', 500),
      inlineDataPart('image/jpeg', 500),
    ];

    const result = enforceImageBudget(parts, 1000);

    expect(result.parts).toStrictEqual(parts);
    expect(result.omitted).toHaveLength(0);
    expect(result.totalImageBytes).toBe(1000);
  });

  it('retains text and functionResponse parts even when images are omitted', () => {
    const parts = [
      functionResponsePart('read_file', 'a'),
      inlineDataPart('image/png', 5000),
      textPart('some text'),
      functionResponsePart('read_file', 'b'),
      inlineDataPart('image/png', 5000),
    ];

    const result = enforceImageBudget(parts, 6000);

    const nonImageParts = result.parts.filter(
      (p) => getImageInlineDataSize(p) === 0,
    );
    expect(nonImageParts).toHaveLength(3);
  });

  it('does not budget PDF, video, or audio data needed by media-aware providers', () => {
    const parts = [
      inlineDataPart('application/pdf', 5000),
      inlineDataPart('video/mp4', 5000),
      inlineDataPart('audio/mpeg', 5000),
      inlineDataPart('image/png', 1000),
    ];

    const result = enforceImageBudget(parts, 1000);

    expect(result.parts).toStrictEqual(parts);
    expect(result.omitted).toHaveLength(0);
    expect(result.totalImageBytes).toBe(1000);
  });

  it('omits images that would exceed the budget, keeping the earliest that fit', () => {
    const parts = [
      functionResponsePart('read_file', 'a'),
      inlineDataPart('image/png', 4000),
      functionResponsePart('read_file', 'b'),
      inlineDataPart('image/png', 4000),
      functionResponsePart('read_file', 'c'),
      inlineDataPart('image/png', 4000),
    ];

    const result = enforceImageBudget(parts, 9000);

    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0]?.toolName).toBe('read_file');
    expect(result.omitted[0]?.sizeBytes).toBe(4000);
    expect(result.totalImageBytes).toBe(8000);
    const retainedImages = result.parts.filter((p) => p.inlineData);
    expect(retainedImages).toHaveLength(2);
  });

  it('omits all subsequent images once the budget is exhausted', () => {
    const parts = [
      inlineDataPart('image/png', 5000),
      inlineDataPart('image/png', 2000),
      inlineDataPart('image/png', 2000),
    ];

    const result = enforceImageBudget(parts, 6000);

    expect(result.omitted).toHaveLength(2);
    expect(result.omitted[0]?.toolName).toBeUndefined();
    expect(result.totalImageBytes).toBe(5000);
  });

  it('handles a single image that alone exceeds the budget', () => {
    const parts = [
      functionResponsePart('read_file', 'a'),
      inlineDataPart('image/png', 100_000),
    ];

    const result = enforceImageBudget(parts, 50_000);

    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0]?.sizeBytes).toBe(100_000);
    expect(result.omitted[0]?.mimeType).toBe('image/png');
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]?.functionResponse?.name).toBe('read_file');
    expect(result.totalImageBytes).toBe(0);
  });

  it('tracks the tool name for each omitted image', () => {
    const parts = [
      functionResponsePart('read_file', 'a'),
      inlineDataPart('image/png', 3000),
      functionResponsePart('screenshot', 'b'),
      inlineDataPart('image/png', 3000),
      functionResponsePart('read_file', 'c'),
      inlineDataPart('image/png', 3000),
    ];

    const result = enforceImageBudget(parts, 7000);

    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0]?.toolName).toBe('read_file');
  });

  it('returns identical parts and empty omitted when no images present', () => {
    const parts = [
      functionResponsePart('list_directory', 'a'),
      textPart('3 files found'),
      functionResponsePart('grep', 'b'),
    ];

    const result = enforceImageBudget(parts, 100);

    expect(result.parts).toStrictEqual(parts);
    expect(result.omitted).toHaveLength(0);
    expect(result.totalImageBytes).toBe(0);
  });

  it('preserves part ordering for retained images and non-image parts', () => {
    const parts = [
      functionResponsePart('read_file', 'a'),
      inlineDataPart('image/png', 1000),
      functionResponsePart('grep', 'b'),
      textPart('found it'),
    ];

    const result = enforceImageBudget(parts, 100_000);

    expect(result.parts.map((p) => p.functionResponse?.name)).toStrictEqual([
      'read_file',
      undefined,
      'grep',
      undefined,
    ]);
  });

  it('handles empty parts array', () => {
    const result = enforceImageBudget([], 1000);
    expect(result.parts).toStrictEqual([]);
    expect(result.omitted).toHaveLength(0);
  });

  it('works with the default budget constant', () => {
    const parts = [
      functionResponsePart('read_file', 'a'),
      inlineDataPart('image/png', DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES - 1),
    ];

    const result = enforceImageBudget(
      parts,
      DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES,
    );
    expect(result.omitted).toHaveLength(0);
  });

  it('returns all parts unchanged when budgetBytes is zero', () => {
    const parts = [
      functionResponsePart('read_file', 'a'),
      inlineDataPart('image/png', 5000),
    ];
    const result = enforceImageBudget(parts, 0);
    expect(result.parts).toStrictEqual(parts);
    expect(result.omitted).toHaveLength(0);
  });

  it('returns all parts unchanged when budgetBytes is negative', () => {
    const parts = [
      functionResponsePart('read_file', 'a'),
      inlineDataPart('image/png', 5000),
    ];
    const result = enforceImageBudget(parts, -1);
    expect(result.parts).toStrictEqual(parts);
    expect(result.omitted).toHaveLength(0);
  });

  it('returns all parts unchanged when budgetBytes is NaN', () => {
    const parts = [
      functionResponsePart('read_file', 'a'),
      inlineDataPart('image/png', 5000),
    ];
    const result = enforceImageBudget(parts, NaN);
    expect(result.parts).toStrictEqual(parts);
    expect(result.omitted).toHaveLength(0);
  });

  it('returns all parts unchanged when budgetBytes is Infinity', () => {
    const parts = [
      functionResponsePart('read_file', 'a'),
      inlineDataPart('image/png', 5000),
    ];
    const result = enforceImageBudget(parts, Infinity);
    expect(result.omitted).toHaveLength(0);
    expect(result.parts).toStrictEqual(parts);
  });
});

describe('buildOmissionFeedback', () => {
  it('includes the count of omitted images', () => {
    const feedback = buildOmissionFeedback([
      { toolName: 'read_file', mimeType: 'image/png', sizeBytes: 5000 },
    ]);
    expect(feedback).toContain('1 image(s)');
  });

  it('lists the tool names when available', () => {
    const feedback = buildOmissionFeedback([
      { toolName: 'read_file', mimeType: 'image/png', sizeBytes: 5000 },
      { toolName: 'screenshot', mimeType: 'image/jpeg', sizeBytes: 5000 },
    ]);
    expect(feedback).toContain('read_file');
    expect(feedback).toContain('screenshot');
  });

  it('deduplicates tool names in the feedback', () => {
    const feedback = buildOmissionFeedback([
      { toolName: 'read_file', mimeType: 'image/png', sizeBytes: 5000 },
      { toolName: 'read_file', mimeType: 'image/png', sizeBytes: 5000 },
    ]);
    const occurrences = feedback.split('read_file').length - 1;
    expect(occurrences).toBe(1);
  });

  it('omits the tool list when tool names are all undefined', () => {
    const feedback = buildOmissionFeedback([
      { toolName: undefined, mimeType: 'image/png', sizeBytes: 5000 },
    ]);
    expect(feedback).not.toContain('tools:');
  });

  it('instructs the model to re-read images individually', () => {
    const feedback = buildOmissionFeedback([
      { toolName: 'read_file', mimeType: 'image/png', sizeBytes: 5000 },
    ]);
    expect(feedback.toLowerCase()).toContain('one at a time');
  });

  it('handles empty omitted array gracefully', () => {
    const feedback = buildOmissionFeedback([]);
    expect(feedback).toContain('0 image(s)');
  });

  it('lists all distinct tool names from a mixed set of tools', () => {
    const feedback = buildOmissionFeedback([
      { toolName: 'read_file', mimeType: 'image/png', sizeBytes: 5000 },
      { toolName: 'screenshot', mimeType: 'image/jpeg', sizeBytes: 5000 },
      { toolName: 'read_file', mimeType: 'image/png', sizeBytes: 5000 },
    ]);
    expect(feedback).toContain('read_file');
    expect(feedback).toContain('screenshot');
    const readCount = feedback.split('read_file').length - 1;
    expect(readCount).toBe(1);
  });
});
