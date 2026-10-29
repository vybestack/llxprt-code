/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { AnthropicRepairIndex } from './anthropic-repair-index.js';
import { AnthropicStreamRepair } from './anthropic-stream-repair.js';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';

const settings: RowFormatSettings = {
  formatId: 'anthropic',
  formatRev: 1,
  model: 'claude-sonnet-4',
  endpoint: '',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: true,
  unsupportedMedia: 'notice',
  outputLimits: null,
  anthropic: { cache: 'off', imageBudget: null },
};

async function cachedTexts(engine: AnthropicStreamRepair): Promise<string[]> {
  const seen: string[] = [];
  for await (const entry of engine.cacheBlocks()) {
    expect(entry.block.type).toBe('text');
    if (entry.block.type === 'text') seen.push(entry.block.text);
  }
  return seen;
}

describe('Anthropic unmerged run discovery', () => {
  const directory = useTempDir('anthropic-run-cost-');
  it.each([40, 400])('discovers %s cached message runs once', async (count) => {
    const rows: IContent[] = Array.from({ length: count }, (_, index) => ({
      speaker: index % 2 === 0 ? 'human' : 'ai',
      blocks: [{ type: 'text', text: `row ${index}` }],
    }));
    const session = await JournalSession.create(`${directory()}/${count}.llxj`);
    try {
      await session.append(rows);
      await session.store.commit([
        { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
      ]);
      const pin = await session.store.snapshot();
      const query = await IndexedJournalRequestSnapshot.create(pin);
      const original = AnthropicRepairIndex.prototype.message;
      let messages = 0;
      try {
        const engine = await AnthropicStreamRepair.create(query, settings);
        AnthropicRepairIndex.prototype.message = function (...args) {
          messages++;
          return original.call(this, ...args);
        };
        const seen = await cachedTexts(engine);
        expect(seen).toStrictEqual(rows.map((_, index) => `row ${index}`));
        expect(messages).toBeLessThanOrEqual(
          count + Math.ceil(Math.log2(count + 1)),
        );
      } finally {
        AnthropicRepairIndex.prototype.message = original;
        await query.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });
});
