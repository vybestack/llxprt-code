/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import type {
  ContentBlock,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { isMediaReferenceBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES,
  getImageEncodedSize,
  getImageInlineDataSize,
  enforceImageBudget,
  buildOmissionFeedback,
  type OmittedImage,
} from './imagePayloadBudget.js';

function mediaBlock(
  mimeType: string,
  dataLength: number,
  filename?: string,
): ContentBlock {
  return {
    type: 'media',
    mimeType,
    data: 'A'.repeat(dataLength),
    encoding: 'base64',
    ...(filename === undefined ? {} : { filename }),
  };
}

const SELECTED_ID = `sha256:${'e'.repeat(64)}`;
const ORIGINAL_ID = `sha256:${'f'.repeat(64)}`;

/** Builds a valid stored-media reference whose wire size is `encodedLength`. */
function referenceBlock(
  mimeType: string,
  encodedLength: number,
  filename?: string,
): MediaReferenceBlock {
  const byteLength = (encodedLength / 4) * 3;
  const object = (contentId: string) => ({
    contentId,
    mimeType,
    byteLength,
    normalizedBase64Length: encodedLength,
  });
  const block: MediaReferenceBlock = {
    type: 'media',
    encoding: 'reference',
    mimeType,
    contentId: SELECTED_ID,
    originalContentId: ORIGINAL_ID,
    selectedContentId: SELECTED_ID,
    originalObject: object(ORIGINAL_ID),
    selectedObject: object(SELECTED_ID),
    transformation: {
      policyId: 'image-resize',
      policyVersion: 1,
      parameters: {},
    },
    byteLength,
    normalizedBase64Length: encodedLength,
    semanticMetadata: {},
    ...(filename === undefined ? {} : { filename }),
  };
  if (!isMediaReferenceBlock(block)) {
    throw new Error('test fixture is not a valid media reference');
  }
  return block;
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
    const {
      preservesBlockOrderingForRetainedImagesAndNonImageBlocksObservation1,
    } = observePreservesBlockOrderingForRetainedImagesAndNonImageBlocks();
    expect(
      preservesBlockOrderingForRetainedImagesAndNonImageBlocksObservation1,
    ).toStrictEqual(['read_file', undefined, 'grep', undefined]);
  });

  const observePreservesBlockOrderingForRetainedImagesAndNonImageBlocks =
    () => {
      const blocks = [
        toolResponseBlock('read_file', 'a'),
        mediaBlock('image/png', 1000),
        toolResponseBlock('grep', 'b'),
        textBlock('found it'),
      ];

      const result = enforceImageBudget(blocks, 100_000);

      const preservesBlockOrderingForRetainedImagesAndNonImageBlocksObservation1 =
        result.blocks.map((b) =>
          b.type === 'tool_response' ? b.toolName : undefined,
        );
      return {
        preservesBlockOrderingForRetainedImagesAndNonImageBlocksObservation1,
      };
    };

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

describe('getImageEncodedSize', () => {
  it('measures a referenced image by its normalized base64 length', () => {
    expect(getImageEncodedSize(referenceBlock('image/png', 4000))).toBe(4000);
  });

  it('measures an inline image by its base64 string length', () => {
    expect(getImageEncodedSize(mediaBlock('image/jpeg', 300))).toBe(300);
  });

  it('does not count a referenced non-image', () => {
    expect(getImageEncodedSize(referenceBlock('application/pdf', 4000))).toBe(
      0,
    );
  });

  it('does not count text or tool responses', () => {
    expect(getImageEncodedSize(textBlock('hi'))).toBe(0);
    expect(getImageEncodedSize(toolResponseBlock('read_file'))).toBe(0);
  });
});

describe('enforceImageBudget with referenced images', () => {
  it('counts referenced images toward the cumulative budget', () => {
    const blocks = [
      toolResponseBlock('read_file', 'a'),
      referenceBlock('image/png', 4000, 'a.png'),
      toolResponseBlock('read_file', 'b'),
      referenceBlock('image/png', 4000, 'b.png'),
    ];

    const result = enforceImageBudget(blocks, 6000);

    expect(result.totalImageBytes).toBe(4000);
    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0]?.sizeBytes).toBe(4000);
    expect(result.omitted[0]?.filename).toBe('b.png');
  });

  it('counts mixed inline and referenced images together', () => {
    const blocks = [
      toolResponseBlock('read_file', 'a'),
      mediaBlock('image/png', 4000),
      toolResponseBlock('read_file', 'b'),
      referenceBlock('image/png', 4000),
    ];

    const result = enforceImageBudget(blocks, 6000);

    expect(result.omitted.map((o) => o.callId)).toStrictEqual(['b']);
  });

  it('does not budget referenced non-image media', () => {
    const blocks = [
      toolResponseBlock('read_file', 'a'),
      referenceBlock('application/pdf', 40_000),
    ];

    const result = enforceImageBudget(blocks, 1000);

    expect(result.blocks).toStrictEqual(blocks);
    expect(result.omitted).toHaveLength(0);
  });
});

describe('enforceImageBudget omission metadata', () => {
  it('records call, file, MIME type, encoded size and aggregate reason', () => {
    const blocks = [
      toolResponseBlock('read_file', 'call-a'),
      mediaBlock('image/png', 4000, 'first.png'),
      toolResponseBlock('read_file', 'call-b'),
      mediaBlock('image/jpeg', 4000, 'second.jpg'),
    ];

    const result = enforceImageBudget(blocks, 6000);

    expect(result.omitted).toStrictEqual([
      {
        toolName: 'read_file',
        callId: 'call-b',
        filename: 'second.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 4000,
        reason: 'aggregate-budget',
      },
    ]);
  });

  it('keeps every tool response and its text when images are omitted', () => {
    const blocks = [
      toolResponseBlock('read_file', 'a'),
      mediaBlock('image/png', 4000),
      toolResponseBlock('read_file', 'b'),
      mediaBlock('image/png', 4000),
      toolResponseBlock('read_file', 'c'),
      mediaBlock('image/png', 4000),
    ];

    const result = enforceImageBudget(blocks, 6000);

    const retainedIds = result.blocks.flatMap((b) =>
      b.type === 'tool_response' ? [b.callId] : [],
    );
    expect(retainedIds).toStrictEqual(['a', 'b', 'c']);
  });

  it('classifies an image larger than the whole budget as exceeding it alone', () => {
    const blocks = [
      toolResponseBlock('read_file', 'big'),
      mediaBlock('image/png', 9000, 'huge.png'),
    ];

    const result = enforceImageBudget(blocks, 6000);

    expect(result.omitted[0]?.reason).toBe('exceeds-budget-alone');
    expect(result.omitted[0]?.callId).toBe('big');
  });

  it('keeps classifying intrinsic oversize images after the budget is exhausted', () => {
    const blocks = [
      toolResponseBlock('read_file', 'a'),
      mediaBlock('image/png', 5000),
      toolResponseBlock('read_file', 'b'),
      mediaBlock('image/png', 2000),
      toolResponseBlock('read_file', 'c'),
      mediaBlock('image/png', 9000),
    ];

    const result = enforceImageBudget(blocks, 6000);

    expect(result.omitted.map((o) => [o.callId, o.reason])).toStrictEqual([
      ['b', 'aggregate-budget'],
      ['c', 'exceeds-budget-alone'],
    ]);
  });

  it('classifies an image exactly equal to the budget as fitting alone', () => {
    const blocks = [
      toolResponseBlock('read_file', 'a'),
      mediaBlock('image/png', 1000),
      toolResponseBlock('read_file', 'b'),
      mediaBlock('image/png', 6000),
    ];

    const result = enforceImageBudget(blocks, 6000);

    expect(result.omitted[0]?.reason).toBe('aggregate-budget');
  });

  it('records no call identity for media preceding any tool response', () => {
    const result = enforceImageBudget(
      [mediaBlock('image/png', 5000), mediaBlock('image/png', 5000)],
      6000,
    );

    expect(result.omitted[0]?.callId).toBeUndefined();
    expect(result.omitted[0]?.filename).toBeUndefined();
  });
});

function omission(overrides: Partial<OmittedImage> = {}): OmittedImage {
  return {
    toolName: 'read_file',
    callId: 'call-1',
    filename: 'photo.png',
    mimeType: 'image/png',
    sizeBytes: 5000,
    reason: 'aggregate-budget',
    ...overrides,
  };
}

describe('buildOmissionFeedback', () => {
  it('includes the count of omitted images and the numeric byte budget', () => {
    const feedback = buildOmissionFeedback([omission()], 15_728_640);
    expect(feedback).toContain('1 image(s)');
    expect(feedback).toContain('15728640');
  });

  it('names the omitted file, call, MIME type and encoded size', () => {
    const feedback = buildOmissionFeedback(
      [omission({ sizeBytes: 5123 })],
      6000,
    );
    expect(feedback).toContain('photo.png');
    expect(feedback).toContain('call-1');
    expect(feedback).toContain('read_file');
    expect(feedback).toContain('image/png');
    expect(feedback).toContain('5123');
  });

  it('lists each omitted image separately', () => {
    const feedback = buildOmissionFeedback(
      [
        omission({ callId: 'c1', filename: 'one.png' }),
        omission({ callId: 'c2', filename: 'two.png' }),
      ],
      6000,
    );
    expect(feedback).toContain('one.png');
    expect(feedback).toContain('two.png');
    expect(feedback).toContain('c1');
    expect(feedback).toContain('c2');
  });

  it('still describes an omitted image whose file and call are unknown', () => {
    const feedback = buildOmissionFeedback(
      [
        omission({
          callId: undefined,
          filename: undefined,
          toolName: undefined,
        }),
      ],
      6000,
    );
    expect(feedback).toContain('image/png');
    expect(feedback).toContain('5000');
    expect(feedback).not.toContain('undefined');
  });

  it('tells the model to request fewer or smaller batches for aggregate overflow', () => {
    const feedback = buildOmissionFeedback([omission()], 6000).toLowerCase();
    expect(feedback).toContain('fewer');
    expect(feedback).toContain('batch');
    expect(feedback).not.toContain('cannot fit alone');
  });

  it('tells the model an intrinsically oversize image cannot fit alone and must be resized or cropped', () => {
    const feedback = buildOmissionFeedback(
      [omission({ reason: 'exceeds-budget-alone', sizeBytes: 9000 })],
      6000,
    ).toLowerCase();
    expect(feedback).toContain('cannot fit alone');
    expect(feedback).toMatch(/resiz|crop/);
    expect(feedback).toContain('9000');
    expect(feedback).toContain('6000');
  });

  it('gives no reread advice for an intrinsically oversize image', () => {
    const feedback = buildOmissionFeedback(
      [omission({ reason: 'exceeds-budget-alone', sizeBytes: 9000 })],
      6000,
    ).toLowerCase();
    expect(feedback).not.toContain('re-read');
    expect(feedback).not.toContain('one at a time');
    expect(feedback).not.toContain('fewer');
  });

  it('gives both remedies when aggregate and intrinsic omissions occur together', () => {
    const feedback = buildOmissionFeedback(
      [
        omission({ filename: 'small.png' }),
        omission({
          filename: 'huge.png',
          reason: 'exceeds-budget-alone',
          sizeBytes: 9000,
        }),
      ],
      6000,
    ).toLowerCase();
    expect(feedback).toContain('fewer');
    expect(feedback).toContain('cannot fit alone');
    expect(feedback).toContain('small.png');
    expect(feedback).toContain('huge.png');
  });

  it('handles empty omitted array gracefully', () => {
    const feedback = buildOmissionFeedback([], 6000);
    expect(feedback).toContain('0 image(s)');
  });

  describe('with a very large number of omissions', () => {
    const LISTED_PER_CATEGORY = 20;

    function manyOmissions(
      count: number,
      overrides: Partial<OmittedImage>,
    ): OmittedImage[] {
      return Array.from({ length: count }, (_, index) =>
        omission({
          callId: `call-${index}`,
          filename: `img-${index}.png`,
          ...overrides,
        }),
      );
    }

    function listedEntries(feedback: string): string[] {
      return feedback.split('\n').filter((line) => line.startsWith('- file '));
    }

    it('lists a bounded number of aggregate omissions and counts the rest, keeping the remedy', () => {
      const feedback = buildOmissionFeedback(
        manyOmissions(100, { reason: 'aggregate-budget' }),
        6000,
      );

      expect({
        listed: listedEntries(feedback).length,
        lastListed: feedback.includes(`img-${LISTED_PER_CATEGORY - 1}.png`),
        firstUnlisted: feedback.includes(`img-${LISTED_PER_CATEGORY}.png`),
        headerCount: feedback.includes('100 image(s) were omitted'),
        remainder: feedback.includes('and 80 more omitted images not listed'),
        remedy: feedback.includes('Request fewer images per call'),
      }).toStrictEqual({
        listed: LISTED_PER_CATEGORY,
        lastListed: true,
        firstUnlisted: false,
        headerCount: true,
        remainder: true,
        remedy: true,
      });
    });

    it('bounds the intrinsic list independently and keeps the resize guidance', () => {
      const feedback = buildOmissionFeedback(
        [
          ...manyOmissions(3, { reason: 'aggregate-budget' }),
          ...manyOmissions(45, {
            reason: 'exceeds-budget-alone',
            sizeBytes: 9000,
          }).map((entry, index) => ({
            ...entry,
            filename: `huge-${index}.png`,
          })),
        ],
        6000,
      );

      expect({
        listed: listedEntries(feedback).length,
        aggregateAllListed: [0, 1, 2].every((i) =>
          feedback.includes(`img-${i}.png`),
        ),
        oversizeRemainder: feedback.includes(
          'and 25 more omitted images not listed',
        ),
        guidance: feedback.includes('Provide a resized or cropped'),
      }).toStrictEqual({
        listed: 3 + LISTED_PER_CATEGORY,
        aggregateAllListed: true,
        oversizeRemainder: true,
        guidance: true,
      });
    });

    it('does not add a remainder line when everything fits in the list', () => {
      const feedback = buildOmissionFeedback(
        manyOmissions(LISTED_PER_CATEGORY, { reason: 'aggregate-budget' }),
        6000,
      );

      expect([
        listedEntries(feedback).length,
        feedback.includes('not listed'),
      ]).toStrictEqual([LISTED_PER_CATEGORY, false]);
    });

    it('bounds each label so one long filename or call id cannot dominate the feedback', () => {
      const feedback = buildOmissionFeedback(
        [
          omission({
            filename: `${'f'.repeat(500)}.png`,
            toolName: 't'.repeat(500),
            callId: 'c'.repeat(500),
          }),
        ],
        6000,
      );

      expect(feedback.length).toBeLessThan(700);
    });

    it('keeps every tool response id in the budgeted blocks however many images are omitted', () => {
      const blocks = Array.from({ length: 60 }, (_, index) => [
        toolResponseBlock('read_file', `call-${index}`),
        mediaBlock('image/png', 5000, `img-${index}.png`),
      ]).flat();

      const result = enforceImageBudget(blocks, 6000);

      expect({
        omitted: result.omitted.length,
        retainedCallIds: result.blocks.flatMap((block) =>
          block.type === 'tool_response' ? [block.callId] : [],
        ),
      }).toStrictEqual({
        omitted: 59,
        retainedCallIds: Array.from({ length: 60 }, (_, i) => `call-${i}`),
      });
    });
  });
});
