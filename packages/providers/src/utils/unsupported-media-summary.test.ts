/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { statefulUnsupportedMedia } from '../openai-responses/native-responses-selection.js';
import { UnsupportedMediaSummary } from './unsupported-media-summary.js';

const row: IContent = {
  speaker: 'human',
  blocks: [
    { type: 'media', mimeType: 'audio/wav', encoding: 'base64', data: 'AA==' },
  ],
};

function assertBounded(entries: readonly unknown[]): void {
  expect(entries.length).toBeLessThanOrEqual(9);
}

describe('unsupported media reporting bounds', () => {
  it.each([100, 10000])(
    'retains a fixed sample over %s selected rows',
    async (count) => {
      const entries = await statefulUnsupportedMedia(
        {
          count,
          readAt: async () => row,
          async *openReader() {
            for (let index = 0; index < count; index++) yield row;
          },
        },
        0,
        false,
      );
      assertBounded(entries);
      expect(entries).toHaveLength(9);
      expect(entries[8]?.reason).toContain(`audio=${count}`);
    },
  );

  it('counts every category without retaining every descriptor', () => {
    const summary = new UnsupportedMediaSummary();
    for (let index = 0; index < 10000; index++) {
      summary.add({
        kind: 'unsupported',
        mediaType: index % 2 === 0 ? 'audio' : 'video',
        reason: 'placeholder',
      });
    }
    assertBounded(summary.entries());
    expect(summary.entries()[8]?.reason).toContain('audio=5000');
    expect(summary.entries()[8]?.reason).toContain('video=5000');
  });

  it('rejects the collecting control with the same count predicate', () => {
    const collected = Array.from({ length: 100 }, () => ({
      kind: 'unsupported',
    }));
    expect(() => assertBounded(collected)).toThrow(Error);
  });
});
