/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  createInMemoryToolIdStore,
  type ToolIdStore,
} from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { JournalSession } from '../../../../core/src/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '../../../../core/src/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '../../../../core/src/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import {
  call,
  response,
  unitCase,
} from '../../../../core/src/services/history/__tests__/support/normalization-cases.js';
import { oldTailUnits } from '../../../../core/src/services/history/__tests__/support/tail-query-oracle.js';
import { encodeContentRow } from '../../../../core/src/services/history/journalRowCodec.js';
import { streamChatMessages } from '../OpenAIChatBodyBuilder.js';

async function requestMappings(
  indexed: IndexedJournalRequestSnapshot,
  units: readonly IContent[],
): Promise<ReadonlyMap<string, string>> {
  const ids = new Set(
    units.flatMap((unit) =>
      unit.blocks.flatMap((block) => {
        if (block.type === 'tool_call') return [block.id];
        return block.type === 'tool_response' ? [block.callId] : [];
      }),
    ),
  );
  const mappings = new Map<string, string>();
  for (const id of ids) {
    const mapped = await indexed.kimiMappedId(id);
    if (mapped !== undefined) mappings.set(id, mapped);
  }
  return mappings;
}

async function convert(
  rows: () => AsyncIterable<IContent>,
  toolIdStore: ToolIdStore = createInMemoryToolIdStore(),
): Promise<readonly unknown[]> {
  const messages: unknown[] = [];
  for await (const message of streamChatMessages(
    { rows },
    {
      toolFormat: 'kimi',
      toolIdStore,
      reasoning: { invocation: { ephemerals: {} } },
    },
  ))
    messages.push(
      message.kind === 'tool-media'
        ? { kind: message.kind, parts: [...message.parts()] }
        : message,
    );
  return messages;
}

describe('request Kimi mappings against actual chat conversion', () => {
  const directory = useTempDir('kimi-tail-wire-');
  it('matches all emitted messages including fallback consumption and dropped non-AI outputs', async () => {
    const session = await JournalSession.create(`${directory()}/wire.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    const cases: ReadonlyArray<{
      readonly rows: readonly IContent[];
      readonly tail: readonly IContent[];
    }> = [
      {
        rows: [
          { speaker: 'ai', blocks: [call('x', 'first')] },
          { speaker: 'ai', blocks: [call('x', 'second')] },
          { speaker: 'human', blocks: [call('h')] },
        ],
        tail: [
          { speaker: 'human', blocks: [call('x', 'changed')] },
          {
            speaker: 'ai',
            blocks: [
              { type: 'text', text: 'keep' },
              call('u', ''),
              call(''),
              call('call_'),
            ],
          },
        ],
      },
      {
        rows: [
          {
            speaker: 'tool',
            blocks: [response('r'), { ...response('r'), toolName: 'later' }],
          },
        ],
        tail: [
          { speaker: 'tool', blocks: [{ ...response('n'), toolName: '' }] },
        ],
      },
      {
        rows: Array.from(
          { length: 101 },
          (_, index): IContent => ({
            speaker: 'ai',
            blocks: [call(`id-${index}`)],
          }),
        ),
        tail: [
          {
            speaker: 'ai',
            blocks: [
              call('id-9', 'nine'),
              call('id-10', 'ten'),
              call('id-99', 'ninetynine'),
              call('id-100', ''),
            ],
          },
        ],
      },
      ...Array.from({ length: 120 }, (_, seed) => unitCase(seed)),
    ];
    try {
      await session.store.commit([{ kind: 'kimi' }]);
      for (const input of cases) {
        await session.store.commit([
          {
            kind: 'replace',
            rows: input.rows.map((row) => encodeContentRow(row, { owner: 0 })),
          },
        ]);
        const independent = await oldTailUnits(input.rows, input.tail);
        const expected = await convert(
          async function* (): AsyncGenerator<IContent> {
            yield* independent;
          },
        );
        const pin = await session.store.snapshot();
        const indexed = await IndexedJournalRequestSnapshot.create(
          pin,
          input.tail,
        );
        try {
          const mappings = await requestMappings(indexed, independent);
          let observedEligible = 0;
          const store: ToolIdStore = {
            getMappedId: (id) => mappings.get(id),
            setMappedId: () => {
              observedEligible++;
            },
            isUsed: () => false,
            markUsed: () => {},
          };
          const actual = await convert(() => indexed.openReader(), store);
          expect(actual).toStrictEqual(expected);
          expect(observedEligible).toBe(await indexed.kimiEligibleCount());
        } finally {
          await indexed.close();
          await pin.close();
        }
      }
    } finally {
      await session.close();
    }
  });
});
