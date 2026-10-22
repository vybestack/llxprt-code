/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { gcAndSweep } from 'bun:jsc';
import { setTimeout as sleep } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { JournalSession } from '../../../../core/src/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '../../../../core/src/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '../../../../core/src/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import type { IContent } from '../../../../core/src/services/history/IContent.js';
import {
  multiIdCase,
  multiIdSettings,
} from './support/mistral-multi-id-cases.js';
import { plainChatLengthRegistration } from '../journal-chat-length.js';
import { nativeChatMessages } from '../native-chat-messages.js';

describe('Mistral multi-ID decoded holder lifetime', () => {
  const directory = useTempDir('mistral-multi-retention-');
  it('releases decoded holders while streaming subsequent holders', async () => {
    const input = multiIdCase(40, true, 8);
    const rows = input.rows.map(
      (row, index): IContent => ({
        ...row,
        blocks: [
          ...row.blocks.map((block) =>
            block.type === 'tool_call'
              ? { ...block, parameters: { payload: 'x'.repeat(65536) } }
              : block,
          ),
          { type: 'text', text: `${index}:` + 'x'.repeat(65536) },
        ],
      }),
    );
    const session = await JournalSession.create(
      `${directory()}/retention.llxj`,
      { journal: testJournalSeams({}, 1, false).dependencies },
    );
    try {
      await session.append(rows);
      await session.registerRowFormat(
        plainChatLengthRegistration(multiIdSettings),
      );
      const pin = await session.store.snapshot();
      const request = await IndexedJournalRequestSnapshot.create(
        pin,
        input.tail,
      );
      const refs: Array<WeakRef<IContent>> = [];
      const retained: IContent[] = [];
      let peak = 0;
      async function sample(): Promise<void> {
        await sleep(0);
        gcAndSweep();
        peak = Math.max(
          peak,
          refs.filter((ref) => ref.deref() !== undefined).length,
        );
      }
      async function* watched(): AsyncGenerator<IContent> {
        for await (const row of request.openReader()) {
          refs.push(new WeakRef(row));
          if (process.env.MISTRAL_MULTI_HOLDER_TRAP === 'retain')
            retained.push(row);
          await sample();
          yield row;
        }
      }
      try {
        const resolver = await request.mistralForSnapshot(pin, 0);
        const hash = createHash('sha256');
        let bytes = 0;
        for await (const chunk of nativeChatMessages(
          watched(),
          multiIdSettings,
          'none',
          -1,
          resolver,
        )) {
          hash.update(chunk);
          bytes += chunk.length;
        }
        await sample();
        expect(bytes).toBeGreaterThan(40 * 65536);
        expect(hash.digest('hex')).toHaveLength(64);
        expect(refs.length).toBeGreaterThan(40);
        expect(peak).toBeGreaterThan(0);
        expect(peak).toBeLessThanOrEqual(9);
        expect(retained.length).toBe(0);
        expect(pin.rowWindowStats?.peakRetainedBytes).toBeLessThanOrEqual(
          32768,
        );
        expect(pin.rowWindowStats?.peakTransientBytes).toBeLessThanOrEqual(
          49152,
        );
      } finally {
        await request.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });
});
