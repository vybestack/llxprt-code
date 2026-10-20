/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { getToolIdStrategy } from '@vybestack/llxprt-code-tools';
import { DebugLogger } from '../../debug/index.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { OffsetAudit } from '../../journal/__tests__/support/offsetAudit.js';
import { sha256KeyHash, ID_NS, fact0Key } from '../../journal/idKeys.js';
import { JournalSession } from './journalSession.js';
import { encodeContentRow } from './journalRowCodec.js';
import { prepareProviderContentSnapshot } from './provider-curated-stream.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import type { IContent } from './IContent.js';

function mappingForUnits(units: IContent[]): ReadonlyMap<string, string> {
  const mapper = getToolIdStrategy('mistral').createMapper(units);
  const result = new Map<string, string>();
  for (const row of units) {
    for (const block of row.blocks) {
      if (block.type === 'tool_call' && block.id !== '')
        result.set(block.id, mapper.resolveToolCallId(block));
    }
  }
  return result;
}

async function auditMappings(session: JournalSession): Promise<void> {
  const read = await session.store.openRead();
  try {
    if (read.version === undefined) throw new Error('Missing copied version');
    const audit = new OffsetAudit(read.access);
    await audit.walkVersion(read.version);
    expect(
      [...audit.checked.keys()].map(
        (field) => `${field.record}.${field.field}`,
      ),
    ).toContain('IdFact.mappedRef');
  } finally {
    await read.close();
  }
}

async function reference(
  rows: readonly IContent[],
): Promise<ReadonlyMap<string, string>> {
  async function* source(): AsyncGenerator<IContent> {
    yield* rows;
  }
  const normalized = await prepareProviderContentSnapshot(
    source(),
    [],
    new DebugLogger('mistral-reference'),
  );
  try {
    const units: IContent[] = [];
    for await (const row of normalized.openReader()) units.push(row);
    return mappingForUnits(units);
  } finally {
    normalized.close();
  }
}

async function assertMapping(
  session: JournalSession,
  rows: readonly IContent[],
  slot = 0,
): Promise<void> {
  const expected = await reference(rows);
  const snapshot = await session.store.snapshot();
  try {
    for (const [id, mappedId] of expected) {
      const mapping = await snapshot.mistralMapping(id, slot);
      expect(mapping?.id).toBe(mappedId);
      expect(
        mapping?.salt === null || Number.isSafeInteger(mapping?.salt),
      ).toBe(true);
      expect(await snapshot.facts.mistralUsedBy(slot, mappedId)).toBeDefined();
      expect((await snapshot.facts.fact(id))?.mappedRef).toBeGreaterThan(0);
    }
    expect(await snapshot.mistralMapping('', slot)).toBeUndefined();
  } finally {
    await snapshot.close();
  }
}

describe('native Mistral mapping bookkeeping', () => {
  const directory = useTempDir('native-mistral-mapping-');
  const options = { journal: testJournalSeams().dependencies };

  it('assigns raw calls and reconstructed calls in observed unit order and preserves unnamed duplicates', async () => {
    const rows: readonly IContent[] = [
      {
        speaker: 'tool',
        blocks: [response('toolu_alpha-1'), response('toolu_alpha-1')],
      },
      { speaker: 'human', blocks: [call('call_')] },
      {
        speaker: 'ai',
        blocks: [call('toolu_alpha-1', ''), call(''), call('abcdefghi')],
      },
    ];
    const session = await JournalSession.create(
      `${directory()}/order.llxj`,
      options,
    );
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      for (const row of rows) await session.append([row]);
      await assertMapping(session, rows);
      const snapshot = await session.store.snapshot();
      try {
        expect(await snapshot.mistralMapping('toolu_alpha-1', 0)).toStrictEqual(
          { id: '4SftZvDMX', salt: 0 },
        );
        expect(await snapshot.mistralMapping('abcdefghi', 0)).toStrictEqual({
          id: 'abcdefghi',
          salt: null,
        });
        expect(
          await snapshot.facts.mistralUsedBy(1, 'abcdefghi'),
        ).toBeUndefined();
        expect(
          await snapshot.facts.mistralUsedBy(0, '4SftZvDMX'),
        ).toStrictEqual(sha256KeyHash(ID_NS.fact, fact0Key('toolu_alpha-1')));
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });

  it('reassigns the retained raw id after its first collision holder is removed', async () => {
    const rows: readonly IContent[] = [
      { speaker: 'ai', blocks: [call('4SftZvDMX')] },
      { speaker: 'ai', blocks: [call('toolu_alpha-1')] },
    ];
    const session = await JournalSession.create(
      `${directory()}/collision.llxj`,
      options,
    );
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      await session.append(rows);
      const old = await session.store.snapshot();
      try {
        expect(await old.mistralMapping('toolu_alpha-1', 0)).toStrictEqual({
          id: '4Uq1sY29c',
          salt: 1,
        });
        await session.store.commit([
          { kind: 'density', replacements: [], removed: [1048576n] },
        ]);
        await assertMapping(session, rows.slice(1));
        const current = await session.store.snapshot();
        try {
          expect(
            await current.mistralMapping('toolu_alpha-1', 0),
          ).toStrictEqual({ id: '4SftZvDMX', salt: 0 });
          expect(
            await current.facts.mistralUsedBy(0, '4Uq1sY29c'),
          ).toBeUndefined();
        } finally {
          await current.close();
        }
        expect(await old.mistralMapping('toolu_alpha-1', 0)).toStrictEqual({
          id: '4Uq1sY29c',
          salt: 1,
        });
      } finally {
        await old.close();
      }
    } finally {
      await session.close();
    }
  });

  it('restores mappings on pop and rebuilds a middle insertion rather than keeping stale salts', async () => {
    const session = await JournalSession.create(
      `${directory()}/pop.llxj`,
      options,
    );
    const row: IContent = { speaker: 'ai', blocks: [call('toolu_alpha-1')] };
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      await session.append([row]);
      await session.append([
        { speaker: 'ai', blocks: [call('second long id')] },
      ]);
      await session.store.commit([
        { kind: 'pop', cutLabel: 2097152n, expectedRemoved: 1 },
      ]);
      const popped = await session.store.snapshot();
      try {
        expect(
          await popped.mistralMapping('second long id', 0),
        ).toBeUndefined();
      } finally {
        await popped.close();
      }
      const inserted: IContent = { speaker: 'ai', blocks: [call('4SftZvDMX')] };
      await session.store.commit([
        {
          kind: 'insert',
          afterLabel: 0n,
          draft: encodeContentRow(inserted, { owner: 0 }),
        },
      ]);
      await assertMapping(session, [inserted, row]);
    } finally {
      await session.close();
    }
  });

  it('copies raw-bound mapping values through fork and compaction and keeps them after owner changes', async () => {
    const session = await JournalSession.create(
      `${directory()}/copy.llxj`,
      options,
    );
    const rows: readonly IContent[] = [
      { speaker: 'ai', blocks: [call('4SftZvDMX'), call('toolu_alpha-1')] },
    ];
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      await session.append(rows);
      await session.store.commit([
        { kind: 'owner', changes: [{ label: 1048576n, owner: 7 }] },
      ]);
      const clone = await session.cloneUnlinked({
        unlinkedDirectory: directory(),
      });
      try {
        await assertMapping(clone, rows);
        expect(await clone.store.compact()).toBe('swapped');
        await assertMapping(clone, rows);
        await auditMappings(clone);
        const snapshot = await clone.store.snapshot();
        await snapshot.close();
        await expect(
          snapshot.mistralMapping('toolu_alpha-1', 0),
        ).rejects.toThrow('pin was released');
      } finally {
        await clone.close();
      }
    } finally {
      await session.close();
    }
  });

  it('preserves the pass-through collision policy of the current converter', async () => {
    const rows: readonly IContent[] = [
      { speaker: 'ai', blocks: [call('toolu_alpha-1'), call('4SftZvDMX')] },
    ];
    const session = await JournalSession.create(
      `${directory()}/passthrough.llxj`,
      options,
    );
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      await session.append(rows);
      await assertMapping(session, rows);
      const snapshot = await session.store.snapshot();
      try {
        expect((await snapshot.mistralMapping('toolu_alpha-1', 0))?.id).toBe(
          (await snapshot.mistralMapping('4SftZvDMX', 0))?.id,
        );
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });
});
