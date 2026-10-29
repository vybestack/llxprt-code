/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { encodeContentRow } from './journalRowCodec.js';
import type { IContent, TextBlock } from './IContent.js';
import { promptTextSource } from './prompt-text-source.js';

async function recordLargePrompt(retain: boolean): Promise<number> {
  return withNativeDetachedFixture(async ({ history, primaryRows }) => {
    const text = 'quote " backslash \\ newline\n moon 🌙 lone \ud800 '.repeat(
      65536,
    );
    const content: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text }],
    };
    const encode = TextEncoder.prototype.encode;
    const trap = spyOn(TextEncoder.prototype, 'encode').mockImplementation(
      function (this: TextEncoder, input?: string): Uint8Array {
        if ((input?.length ?? 0) > 65536)
          throw new Error('Retained complete prompt encoding');
        return encode.call(this, input);
      },
    );
    try {
      if (retain) encodeContentRow(content, { owner: 0 });
      await history.submitPrompt('large-prompt', [content]);
    } finally {
      trap.mockRestore();
    }
    expect(await history.hasPromptSubmission('large-prompt')).toBe(true);
    const rows = await Array.fromAsync(history.streamRawHistory());
    const mirrored = await Array.fromAsync(primaryRows());
    expect(rows).toStrictEqual(mirrored);
    expect(rows[0].blocks).toStrictEqual([{ type: 'text', text }]);
    return rows.length;
  });
}

describe('large prompt publication byte sources', () => {
  it('preserves JSON bytes, property order and surrogate pairs at source boundaries', async () => {
    const block: TextBlock = {
      text:
        'x'.repeat(8191) + String.fromCharCode(0xd83c, 0xdf19, 0xd800, 10, 34),
      providerMetadata: { marker: 2 },
      type: 'text',
    };
    const source = promptTextSource(block).source;
    if (source === undefined) throw new Error('Missing prompt byte source');
    const chunks = await Array.fromAsync(source.chunks);
    expect(
      Math.max(...chunks.map((chunk) => chunk.length)),
    ).toBeLessThanOrEqual(65536);
    const bytes = Buffer.concat(chunks);
    expect(bytes.length).toBe(source.length);
    expect(bytes.toString('utf8')).toBe(JSON.stringify(block));
  });
  it('rolls back the large prompt and receipt if a later submission row is invalid', async () => {
    await withNativeDetachedFixture(async ({ history, primaryRows }) => {
      await expect(
        history.submitPrompt('failed-prompt', [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'expanded'.repeat(524288) }],
          },
          { speaker: 'human', blocks: [] },
        ]),
      ).rejects.toThrow('content has no blocks');
      expect(history.length()).toBe(0);
      expect(await history.hasPromptSubmission('failed-prompt')).toBe(false);
      expect(await Array.fromAsync(primaryRows())).toStrictEqual([]);
    });
  });
  it('publishes a multi-MB expanded prompt without a complete encoded copy', async () => {
    expect(await recordLargePrompt(false)).toBe(1);
  });
  it('rejects the contiguous retaining encoder under the same trap', async () => {
    await expect(recordLargePrompt(true)).rejects.toThrow(
      'Retained complete prompt encoding',
    );
  });
});
