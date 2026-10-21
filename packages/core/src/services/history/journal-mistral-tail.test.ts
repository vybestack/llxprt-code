/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { assertMistralTail } from './__tests__/support/mistral-tail-oracle.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { JournalSession } from './journalSession.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import { oldTailUnits } from './__tests__/support/tail-query-oracle.js';
import type { IContent } from './IContent.js';

describe('request-only Mistral observe mappings', () => {
  const directory = useTempDir('mistral-tail-');
  const options = { journal: testJournalSeams().dependencies };

  it('continues native owners and earlier request-only calls across all format slots', async () => {
    const session = await JournalSession.create(
      `${directory()}/slots.llxj`,
      options,
    );
    const rows: readonly IContent[] = [
      { speaker: 'ai', blocks: [call('4SftZvDMX')] },
    ];
    const tail: readonly IContent[] = [
      { speaker: 'human', blocks: [call('4Uq1sY29c', '')] },
      {
        speaker: 'ai',
        blocks: [call('toolu_alpha-1'), call('toolu_alpha-1', 'renamed')],
      },
    ];
    try {
      for (const slot of [0, 1, 2])
        await session.store.commit([{ kind: 'mistral', slot }]);
      await session.append(rows);
      const pin = await session.store.snapshot();
      const request = await IndexedJournalRequestSnapshot.create(pin, tail);
      try {
        for (const slot of [0, 1, 2]) {
          await assertMistralTail(
            request,
            await oldTailUnits(rows, tail),
            slot,
          );
          expect(
            (await request.mistralMapping('toolu_alpha-1', slot))?.salt,
          ).toBe(2);
          expect(
            await pin.mistralMapping('toolu_alpha-1', slot),
          ).toBeUndefined();
        }
      } finally {
        await request.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });

  it('preserves nine-character pass-through collisions and raw-id duplicates', async () => {
    for (const passthroughFirst of [false, true]) {
      const session = await JournalSession.create(
        `${directory()}/pass-${passthroughFirst}.llxj`,
        options,
      );
      const tail: readonly IContent[] = [
        {
          speaker: 'ai',
          blocks: passthroughFirst
            ? [
                call('4SftZvDMX'),
                call('toolu_alpha-1'),
                call('toolu_alpha-1', ''),
              ]
            : [
                call('toolu_alpha-1'),
                call('4SftZvDMX'),
                call('toolu_alpha-1', ''),
              ],
        },
      ];
      try {
        await session.store.commit([{ kind: 'mistral', slot: 0 }]);
        const pin = await session.store.snapshot();
        const request = await IndexedJournalRequestSnapshot.create(pin, tail);
        try {
          await assertMistralTail(request, await oldTailUnits([], tail));
          expect((await request.mistralMapping('toolu_alpha-1', 0))?.salt).toBe(
            passthroughFirst ? 1 : 0,
          );
          expect(await request.mistralMapping('4SftZvDMX', 0)).toStrictEqual({
            id: '4SftZvDMX',
            salt: null,
          });
        } finally {
          await request.close();
          await pin.close();
        }
      } finally {
        await session.close();
      }
    }
  });

  it('reuses the already reconstructed journal mapping instead of pending insertion order', async () => {
    const session = await JournalSession.create(
      `${directory()}/reconstructed.llxj`,
      options,
    );
    const rows: readonly IContent[] = [
      { speaker: 'tool', blocks: [response('toolu_alpha-1')] },
      { speaker: 'ai', blocks: [call('4SftZvDMX')] },
    ];
    const tail: readonly IContent[] = [
      {
        speaker: 'ai',
        blocks: [call('4Uq1sY29c'), call('toolu_alpha-1', 'new name')],
      },
      {
        speaker: 'tool',
        blocks: [{ ...response('toolu_alpha-1'), result: { better: true } }],
      },
    ];
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      await session.append(rows);
      const pin = await session.store.snapshot();
      const request = await IndexedJournalRequestSnapshot.create(pin, tail);
      try {
        await assertMistralTail(request, await oldTailUnits(rows, tail));
        expect(await request.mistralMapping('toolu_alpha-1', 0)).toStrictEqual({
          id: '4SftZvDMX',
          salt: 0,
        });
        expect(await request.readAt(0)).toStrictEqual(
          (await oldTailUnits(rows, tail))[0],
        );
        await session.append([{ speaker: 'ai', blocks: [call('later raw')] }]);
        expect(await request.mistralMapping('toolu_alpha-1', 0)).toStrictEqual({
          id: '4SftZvDMX',
          salt: 0,
        });
      } finally {
        await request.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });

  it('observes reconstructed pending calls before their split self and later duplicate calls', async () => {
    const session = await JournalSession.create(
      `${directory()}/emission.llxj`,
      options,
    );
    const tail: readonly IContent[] = [
      { speaker: 'tool', blocks: [response('toolu_alpha-1')] },
      { speaker: 'tool', blocks: [response('4SftZvDMX'), call('4Uq1sY29c')] },
      { speaker: 'ai', blocks: [call('toolu_alpha-1')] },
    ];
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      const pin = await session.store.snapshot();
      const request = await IndexedJournalRequestSnapshot.create(pin, tail);
      try {
        await assertMistralTail(request, await oldTailUnits([], tail));
        expect((await request.mistralMapping('toolu_alpha-1', 0))?.salt).toBe(
          0,
        );
      } finally {
        await request.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });

  it('refuses inactive and invalid slots rather than treating absent native facts as an empty used set', async () => {
    const session = await JournalSession.create(
      `${directory()}/inactive.llxj`,
      options,
    );
    try {
      await session.append([
        { speaker: 'ai', blocks: [call('toolu_alpha-1')] },
      ]);
      const pin = await session.store.snapshot();
      const request = await IndexedJournalRequestSnapshot.create(pin, [
        { speaker: 'ai', blocks: [call('4SftZvDMX')] },
      ]);
      try {
        await expect(
          request.mistralMapping('toolu_alpha-1', 0),
        ).rejects.toThrow('fill');
        await expect(
          request.mistralMapping('toolu_alpha-1', 3),
        ).rejects.toThrow('slot');
      } finally {
        await request.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });
});
