/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { journalSendFixture } from '../__tests__/support/journal-send-fixture.js';
import { statefulUnsupportedMedia } from './native-responses-selection.js';
import { ResponsesMediaBudget } from './responses-row-media.js';

const toolRows: readonly IContent[] = [
  {
    speaker: 'ai',
    blocks: [{ type: 'tool_call', id: 'call_1', name: 'read', parameters: {} }],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call_1',
        toolName: 'read',
        result: 'large tool payload',
      },
    ],
  },
];
const audio: IContent = {
  speaker: 'human',
  blocks: [
    { type: 'media', mimeType: 'audio/wav', encoding: 'base64', data: 'AQID' },
  ],
};

describe('Responses unsupported-media discovery', () => {
  it('uses journal media facts without opening payload plans when no source contains media', async () => {
    const fixture = await journalSendFixture(toolRows);
    const indexed = fixture.selection.native?.indexed;
    if (indexed === undefined) throw new Error('Missing native index');
    const original = indexed.planAt;
    indexed.planAt = async () => {
      throw new Error('Media-free history decoded a payload plan');
    };
    try {
      expect(
        await statefulUnsupportedMedia(fixture.selection, 0, false),
      ).toStrictEqual([]);
    } finally {
      indexed.planAt = original;
      await fixture.close();
    }
  });

  for (const pending of [false, true]) {
    it(`validates aggregate ${pending ? 'pending' : 'persisted'} media budget while discovering descriptors`, async () => {
      const second = { ...audio, metadata: { turnId: 'second-media-turn' } };
      const fixture = await journalSendFixture(
        pending ? [audio] : [audio, second],
        pending ? [second] : [],
      );
      try {
        await expect(
          statefulUnsupportedMedia(
            fixture.selection,
            0,
            false,
            new ResponsesMediaBudget(7),
          ),
        ).rejects.toThrow('second-media-turn');
        expect(
          await statefulUnsupportedMedia(
            fixture.selection,
            1,
            false,
            new ResponsesMediaBudget(4),
          ),
        ).toHaveLength(1);
      } finally {
        await fixture.close();
      }
    });
    it(`finds unsupported ${pending ? 'pending' : 'persisted'} media alongside tool rows`, async () => {
      const fixture = await journalSendFixture(
        pending ? toolRows : [...toolRows, audio],
        pending ? [audio] : [],
      );
      try {
        expect(
          await statefulUnsupportedMedia(fixture.selection, 0, false),
        ).toStrictEqual([
          {
            kind: 'unsupported',
            mediaType: 'audio',
            reason:
              'audio input is not supported by this protocol and was replaced with a text placeholder',
          },
        ]);
      } finally {
        await fixture.close();
      }
    });
  }
});
