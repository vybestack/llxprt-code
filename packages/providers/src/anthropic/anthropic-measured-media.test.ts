/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { mediaBlockToAnthropicImage } from './AnthropicHumanMessageConverter.js';
import {
  anthropicWireMedia,
  anthropicWireMediaTurn,
  copyAnthropicWireMedia,
  measurableAnthropicRow,
} from './anthropic-measured-media.js';

describe('request-owned Anthropic media measurements', () => {
  it('keeps turn attribution local when two rows share immutable media', () => {
    const media: MediaBlock = Object.freeze({
      type: 'media',
      mimeType: 'image/png',
      encoding: 'base64',
      data: 'AA==',
    });
    const wireFor = (
      turnId: string,
    ): ReturnType<typeof mediaBlockToAnthropicImage> => {
      const row: IContent = {
        speaker: 'human',
        blocks: [media],
        metadata: { turnId },
      };
      const block = measurableAnthropicRow(row).blocks[0];
      if (block.type !== 'media') throw new Error('Expected media');
      return mediaBlockToAnthropicImage(block);
    };
    const first = wireFor('turn-first');
    const second = wireFor('turn-second');
    expect(anthropicWireMediaTurn(first)).toBe('turn-first');
    expect(anthropicWireMediaTurn(second)).toBe('turn-second');
    expect(anthropicWireMedia(first)).toBe(media);
    expect(JSON.stringify(first)).toBe(
      '{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AA=="}}',
    );
    const copy = { ...first, source: { ...first.source } };
    copyAnthropicWireMedia(first, copy);
    expect(anthropicWireMediaTurn(copy)).toBe('turn-first');
  });
});
