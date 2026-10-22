/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { VersionSnapshot } from '../../../../core/src/journal/versionSnapshot.js';
import type { IContent } from '../../../../core/src/services/history/IContent.js';
import { JournalSession } from '../../../../core/src/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '../../../../core/src/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '../../../../core/src/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { oldTailUnits } from '../../../../core/src/services/history/__tests__/support/tail-query-oracle.js';
import {
  multiIdCase,
  multiIdSettings as settings,
} from './support/mistral-multi-id-cases.js';
import {
  plainChatLengthRegistration,
  planRequestChatMessages,
} from '../journal-chat-length.js';
import { nativeChatMessages } from '../native-chat-messages.js';
import { buildMessagesWithReasoning } from '../OpenAIRequestBuilder.js';
import {
  legacyUnitTokens,
  oldMistralUnitTokens,
} from './support/mistral-unit-token-oracle.js';

async function check(
  pin: VersionSnapshot,
  rows: readonly IContent[],
  tail: readonly IContent[],
): Promise<void> {
  const request = await IndexedJournalRequestSnapshot.create(pin, tail);
  try {
    const units = await oldTailUnits(rows, tail);
    const plan = await planRequestChatMessages(
      pin,
      request,
      settings,
      0,
      '',
      legacyUnitTokens,
    );
    const resolver = await request.mistralForSnapshot(pin, 0);
    const chunks: Uint8Array[] = [
      Buffer.from('[{"role":"system","content":""}'),
    ];
    for await (const chunk of nativeChatMessages(
      request.openReader(),
      settings,
      'none',
      plan.lastThinking,
      resolver,
    ))
      chunks.push(chunk);
    chunks.push(Buffer.from(']'));
    const expected = Buffer.from(
      JSON.stringify([
        { role: 'system', content: '' },
        ...buildMessagesWithReasoning(
          [...units],
          {
            invocation: { ephemerals: { 'reasoning.includeInContext': true } },
          },
          'mistral',
          undefined,
        ),
      ]),
    );
    expect(Buffer.concat(chunks)).toStrictEqual(expected);
    expect(plan.bytes).toBe(expected.length);
    expect(plan.tokens).toBe(await oldMistralUnitTokens(units, 'none'));
  } finally {
    await request.close();
  }
}
async function checkMappings(
  old: VersionSnapshot,
  current: VersionSnapshot,
  ids: readonly string[],
  tail: readonly IContent[],
): Promise<void> {
  for (const id of ids) {
    expect((await old.mistralMapping(id, 0))?.salt).toBe(1);
    expect((await current.mistralMapping(id, 0))?.salt).toBe(0);
  }
  const request = await IndexedJournalRequestSnapshot.create(current, tail);
  try {
    await request.withMistral(0, async (view) => {
      const paused = view.affectedSources();
      await paused.next();
      await paused.return(undefined);
      const expected = await current.mistralMapping(ids[0], 0);
      if (expected === undefined)
        throw new Error('Missing current Mistral mapping');
      expect(await view.resolve(ids[0])).toStrictEqual(expected);
    });
  } finally {
    await request.close();
  }
}

describe('Mistral multi-ID old and current pins', () => {
  const directory = useTempDir('mistral-multi-pins-');
  it('removes first holders in two collision groups while old pending mappings remain pinned', async () => {
    const input = multiIdCase(12, true);
    const session = await JournalSession.create(`${directory()}/pins.llxj`, {
      journal: testJournalSeams({}, 1, false).dependencies,
    });
    try {
      await session.append(input.rows);
      await session.registerRowFormat(
        plainChatLengthRegistration(settings, legacyUnitTokens),
      );
      const old = await session.store.snapshot();
      try {
        const removed = [
          (await old.entryAt(0)).label,
          (await old.entryAt(1)).label,
        ];
        expect(removed).toHaveLength(2);
        await check(old, input.rows, input.tail);
        await session.store.commit([
          { kind: 'density', removed, replacements: [] },
        ]);
        const current = await session.store.snapshot();
        try {
          await check(current, input.rows.slice(2), input.tail);
          await check(old, input.rows, input.tail);
          await checkMappings(old, current, input.ids, input.tail);
        } finally {
          await current.close();
        }
      } finally {
        await old.close();
      }
    } finally {
      await session.close();
    }
  });
});
