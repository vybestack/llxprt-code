/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3216 — Behavioral tests for the Anthropic image sanitizer and error
 * classifier. Uses real IContent media blocks and real Anthropic-shaped error
 * objects (structural, not class-asserted) to prove immutable sanitization and
 * narrow classification.
 */

import { describe, it, expect } from 'bun:test';
import { APIError } from '@anthropic-ai/sdk';
import sharp from 'sharp';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  sanitizeAnthropicContentImages,
  sanitizeAnthropicRequestBodyImages,
  isAnthropicImageDimensionLimitError,
  parseAnthropicImageDimensionLimit,
  resolveRecoveryImageBudget,
} from './AnthropicImageSanitizer.js';

/** Cast-free text extraction from a discriminated-union block. */
function textOf(block: ContentBlock): string {
  return block.type === 'text' ? block.text : '';
}

/** Cast-free media-data extraction from a discriminated-union block. */
function dataOf(block: ContentBlock): string {
  return block.type === 'media' && block.encoding !== 'reference'
    ? block.data
    : '';
}

async function pngBase64(width: number, height: number): Promise<string> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 12, g: 34, b: 56, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  return buffer.toString('base64');
}

function mediaContent(
  speaker: 'human' | 'ai' | 'tool',
  blocks: IContent['blocks'],
): IContent {
  return {
    speaker,
    blocks,
    metadata: {},
  };
}

describe('sanitizeAnthropicContentImages (@issue:3216)', () => {
  it('replaces oversized image blocks with text placeholders in an immutable copy', async () => {
    const big = await pngBase64(3000, 3000);
    const ok = await pngBase64(1000, 1000);
    const original: IContent[] = [
      mediaContent('human', [
        { type: 'media', mimeType: 'image/png', data: big, encoding: 'base64' },
        { type: 'text', text: 'hello' },
        { type: 'media', mimeType: 'image/png', data: ok, encoding: 'base64' },
      ]),
    ];

    const result = sanitizeAnthropicContentImages(original, {
      maxDimension: 2000,
    });

    expect(result.replacedCount).toBe(1);
    const blocks = result.contents[0].blocks;
    // First media block replaced with text.
    expect(blocks[0].type).toBe('text');
    expect(textOf(blocks[0])).toContain('dropped');
    // Text block preserved.
    expect(blocks[1].type).toBe('text');
    expect(textOf(blocks[1])).toBe('hello');
    // Within-budget image preserved.
    expect(blocks[2].type).toBe('media');
    expect(dataOf(blocks[2])).toBe(ok);
    // Original array is NOT mutated.
    expect(original[0].blocks[0].type).toBe('media');
    expect(dataOf(original[0].blocks[0])).toBe(big);
  });

  it('returns the original contents unchanged when no budget is configured', async () => {
    const big = await pngBase64(3000, 3000);
    const original: IContent[] = [
      mediaContent('human', [
        { type: 'media', mimeType: 'image/png', data: big, encoding: 'base64' },
      ]),
    ];

    const result = sanitizeAnthropicContentImages(original, undefined);

    expect(result.replacedCount).toBe(0);
    expect(result.contents).toBe(original);
  });

  it('preserves non-image blocks and tool-response validity', async () => {
    const big = await pngBase64(3000, 3000);
    const original: IContent[] = [
      mediaContent('tool', [
        {
          type: 'tool_response',
          callId: 'call-1',
          toolName: 'read_file',
          result: 'ok',
        },
        { type: 'media', mimeType: 'image/png', data: big, encoding: 'base64' },
      ]),
    ];

    const result = sanitizeAnthropicContentImages(original, {
      maxDimension: 2000,
    });

    expect(result.replacedCount).toBe(1);
    const blocks = result.contents[0].blocks;
    // tool_response preserved.
    expect(blocks[0].type).toBe('tool_response');
    // Image replaced.
    expect(blocks[1].type).toBe('text');
  });

  it('keeps an image whose edges are exactly at the dimension boundary (inclusive)', async () => {
    const exact = await pngBase64(2000, 2000);
    const original: IContent[] = [
      mediaContent('human', [
        {
          type: 'media',
          mimeType: 'image/png',
          data: exact,
          encoding: 'base64',
        },
      ]),
    ];

    const result = sanitizeAnthropicContentImages(original, {
      maxDimension: 2000,
    });

    expect(result.replacedCount).toBe(0);
    const blocks = result.contents[0].blocks;
    expect(blocks[0].type).toBe('media');
    expect(dataOf(blocks[0])).toBe(exact);
  });

  it('replaces an image that is within the dimension limit but exceeds a pixel-only budget', async () => {
    // 1200x1200 = 1.44M px, well within a 2000 dimension limit, but over a
    // 1M pixel-only budget. A maxPixels-only violation must still be replaced.
    const tall = await pngBase64(1200, 1200);
    const original: IContent[] = [
      mediaContent('human', [
        {
          type: 'media',
          mimeType: 'image/png',
          data: tall,
          encoding: 'base64',
        },
      ]),
    ];

    const result = sanitizeAnthropicContentImages(original, {
      maxPixels: 1_000_000,
    });

    expect(result.replacedCount).toBe(1);
    const blocks = result.contents[0].blocks;
    expect(blocks[0].type).toBe('text');
    expect(textOf(blocks[0])).toContain('dropped');
  });
});

/**
 * The actual known Anthropic many-image dimension error body. The API returns
 * a JSON envelope `{type:'error', error:{type:'invalid_request_error', message}}`
 * which the SDK stores verbatim on `APIError.error`.
 */
const MANY_IMAGE_DIMENSION_BODY = {
  type: 'error',
  error: {
    type: 'invalid_request_error' as const,
    message:
      'At least one of the image dimensions exceed max allowed size for many-image requests: 2000 pixels',
  },
};

const MANY_IMAGE_DIMENSION_MESSAGE = MANY_IMAGE_DIMENSION_BODY.error.message;

/** A real Headers object so SDK `generate()` returns a BadRequestError, not APIConnectionError. */
function sdkHeaders(): Headers {
  return new Headers({ 'request-id': 'req_test' });
}

describe('isAnthropicImageDimensionLimitError (@issue:3216)', () => {
  it('classifies the real SDK-shaped many-image dimension 400', () => {
    // Construct through the real SDK APIError.generate path so the error
    // shape matches production exactly (status, nested error body, message).
    const error = APIError.generate(
      400,
      MANY_IMAGE_DIMENSION_BODY,
      undefined,
      sdkHeaders(),
    );
    expect(isAnthropicImageDimensionLimitError(error)).toBe(true);
  });

  it('classifies a structurally-compatible plain object with the same body shape', () => {
    const error = {
      status: 400,
      error: MANY_IMAGE_DIMENSION_BODY,
    };
    expect(isAnthropicImageDimensionLimitError(error)).toBe(true);
  });

  it('falls back to the top-level message when the SDK variant stores it there', () => {
    // Some SDK variants store the constructed message string on `.message`
    // with the JSON-stringified body. The classifier must still match.
    const error = {
      status: 400,
      error: undefined,
      message: `400 ${JSON.stringify(MANY_IMAGE_DIMENSION_BODY)}`,
    };
    expect(isAnthropicImageDimensionLimitError(error)).toBe(true);
  });

  it('is case/whitespace tolerant for the service wording', () => {
    const error = APIError.generate(
      400,
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            '  at  least  one  of  the  IMAGE  dimensions  EXCEED  max  allowed  size  for  many-image  requests:  2000  pixels  ',
        },
      },
      undefined,
      sdkHeaders(),
    );
    expect(isAnthropicImageDimensionLimitError(error)).toBe(true);
  });

  it('rejects a malformed body (missing inner error)', () => {
    const error = APIError.generate(
      400,
      { type: 'error' },
      undefined,
      sdkHeaders(),
    );
    expect(isAnthropicImageDimensionLimitError(error)).toBe(false);
  });

  it('rejects a malformed body (inner error missing message)', () => {
    const error = APIError.generate(
      400,
      { type: 'error', error: { type: 'invalid_request_error' } },
      undefined,
      sdkHeaders(),
    );
    expect(isAnthropicImageDimensionLimitError(error)).toBe(false);
  });

  it('rejects a 400 invalid_request_error with an unrelated image message', () => {
    // "Image format not supported" mentions image but lacks dimension/many-image semantics
    const error = APIError.generate(
      400,
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'Image format not supported',
        },
      },
      undefined,
      sdkHeaders(),
    );
    expect(isAnthropicImageDimensionLimitError(error)).toBe(false);
  });

  it('rejects a 400 invalid_request_error with an unrelated width/height message', () => {
    // Mentions width/height but lacks image/dimension/many-image semantics
    const error = APIError.generate(
      400,
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'expected width 100 and height 100 but received different values',
        },
      },
      undefined,
      sdkHeaders(),
    );
    expect(isAnthropicImageDimensionLimitError(error)).toBe(false);
  });

  it('rejects a 400 for an unrelated invalid_request_error', () => {
    const error = APIError.generate(
      400,
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'tools.0: extra inputs not permitted',
        },
      },
      undefined,
      sdkHeaders(),
    );
    expect(isAnthropicImageDimensionLimitError(error)).toBe(false);
  });

  it('rejects a 400 with a non-invalid_request_error type', () => {
    const error = APIError.generate(
      400,
      {
        type: 'error',
        error: {
          type: 'authentication_error',
          message: MANY_IMAGE_DIMENSION_MESSAGE,
        },
      },
      undefined,
      sdkHeaders(),
    );
    expect(isAnthropicImageDimensionLimitError(error)).toBe(false);
  });

  it('rejects non-400 errors (429)', () => {
    const error = APIError.generate(
      429,
      {
        type: 'error',
        error: {
          type: 'rate_limit_error',
          message: MANY_IMAGE_DIMENSION_MESSAGE,
        },
      },
      undefined,
      sdkHeaders(),
    );
    expect(isAnthropicImageDimensionLimitError(error)).toBe(false);
  });

  it('rejects non-error values', () => {
    expect(isAnthropicImageDimensionLimitError(null)).toBe(false);
    expect(isAnthropicImageDimensionLimitError('oops')).toBe(false);
    expect(isAnthropicImageDimensionLimitError(undefined)).toBe(false);
  });
});

describe('parseAnthropicImageDimensionLimit (@issue:3216)', () => {
  it('extracts the pixel limit from the real SDK-shaped error', () => {
    const error = APIError.generate(
      400,
      MANY_IMAGE_DIMENSION_BODY,
      undefined,
      sdkHeaders(),
    );
    expect(parseAnthropicImageDimensionLimit(error)).toBe(2000);
  });

  it('extracts the pixel limit from a plain-object error with nested body', () => {
    const error = {
      status: 400,
      error: MANY_IMAGE_DIMENSION_BODY,
    };
    expect(parseAnthropicImageDimensionLimit(error)).toBe(2000);
  });

  it('returns undefined when no pixel limit is stated', () => {
    const error = APIError.generate(
      400,
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'tools.0: extra inputs not permitted',
        },
      },
      undefined,
      sdkHeaders(),
    );
    expect(parseAnthropicImageDimensionLimit(error)).toBeUndefined();
  });
});

describe('resolveRecoveryImageBudget (@issue:3216 H3)', () => {
  it('uses the parsed error limit alone when no budget is configured', () => {
    expect(resolveRecoveryImageBudget(undefined, 2000)).toEqual({
      maxDimension: 2000,
    });
  });

  it('returns undefined when neither a config nor an error limit exists', () => {
    expect(resolveRecoveryImageBudget(undefined, undefined)).toBeUndefined();
  });

  it('retains a pixel-only config and applies the parsed error dimension', () => {
    // A 3000x500 image (1.5M px) is under the 4M pixel cap but its 3000 width
    // exceeds the error-derived 2000 dimension — both must be enforced.
    expect(resolveRecoveryImageBudget({ maxPixels: 4_000_000 }, 2000)).toEqual({
      maxDimension: 2000,
      maxPixels: 4_000_000,
    });
  });

  it('uses the stricter max dimension when the configured one is looser', () => {
    expect(resolveRecoveryImageBudget({ maxDimension: 3000 }, 2000)).toEqual({
      maxDimension: 2000,
    });
  });

  it('uses the stricter max dimension when the configured one is stricter', () => {
    expect(resolveRecoveryImageBudget({ maxDimension: 1500 }, 2000)).toEqual({
      maxDimension: 1500,
    });
  });

  it('merges combined limits keeping configured pixels and stricter dimension', () => {
    expect(
      resolveRecoveryImageBudget(
        { maxDimension: 1500, maxPixels: 2_000_000 },
        2000,
      ),
    ).toEqual({ maxDimension: 1500, maxPixels: 2_000_000 });
  });

  it('keeps the exact boundary when configured dimension equals the error limit', () => {
    expect(resolveRecoveryImageBudget({ maxDimension: 2000 }, 2000)).toEqual({
      maxDimension: 2000,
    });
  });

  it('keeps a pixel-only configured budget when the error limit is missing', () => {
    expect(
      resolveRecoveryImageBudget({ maxPixels: 4_000_000 }, undefined),
    ).toEqual({ maxPixels: 4_000_000 });
  });
});

/**
 * Structural narrowing of the Anthropic request-body message content blocks
 * produced by the neutral→Anthropic conversion. Keeps the tests cast-free
 * while inspecting the actual shapes transport builds.
 */
interface AnthropicImageBlock {
  readonly type: 'image';
  readonly source: {
    readonly type: 'base64';
    readonly media_type: string;
    readonly data: string;
  };
}

interface AnthropicTextBlock {
  readonly type: 'text';
  readonly text: string;
}

interface AnthropicToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly is_error?: boolean;
  readonly content: readonly AnthropicContentBlock[] | string;
}

type AnthropicContentBlock =
  | AnthropicImageBlock
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | { readonly type: string; readonly [key: string]: unknown };

interface AnthropicRequestBodyFixture {
  readonly messages: ReadonlyArray<{
    readonly role: string;
    readonly content: readonly AnthropicContentBlock[];
  }>;
  readonly [key: string]: unknown;
}

function isImageBlock(block: unknown): block is AnthropicImageBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'image'
  );
}

function isTextBlock(block: unknown): block is AnthropicTextBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'text'
  );
}

function isToolResultBlock(block: unknown): block is AnthropicToolResultBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'tool_result'
  );
}

/**
 * Assert the block type and return the narrowed value. Avoids conditional
 * expect calls inside if-blocks (jest/no-conditional-expect).
 * The type assertion is safe because it is guarded by the runtime type guard.
 */
function expectImageBlock(block: AnthropicContentBlock): AnthropicImageBlock {
  expect(isImageBlock(block)).toBe(true);
  return block as AnthropicImageBlock;
}

function expectTextBlock(block: AnthropicContentBlock): AnthropicTextBlock {
  expect(isTextBlock(block)).toBe(true);
  return block as AnthropicTextBlock;
}

function expectToolResultBlock(
  block: AnthropicContentBlock,
): AnthropicToolResultBlock {
  expect(isToolResultBlock(block)).toBe(true);
  return block as AnthropicToolResultBlock;
}

describe('sanitizeAnthropicRequestBodyImages nested tool_result traversal (@issue:3216)', () => {
  it('sanitizes image blocks nested in tool_result.content preserving the wrapper and pairing', async () => {
    const bigNested = await pngBase64(3000, 3000);
    const okNested = await pngBase64(1200, 1200);
    const body: AnthropicRequestBodyFixture = {
      model: 'claude-opus-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'read_file',
              input: { absolute_path: 'big.png' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_123',
              content: [
                { type: 'text', text: 'file content here' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: bigNested,
                  },
                },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: okNested,
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const original = JSON.parse(JSON.stringify(body)) as typeof body;

    const result = sanitizeAnthropicRequestBodyImages(
      body as unknown as Record<string, unknown>,
      { maxDimension: 2000 },
    );

    expect(result.replacedCount).toBe(1);
    const userMessage = result.body['messages'] as typeof body.messages;
    const toolResult = expectToolResultBlock(userMessage[1].content[0]);
    // Wrapper identity preserved: exact pairing and error flag.
    expect(toolResult.tool_use_id).toBe('toolu_123');
    expect(toolResult.is_error).toBeUndefined();
    const nested = toolResult.content as readonly AnthropicContentBlock[];
    // Sibling text preserved, first (oversized) image replaced, valid image
    // retained, ordering intact.
    expect(expectTextBlock(nested[0]).text).toBe('file content here');
    expect(isTextBlock(nested[1])).toBe(true);
    const img2 = expectImageBlock(nested[2]);
    expect(img2.source.data).toBe(okNested);
    // Bytes of the oversized image must be gone from the nested content.
    expect(JSON.stringify(toolResult)).not.toContain(bigNested);
    // Unrelated top-level fields preserved.
    expect(result.body['model']).toBe('claude-opus-5');
    // The input body is NOT mutated at any level.
    expect(body).toEqual(original);
  });

  it('sanitizes multiple nested oversized images across multiple tool_results', async () => {
    const big1 = await pngBase64(3000, 2000);
    const big2 = await pngBase64(2000, 3000);
    const body: AnthropicRequestBodyFixture = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_a',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: big1,
                  },
                },
              ],
            },
            {
              type: 'tool_result',
              tool_use_id: 'toolu_b',
              is_error: false,
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: big2,
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const result = sanitizeAnthropicRequestBodyImages(
      body as unknown as Record<string, unknown>,
      { maxDimension: 2000 },
    );

    expect(result.replacedCount).toBe(2);
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain(big1);
    expect(serialized).not.toContain(big2);
    const userMessage = result.body['messages'] as typeof body.messages;
    const firstToolResult = expectToolResultBlock(userMessage[0].content[0]);
    const secondToolResult = expectToolResultBlock(userMessage[0].content[1]);
    expect(firstToolResult.tool_use_id).toBe('toolu_a');
    expect(secondToolResult.tool_use_id).toBe('toolu_b');
    expect(secondToolResult.is_error).toBe(false);
  });

  it('sanitizes mixed top-level and nested media in the same body', async () => {
    const bigTop = await pngBase64(3000, 1000);
    const bigNested = await pngBase64(1000, 3000);
    const okTop = await pngBase64(1000, 1000);
    const body: AnthropicRequestBodyFixture = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: bigTop,
              },
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: okTop,
              },
            },
            {
              type: 'tool_result',
              tool_use_id: 'toolu_c',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: bigNested,
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const result = sanitizeAnthropicRequestBodyImages(
      body as unknown as Record<string, unknown>,
      { maxDimension: 2000 },
    );

    expect(result.replacedCount).toBe(2);
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain(bigTop);
    expect(serialized).not.toContain(bigNested);
    expect(serialized).toContain(okTop);
  });

  it('keeps a top-level image exactly at the dimension boundary (reactive parity)', async () => {
    const exact = await pngBase64(2000, 2000);
    const body: AnthropicRequestBodyFixture = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: exact,
              },
            },
          ],
        },
      ],
    };

    const result = sanitizeAnthropicRequestBodyImages(
      body as unknown as Record<string, unknown>,
      { maxDimension: 2000 },
    );

    expect(result.replacedCount).toBe(0);
    expect(result.body).toBe(body as unknown as Record<string, unknown>);
  });

  it('replaces a top-level image that only exceeds a pixel-only budget (reactive parity)', async () => {
    // 1200x1200 within the 2000 dimension limit but over a 1M pixel budget.
    const tall = await pngBase64(1200, 1200);
    const body: AnthropicRequestBodyFixture = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: tall,
              },
            },
          ],
        },
      ],
    };

    const result = sanitizeAnthropicRequestBodyImages(
      body as unknown as Record<string, unknown>,
      { maxPixels: 1_000_000 },
    );

    expect(result.replacedCount).toBe(1);
    expect(JSON.stringify(result.body)).not.toContain(tall);
  });

  it('preserves a string tool_result.content untouched and mutates nothing when nothing is oversized', async () => {
    const ok = await pngBase64(1000, 1000);
    const body: AnthropicRequestBodyFixture = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_s',
              content: 'plain text result',
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: ok,
              },
            },
          ],
        },
      ],
    };
    const original = JSON.parse(JSON.stringify(body)) as typeof body;

    const result = sanitizeAnthropicRequestBodyImages(
      body as unknown as Record<string, unknown>,
      { maxDimension: 2000 },
    );

    expect(result.replacedCount).toBe(0);
    // No replacements: the SAME body object is returned (identity).
    expect(result.body).toBe(body as unknown as Record<string, unknown>);
    expect(body).toEqual(original);
  });

  it('is immutable: nested arrays and objects are fresh copies, never the originals', async () => {
    const big = await pngBase64(3000, 3000);
    const body: AnthropicRequestBodyFixture = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_i',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: big,
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const messagesBefore = body.messages;
    const contentBefore = body.messages[0].content;
    const toolResultBefore = contentBefore[0] as AnthropicToolResultBlock;
    const nestedBefore = toolResultBefore.content as readonly unknown[];

    const result = sanitizeAnthropicRequestBodyImages(
      body as unknown as Record<string, unknown>,
      { maxDimension: 2000 },
    );

    expect(result.replacedCount).toBe(1);
    // New containers at every level.
    expect(result.body['messages']).not.toBe(messagesBefore);
    const newMessages = result.body['messages'] as typeof body.messages;
    expect(newMessages[0].content).not.toBe(contentBefore);
    const newToolResult = newMessages[0].content[0] as AnthropicToolResultBlock;
    expect(newToolResult).not.toBe(toolResultBefore);
    expect(newToolResult.content).not.toBe(nestedBefore);
    // Originals untouched.
    expect(isImageBlock(nestedBefore[0])).toBe(true);
    expect(
      isImageBlock(nestedBefore[0]) ? nestedBefore[0].source.data : '',
    ).toBe(big);
  });
});
