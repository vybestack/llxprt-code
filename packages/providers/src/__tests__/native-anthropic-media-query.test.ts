/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import type { RowEntry } from '@vybestack/llxprt-code-core/journal/rowEntry.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { journalSendFixture } from './support/journal-send-fixture.js';

function* rows(media: boolean): Generator<IContent> {
  for (let index = 0; index < 128; index++)
    yield {
      speaker: 'human',
      blocks: [{ type: 'text', text: `row ${index}` }],
    };
  if (media)
    yield {
      speaker: 'human',
      blocks: [
        { type: 'media', mimeType: 'audio/wav', encoding: 'base64', data: '' },
      ],
    };
}

describe('Anthropic persisted media routing facts', () => {
  it.each([false, true])(
    'detects media=%s without visiting descriptors',
    async (media) => {
      const fixture = await journalSendFixture(rows(media), [], {
        directory: `${import.meta.dir}/../../../../tmp/anthropic-tail/media-query`,
        oneRowAtATime: true,
      });
      const entries = VersionSnapshot.prototype.entries;
      let visited = 0;
      const observation = spyOn(
        VersionSnapshot.prototype,
        'entries',
      ).mockImplementation(async function* (
        this: VersionSnapshot,
        from = 0,
      ): AsyncGenerator<RowEntry> {
        for await (const entry of entries.call(this, from)) {
          visited++;
          yield entry;
        }
      });
      try {
        const query = fixture.selection.native?.indexed;
        if (query === undefined) throw new Error('Missing journal query');
        expect(await query.hasPersistedMedia()).toBe(media);
        expect(await query.hasPersistedMedia()).toBe(media);
        expect(visited).toBe(0);
      } finally {
        observation.mockRestore();
        await fixture.close();
      }
    },
  );
});
