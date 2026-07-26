/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES,
  getImageInlineDataSize,
  enforceImageBudget,
  buildOmissionFeedback,
} from './imagePayloadBudget.js';

function mediaBlock(mimeType: string, dataLength: number): ContentBlock {
  return {
    type: 'media',
    mimeType,
    data: 'A'.repeat(dataLength),
    encoding: 'base64',
  };
}

function toolResponseBlock(name: string, id = 'call-1'): ContentBlock {
  return {
    type: 'tool_response',
    callId: id,
    toolName: name,
    result: { output: 'ok' },
  };
}

function textBlock(text: string): ContentBlock {
  return { type: 'text', text };
}

describe('getImageInlineDataSize', () => {
  it('returns the base64 string length for media blocks', () => {
    const block = mediaBlock('image/png', 500);
    expect(getImageInlineDataSize(block)).toBe(500);
  });

  it('returns 0 for text blocks', () => {
    expect(getImageInlineDataSize(textBlock('hello'))).toBe(0);
  });

  it('returns 0 for tool_response blocks', () => {
    expect(getImageInlineDataSize(toolResponseBlock('read_file'))).toBe(0);
  });

  it.each(['application/pdf', 'video/mp4', 'audio/mpeg'])(
    'returns 0 for non-image media with MIME type %s',
    (mimeType) => {
      expect(getImageInlineDataSize(mediaBlock(mimeType, 500))).toBe(0);
    },
  );

  it('returns 0 for a media block with empty data', () => {
    const block: ContentBlock = {
      type: 'media',
      mimeType: 'image/png',
      data: '',
      encoding: 'base64',
    };
    expect(getImageInlineDataSize(block)).toBe(0);
  });

  it('returns 0 for a text block (not media)', () => {
    const block: ContentBlock = { type: 'text', text: 'not an image' };
    expect(getImageInlineDataSize(block)).toBe(0);
  });
});

describe('enforceImageBudget', () => {
  it('passes through all blocks when under budget', () => {
    const blocks = [
      toolResponseBlock('read_file', 'a'),
      mediaBlock('image/png', 1000),
      toolResponseBlock('read_file', 'b'),
      mediaBlock('image/png', 1000),
    ];

    const result = enforceImageBudget(blocks, 10_000);

    expect(result.blocks).toHaveLength(4);
    expect(result.omitted).toHaveLength(0);
    expect(result.totalImageBytes).toBe(2000);
  });

  it('retains images whose cumulative size exactly equals the budget', () => {
    const blocks = [
      mediaBlock('image/png', 500),
      mediaBlock('image/jpeg', 500),
    ];

    const result = enforceImageBudget(blocks, 1000);

    expect(result.blocks).toStrictEqual(blocks);
    expect(result.omitted).toHaveLength(0);
    expect(result.totalImageBytes).toBe(1000);
  });

  it('retains text and tool_response blocks even when images are omitted', () => {
    const blocks = [
      toolResponseBlock('read_file', 'a'),
      mediaBlock('image/png', 5000),
      textBlock('some text'),
      toolResponseBlock('read_file', 'b'),
      mediaBlock('image/png', 5000),
    ];

    const result = enforceImageBudget(blocks, 6000);

    const nonImageBlocks = result.blocks.filter(
      (b) => getImageInlineDataSize(b) === 0,
    );
    expect(nonImageBlocks).toHaveLength(3);
  });

  it('does not budget PDF, video, or audio data needed by media-aware providers', () => {
    const blocks = [
      mediaBlock('application/pdf', 5000),
      mediaBlock('video/mp4', 5000),
      mediaBlock('audio/mpeg', 5000),
      mediaBlock('image/png', 1000),
    ];

    const result = enforceImageBudget(blocks, 1000);

    expect(result.blocks).toStrictEqual(blocks);
    expect(result.omitted).toHaveLength(0);
    expect(result.totalImageBytes).toBe(1000);
  });

  it('omits images that would exceed the budget, keeping the earliest that fit', () => {
    const blocks = [
      toolResponseBlock('read_file', 'a'),
      mediaBlock('image/png', 4000),
      toolResponseBlock('read_file', 'b'),
      mediaBlock('image/png', 4000),
      toolResponseBlock('read_file', 'c'),
      mediaBlock('image/png', 4000),
    ];

    const result = enforceImageBudget(blocks, 9000);

    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0]?.toolName).toBe('read_file');
    expect(result.omitted[0]?.sizeBytes).toBe(4000);
    expect(result.totalImageBytes).toBe(8000);
    const retainedImages = result.blocks.filter((b) => b.type === 'media');
    expect(retainedImages).toHaveLength(2);
  });

  it('omits all subsequent images once the budget is exhausted', () => {
    const blocks = [
      mediaBlock('image/png', 5000),
      mediaBlock('image/png', 2000),
      mediaBlock('image/png', 2000),
    ];

    const result = enforceImageBudget(blocks, 6000);

    expect(result.omitted).toHaveLength(2);
    expect(result.omitted[0]?.toolName).toBeUndefined();
    expect(result.totalImageBytes).toBe(5000);
  });

  it('handles a single image that alone exceeds the budget', () => {
    const blocks = [
      toolResponseBlock('read_file', 'a'),
      mediaBlock('image/png', 100_000),
    ];

    const result = enforceImageBudget(blocks, 50_000);

    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0]?.sizeBytes).toBe(100_000);
    expect(result.omitted[0]?.mimeType).toBe('image/png');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.type).toBe('tool_response');
    expect(result.totalImageBytes).toBe(0);
  });

  it('tracks the tool name for each omitted image', () => {
    const blocks = [
      toolResponseBlock('read_file', 'a'),
      mediaBlock('image/png', 3000),
      toolResponseBlock('screenshot', 'b'),
      mediaBlock('image/png', 3000),
      toolResponseBlock('read_file', 'c'),
      mediaBlock('image/png', 3000),
    ];

    const result = enforceImageBudget(blocks, 7000);

    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0]?.toolName).toBe('read_file');
  });

  it('returns identical blocks and empty omitted when no images present', () => {
    const blocks = [
      toolResponseBlock('list_directory', 'a'),
      textBlock('3 files found'),
      toolResponseBlock('grep', 'b'),
    ];

    const result = enforceImageBudget(blocks, 100);

    expect(result.blocks).toStrictEqual(blocks);
    expect(result.omitted).toHaveLength(0);
    expect(result.totalImageBytes).toBe(0);
  });

  it('preserves block ordering for retained images and non-image blocks', () => {
    const blocks = [
      toolResponseBlock('read_file', 'a'),
      mediaBlock('image/png', 1000),
      toolResponseBlock('grep', 'b'),
      textBlock('found it'),
    ];

    const result = enforceImageBudget(blocks, 100_000);

    expect(
      result.blocks.map((b) =>
        b.type === 'tool_response' ? b.toolName : undefined,
      ),
    ).toStrictEqual(['read_file', undefined, 'grep', undefined]);
  });

  it('handles empty blocks array', () => {
    const result = enforceImageBudget([], 1000);
    expect(result.blocks).toStrictEqual([]);
    expect(result.omitted).toHaveLength(0);
  });

  it('works with the default budget constant', () => {
    const blocks = [
      toolResponseBlock('read_file', 'a'),
      mediaBlock('image/png', DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES - 1),
    ];

    const result = enforceImageBudget(
      blocks,
      DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES,
    );
    expect(result.omitted).toHaveLength(0);
  });

  it('returns all blocks unchanged and counts retained image bytes when budgetBytes is zero', () => {
    const blocks = [
      toolResponseBlock('read_file', 'a'),
      mediaBlock('image/png', 5000),
    ];
    const result = enforceImageBudget(blocks, 0);
    expect(result.blocks).toStrictEqual(blocks);
    expect(result.omitted).toHaveLength(0);
    expect(result.totalImageBytes).toBe(5000);
  });

  it('returns all blocks unchanged and counts retained image bytes when budgetBytes is negative', () => {
    const blocks = [
      toolResponseBlock('read_file', 'a'),
      mediaBlock('image/png', 5000),
    ];
    const result = enforceImageBudget(blocks, -1);
    expect(result.blocks).toStrictEqual(blocks);
    expect(result.omitted).toHaveLength(0);
    expect(result.totalImageBytes).toBe(5000);
  });

  it('returns all blocks unchanged and counts retained image bytes when budgetBytes is NaN', () => {
    const blocks = [
      toolResponseBlock('read_file', 'a'),
      mediaBlock('image/png', 5000),
    ];
    const result = enforceImageBudget(blocks, NaN);
    expect(result.blocks).toStrictEqual(blocks);
    expect(result.omitted).toHaveLength(0);
    expect(result.totalImageBytes).toBe(5000);
  });

  it('returns all blocks unchanged and counts retained image bytes when budgetBytes is Infinity', () => {
    const blocks = [
      toolResponseBlock('read_file', 'a'),
      mediaBlock('image/png', 5000),
    ];
    const result = enforceImageBudget(blocks, Infinity);
    expect(result.omitted).toHaveLength(0);
    expect(result.blocks).toStrictEqual(blocks);
    expect(result.totalImageBytes).toBe(5000);
  });

  it('counts the total size of multiple retained images when enforcement is skipped', () => {
    const blocks = [
      mediaBlock('image/png', 3000),
      textBlock('separator'),
      mediaBlock('image/jpeg', 2000),
    ];
    const result = enforceImageBudget(blocks, 0);
    expect(result.blocks).toStrictEqual(blocks);
    expect(result.omitted).toHaveLength(0);
    expect(result.totalImageBytes).toBe(5000);
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

  it('omits the tool list when tool names are missing or empty', () => {
    const feedback = buildOmissionFeedback([
      { toolName: undefined, mimeType: 'image/png', sizeBytes: 5000 },
      { toolName: '', mimeType: 'image/png', sizeBytes: 5000 },
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
