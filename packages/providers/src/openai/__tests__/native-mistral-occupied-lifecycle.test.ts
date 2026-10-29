/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '../../../../core/src/services/history/journalSession.js';
import type { VersionSnapshot } from '../../../../core/src/journal/versionSnapshot.js';
import type { RowFormatSettings } from '../../../../core/src/journal/rowFormat.js';
import type { IContent } from '../../../../core/src/services/history/IContent.js';
import { IndexedJournalRequestSnapshot } from '../../../../core/src/services/history/indexed-journal-request-snapshot.js';
import { requestFormatSlot } from '../../../../core/src/services/history/native-provider-format.js';
import { testJournalSeams } from '../../../../core/src/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { OffsetAudit } from '../../../../core/src/journal/__tests__/support/offsetAudit.js';
import {
  call,
  response,
} from '../../../../core/src/services/history/__tests__/support/normalization-cases.js';
import { oldTailUnits } from '../../../../core/src/services/history/__tests__/support/tail-query-oracle.js';
import {
  plainChatLengthRegistration,
  planRequestChatMessages,
  PLAIN_CHAT_FORMAT_REV,
} from '../journal-chat-length.js';
import { nativeChatMessages } from '../native-chat-messages.js';
import { mistralRowIds } from '../native-mistral-row.js';
import { buildMessagesWithReasoning } from '../OpenAIRequestBuilder.js';
import {
  anthropicLengthRegistration,
  planStoredAnthropicRequest,
} from '../../anthropic/journal-anthropic-length.js';
import { anthropicRepairFactIndex } from '../../anthropic/anthropic-repair-fact-writer.js';
import {
  responsesLengthRegistration,
  planStoredResponsesRequest,
} from '../../openai-responses/journal-responses-length.js';
import {
  legacyUnitTokens,
  oldMistralUnitTokens,
} from './support/mistral-unit-token-oracle.js';

const settings: RowFormatSettings = {
  formatId: 'openai-chat:mistral',
  formatRev: PLAIN_CHAT_FORMAT_REV,
  model: 'mistral-large-latest',
  endpoint: 'https://first.test/v1',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: false,
  unsupportedMedia: 'notice',
  outputLimits: null,
  chat: { includeInContext: true, toolFormat: 'mistral' },
};
const holder: IContent = { speaker: 'ai', blocks: [call('4SftZvDMX')] };
const target: IContent = { speaker: 'ai', blocks: [call('toolu_alpha-1')] };
const result: IContent = {
  speaker: 'tool',
  blocks: [response('toolu_alpha-1')],
};
const rows = [holder, target, result, target, result];

async function check(
  pin: VersionSnapshot,
  input: readonly IContent[],
  selected = settings,
): Promise<void> {
  const units = await oldTailUnits(input, []);
  const request = await IndexedJournalRequestSnapshot.create(pin);
  try {
    const plan = await planRequestChatMessages(
      pin,
      request,
      selected,
      0,
      '',
      legacyUnitTokens,
    );
    const resolver = await request.mistralForSnapshot(
      pin,
      requestFormatSlot(pin, selected),
    );
    const chunks: Uint8Array[] = [
      Buffer.from('[{"role":"system","content":""}'),
    ];
    for await (const chunk of nativeChatMessages(
      request.openReader(),
      selected,
      'none',
      plan.lastThinking,
      mistralRowIds(resolver),
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
    const callSources: bigint[] = [];
    const responseSources: bigint[] = [];
    for (let index = 0; index < request.count; index++) {
      const entry = await request.unitEntryAt(index);
      const unit = units[index];
      if (
        unit.blocks.some(
          (block) => block.type === 'tool_call' && block.id === 'toolu_alpha-1',
        )
      )
        callSources.push(entry.entry.label);
      if (
        unit.blocks.some(
          (block) =>
            block.type === 'tool_response' && block.callId === 'toolu_alpha-1',
        )
      )
        responseSources.push(entry.entry.label);
    }
    expect(responseSources).toStrictEqual([callSources[0]]);
    expect(new Set(callSources).size).toBe(2);
  } finally {
    await request.close();
  }
}
async function current(
  session: JournalSession,
  input: readonly IContent[],
  selected = settings,
): Promise<void> {
  const pin = await session.store.snapshot();
  try {
    await check(pin, input, selected);
  } finally {
    await pin.close();
  }
}

async function occupy(session: JournalSession): Promise<void> {
  await session.registerRowFormat(
    plainChatLengthRegistration({
      ...settings,
      formatId: 'openai-chat:plain',
      chat: { includeInContext: true, toolFormat: 'openai' },
    }),
  );
  const anthropic: RowFormatSettings = {
    ...settings,
    formatId: 'anthropic',
    formatRev: 1,
    reasoningEnabled: true,
    mediaPdfEnabled: true,
    anthropic: { cache: 'off', imageBudget: null },
  };
  await session.store.commit([
    { kind: 'factIndex', registration: anthropicRepairFactIndex(anthropic) },
  ]);
  await session.registerRowFormat(anthropicLengthRegistration(anthropic));
  const responses: RowFormatSettings = {
    ...settings,
    formatId: 'responses',
    formatRev: 1,
    mediaPdfEnabled: true,
  };
  await session.registerRowFormat(responsesLengthRegistration(responses));
  const before = await session.store.snapshot();
  const anthropicBefore = await planStoredAnthropicRequest(
    before,
    anthropic,
    {},
    { model: anthropic.model, max_tokens: 1 },
  );
  const responsesBefore = planStoredResponsesRequest(
    before,
    responses,
    0,
    { model: responses.model, input: [], stream: true },
    1780000000123,
  );
  try {
    await session.registerRowFormat(
      plainChatLengthRegistration(settings, legacyUnitTokens),
    );
    const after = await session.store.snapshot();
    try {
      expect(requestFormatSlot(after, settings)).toBe(0);
      expect(after.version?.slots.formatSlots[0].gen).toBe(2);
      expect(
        await planStoredAnthropicRequest(
          after,
          anthropic,
          {},
          { model: anthropic.model, max_tokens: 1 },
        ),
      ).toStrictEqual(anthropicBefore);
      expect(
        planStoredResponsesRequest(
          after,
          responses,
          0,
          { model: responses.model, input: [], stream: true },
          1780000000123,
        ),
      ).toStrictEqual(responsesBefore);
    } finally {
      await after.close();
    }
  } finally {
    await before.close();
  }
}

async function checkClone(
  session: JournalSession,
  selected: RowFormatSettings,
  directory: string,
): Promise<void> {
  const clone = await session.cloneUnlinked({
    unlinkedDirectory: directory,
  });
  try {
    await current(clone, rows.slice(1), selected);
    expect(await clone.store.compact()).toBe('swapped');
    await current(clone, rows.slice(1), selected);
    const read = await clone.store.openRead();
    try {
      if (read.version === undefined) throw new Error('Missing clone version');
      await new OffsetAudit(read.access).walkVersion(read.version);
    } finally {
      await read.close();
    }
  } finally {
    await clone.close();
  }
}

describe('occupied native Mistral mapping lifecycle', () => {
  const directory = useTempDir('mistral-occupied-life-');
  it('preserves old pins through real LRU eviction, new endpoint reentry, pop, rewrite, clone, compaction and reopen', async () => {
    const session = await JournalSession.create(`${directory()}/source.llxj`, {
      journal: testJournalSeams({}, 1, false).dependencies,
    });
    try {
      await session.append(rows);
      await occupy(session);
      const old = await session.store.snapshot();
      const selected = { ...settings, endpoint: 'https://new.test/v1' };
      try {
        await check(old, rows);
        for (const endpoint of ['a', 'b', 'c'])
          await session.registerRowFormat(
            plainChatLengthRegistration({ ...settings, endpoint }),
          );
        const evicted = await session.store.snapshot();
        try {
          expect(() => requestFormatSlot(evicted, settings)).toThrow(
            /not registered/,
          );
        } finally {
          await evicted.close();
        }
        await check(old, rows);
        await session.registerRowFormat(
          plainChatLengthRegistration(selected, legacyUnitTokens),
        );
        await current(session, rows, selected);
        await session.append([
          { speaker: 'human', blocks: [{ type: 'text', text: 'pop me' }] },
        ]);
        const appended = await session.store.snapshot();
        const cut = (await appended.entryAt(rows.length)).label;
        const removed = (await appended.entryAt(0)).label;
        await appended.close();
        await session.store.commit([
          { kind: 'pop', cutLabel: cut, expectedRemoved: 1 },
        ]);
        await current(session, rows, selected);
        await session.store.commit([
          { kind: 'density', removed: [removed], replacements: [] },
        ]);
        await current(session, rows.slice(1), selected);
        await check(old, rows);
        await checkClone(session, selected, directory());
        await check(old, rows);
      } finally {
        await old.close();
      }
      expect(await session.store.compact()).toBe('swapped');
      await current(session, rows.slice(1), selected);
      const path = session.path;
      await session.close();
      const reopened = await JournalSession.open(path);
      try {
        await current(reopened, rows.slice(1), selected);
      } finally {
        await reopened.close();
      }
    } finally {
      await session.close();
    }
  });
});
