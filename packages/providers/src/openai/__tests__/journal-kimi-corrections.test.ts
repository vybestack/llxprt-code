/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  createInMemoryToolIdStore,
  type ToolIdStore,
} from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { testJournalSeams } from '../../../../core/src/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import {
  call,
  response,
  unitCase,
} from '../../../../core/src/services/history/__tests__/support/normalization-cases.js';
import { prepareProviderContentSnapshot } from '../../../../core/src/services/history/provider-curated-stream.js';
import { isCuratedContent } from '../../../../core/src/services/history/historyCuration.js';
import { encodeContentRow } from '../../../../core/src/services/history/journalRowCodec.js';
import {
  streamChatMessages,
  type ChatMessageItem,
} from '../OpenAIChatBodyBuilder.js';

function writtenIds(item: ChatMessageItem): string[] {
  if (item.kind !== 'message') return [];
  if (item.message.role === 'assistant')
    return (item.message.tool_calls ?? []).map((call) => call.id);
  return item.message.role === 'tool' ? [item.message.tool_call_id] : [];
}

interface WireFacts {
  readonly eligible: number;
  readonly unmapped: number;
  readonly written: number;
  readonly mappedDigits: number;
}

async function actualConversion(units: IContent[]): Promise<WireFacts> {
  const base = createInMemoryToolIdStore();
  let eligible = 0;
  let unmapped = 0;
  const store: ToolIdStore = {
    getMappedId: (id) => {
      const mapped = base.getMappedId(id);
      if (mapped === undefined) unmapped++;
      return mapped;
    },
    setMappedId: (id, mapped) => {
      eligible++;
      base.setMappedId(id, mapped);
    },
    isUsed: (id) => base.isUsed(id),
    markUsed: (id) => base.markUsed(id),
  };
  const ids: string[] = [];
  for await (const item of streamChatMessages(
    {
      async *rows(): AsyncGenerator<IContent> {
        yield* units;
      },
    },
    {
      toolFormat: 'kimi',
      toolIdStore: store,
      reasoning: { invocation: { ephemerals: {} } },
    },
  )) {
    ids.push(...writtenIds(item));
  }
  const ordinals = ids.map((id) => Number(id.slice(id.lastIndexOf(':') + 1)));
  return {
    eligible,
    unmapped,
    written: ids.length,
    mappedDigits: ordinals
      .filter((ordinal) => ordinal < eligible)
      .reduce((sum, ordinal) => sum + String(ordinal).length, 0),
  };
}

async function conversionFacts(
  session: JournalSession,
  rows: readonly IContent[],
): Promise<{ readonly expected: WireFacts; readonly persisted: WireFacts }> {
  async function* source(): AsyncGenerator<IContent> {
    yield* rows.filter(isCuratedContent);
  }
  const normalized = await prepareProviderContentSnapshot(
    source(),
    [],
    new DebugLogger('kimi-wire-oracle'),
  );
  try {
    const units: IContent[] = [];
    for await (const unit of normalized.openReader()) units.push(unit);
    const actual = await actualConversion(units);
    const snapshot = await session.store.snapshot();
    try {
      const ids = new Set(
        units.flatMap((unit) =>
          unit.blocks.flatMap((block) =>
            block.type === 'tool_call' ? [block.id] : [],
          ),
        ),
      );
      let written = 0;
      for (const id of ids)
        written += (await snapshot.kimiIdFact(id))?.writtenUses ?? 0;
      const base = Array.from(
        { length: actual.eligible },
        (_, ordinal) => 2 * String(ordinal).length,
      ).reduce((sum, digits) => sum + digits, 0);
      return {
        expected: actual,
        persisted: {
          eligible: await snapshot.kimiEligibleCount(),
          unmapped: await snapshot.kimiUnmappedCount(),
          written,
          mappedDigits: base + (await snapshot.kimiDigitCorrection()),
        },
      };
    } finally {
      await snapshot.close();
    }
  } finally {
    await normalized.close();
  }
}

describe('native Kimi corrections against actual chat conversion', () => {
  const directory = useTempDir('kimi-wire-corrections-');
  it('matches converter written uses, dropped fallback responses and mapped digits over collisions and ordinal boundaries', async () => {
    const session = await JournalSession.create(`${directory()}/wire.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    const cases: ReadonlyArray<readonly IContent[]> = [
      [{ speaker: 'tool', blocks: [{ ...response('x'), toolName: '' }] }],
      [
        { speaker: 'human', blocks: [{ type: 'text', text: 'q' }, call('x')] },
        { speaker: 'tool', blocks: [response('x')] },
        { speaker: 'ai', blocks: [call('other')] },
      ],
      [
        {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: 'keep' },
            call('x', ''),
            call(''),
            call('call_'),
          ],
        },
      ],
      [
        {
          speaker: 'tool',
          blocks: [response('x'), { ...response('x'), toolName: 'later' }],
        },
        { speaker: 'ai', blocks: [call('x', '')] },
      ],
      [
        ...Array.from(
          { length: 101 },
          (_, index): IContent => ({
            speaker: 'ai',
            blocks: [call(`id-${index}`)],
          }),
        ),
        { speaker: 'ai', blocks: [call('id-9', 'longer'), call('id-99', '')] },
      ],
      ...Array.from({ length: 120 }, (_, seed) => {
        const input = unitCase(seed);
        return [...input.rows, ...input.tail];
      }),
    ];
    try {
      await session.store.commit([{ kind: 'kimi' }]);
      for (const rows of cases) {
        await session.store.commit([
          {
            kind: 'replace',
            rows: rows.map((row) => encodeContentRow(row, { owner: 0 })),
          },
        ]);
        const facts = await conversionFacts(session, rows);
        expect(facts.persisted).toStrictEqual(facts.expected);
      }
    } finally {
      await session.close();
    }
  });
});
