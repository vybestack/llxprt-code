/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalWriterPoisonedError } from '@vybestack/llxprt-code-core/journal/errors.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { Version } from '@vybestack/llxprt-code-core/journal/version.js';
import { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import {
  PinnedRead,
  PinLease,
} from '@vybestack/llxprt-code-core/journal/pinLease.js';
import { sha256KeyHash } from '@vybestack/llxprt-code-core/journal/idKeys.js';
import { BoundedIdNodeCache } from '@vybestack/llxprt-code-core/journal/idTrieCache.js';
import {
  normalizeToOpenAIToolId,
  normalizeToAnthropicToolId,
} from '@vybestack/llxprt-code-tools';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { OffsetAudit } from '@vybestack/llxprt-code-core/journal/__tests__/support/offsetAudit.js';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { buildOpenAIResponsesInput } from './OpenAIResponsesInputBuilder.js';
import {
  responsesLengthRegistration,
  planStoredResponsesRequest,
} from './journal-responses-length.js';

const SETTINGS: RowFormatSettings = {
  formatId: 'responses',
  formatRev: 1,
  model: 'model-a',
  endpoint: 'https://example.test/v1',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: true,
  unsupportedMedia: 'notice',
  outputLimits: null,
};
const textRow = (text: string): IContent => ({
  speaker: 'human',
  blocks: [{ type: 'text', text }],
});
const request = (model = SETTINGS.model) => ({
  model,
  input: [],
  stream: true,
  instructions: '雪',
});
async function expectedLength(
  session: JournalSession,
  settings = SETTINGS,
): Promise<number> {
  const pin = await session.store.snapshot();
  const query = await IndexedJournalRequestSnapshot.create(pin);
  try {
    const rows: IContent[] = [];
    for await (const row of query.openReader()) rows.push(row);
    const input = buildOpenAIResponsesInput(rows, {
      includeReasoningInContext: true,
      outputLimits: settings.outputLimits ?? parseOutputLimits({}),
      debug: () => undefined,
      mediaPdfEnabled: settings.mediaPdfEnabled,
      reasoningIdTime: 123,
    });
    return Buffer.byteLength(
      JSON.stringify({ ...request(settings.model), input }),
    );
  } finally {
    await query.close();
    await pin.close();
  }
}
async function verify(
  session: JournalSession,
  settings = SETTINGS,
): Promise<number> {
  const bytes = await expectedLength(session, settings);
  const pin = await session.store.snapshot();
  try {
    expect(
      planStoredResponsesRequest(pin, settings, 0, request(settings.model), 123)
        .contentLength,
    ).toBe(bytes);
    return bytes;
  } finally {
    await pin.close();
  }
}
async function assertInvalid(
  session: JournalSession,
  change: (version: Version) => Version,
): Promise<void> {
  const read = await session.store.openRead();
  if (read.version === undefined) throw new Error('No version');
  const pin = new VersionSnapshot(
    new PinnedRead(
      change(read.version),
      read.access,
      new PinLease(() => read.close()),
    ),
    {
      hasher: sha256KeyHash,
      occurrenceSpace: 'source-with-normalized',
      normalizers: {
        openai: normalizeToOpenAIToolId,
        anthropic: normalizeToAnthropicToolId,
      },
    },
    new BoundedIdNodeCache(),
    session.store.sortedLabels,
  );
  try {
    expect(() =>
      planStoredResponsesRequest(pin, SETTINGS, 0, request(), 123),
    ).toThrow(/unmeasured|stale/);
  } finally {
    await pin.close();
  }
}

describe('native Responses format lifecycle', () => {
  const directory = useTempDir('responses-format-');
  async function withSession(
    name: string,
    consume: (
      session: JournalSession,
      counter: { reads: number },
    ) => Promise<void>,
  ): Promise<void> {
    const counter = { reads: 0 };
    const session = await JournalSession.create(`${directory()}/${name}.llxj`, {
      journal: testJournalSeams({ readCounter: counter }, 1, false)
        .dependencies,
    });
    try {
      await consume(session, counter);
    } finally {
      await session.close();
    }
  }

  it('maintains normalized-ID collision holders when an append first supplies their response', async () => {
    await withSession('collision', async (session) => {
      await session.append([
        {
          speaker: 'ai',
          blocks: [
            { type: 'tool_call', id: '', name: 'empty', parameters: {} },
          ],
        },
      ]);
      await session.registerRowFormat(responsesLengthRegistration(SETTINGS));
      const before = await expectedLength(session);
      await verify(session);
      await session.append([
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_',
              toolName: 'reply',
              result: 'later',
            },
          ],
        },
      ]);
      await verify(session);
      await session.append([
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_',
              toolName: 'reply',
              result: 'better response 雪',
              isComplete: true,
            },
          ],
        },
      ]);
      expect(await verify(session)).toBeGreaterThan(before);
    });
  });

  for (const count of [40, 4000])
    it(`fills ${count} rows once and plans warm with no physical reads`, async () => {
      await withSession(`reads-${count}`, async (session, counter) => {
        await session.append(
          Array.from({ length: count }, (_, index) =>
            textRow(`row-${index} 雪`),
          ),
        );
        counter.reads = 0;
        await session.registerRowFormat(responsesLengthRegistration(SETTINGS));
        const cold = counter.reads;
        expect(cold).toBeGreaterThan(count);
        const pin = await session.store.snapshot();
        counter.reads = 0;
        const plan = planStoredResponsesRequest(
          pin,
          SETTINGS,
          0,
          request(),
          123,
        );
        expect(plan.items).toBe(count);
        expect(counter.reads).toBe(0);
        await session.append([textRow('tail')]);
        const append = counter.reads;
        expect(append).toBeLessThan(150);
        const current = await session.store.snapshot();
        counter.reads = 0;
        expect(
          planStoredResponsesRequest(current, SETTINGS, 0, request(), 123)
            .items,
        ).toBe(count + 1);
        expect(
          planStoredResponsesRequest(pin, SETTINGS, 0, request(), 123)
            .contentLength,
        ).toBe(plan.contentLength);
        expect(counter.reads).toBe(0);
        process.stdout.write(
          `Responses reads ${JSON.stringify({ count, cold, warm: counter.reads, append })}\n`,
        );
        await current.close();
        await pin.close();
      });
    });

  it('preserves measured summaries through pop, ownership, density, replacement, compression, fork and compaction', async () => {
    await withSession('mutations', async (session) => {
      await session.append([textRow('one'), textRow('two')]);
      await session.registerRowFormat(responsesLengthRegistration(SETTINGS));
      const before = await expectedLength(session);
      await verify(session);
      const old = await session.store.snapshot();
      try {
        await session.append([textRow('three')]);
        const pin = await session.store.snapshot();
        const cutLabel = (await pin.entryAt(2)).label;
        const ownerLabel = (await pin.entryAt(0)).label;
        await pin.close();
        await session.store.commit([
          { kind: 'pop', cutLabel, expectedRemoved: 1 },
        ]);
        expect(await verify(session)).toBe(before);
        await session.store.commit([
          { kind: 'owner', changes: [{ label: ownerLabel, owner: 7 }] },
        ]);
        await verify(session);
        await session.store.commit([
          { kind: 'density', removed: [ownerLabel], replacements: [] },
        ]);
        await verify(session);
        await session.store.commit([
          {
            kind: 'replace',
            rows: [encodeContentRow(textRow('replacement'), { owner: 0 })],
          },
        ]);
        await verify(session);
        const compressionPin = await session.store.snapshot();
        const retainFromLabel = compressionPin.version?.nextLabel;
        await compressionPin.close();
        if (retainFromLabel === undefined)
          throw new Error('No compression version');
        await session.store.commit([
          {
            kind: 'compress',
            summary: encodeContentRow(textRow('summary'), { owner: 0 }),
            retainFromLabel,
            expectedReplaced: 1,
          },
        ]);
        await verify(session);
        const clone = await session.cloneUnlinked();
        try {
          await verify(clone);
          await clone.append([textRow('fork')]);
          await verify(clone);
        } finally {
          await clone.close();
        }
        await expect(session.store.compact()).rejects.toThrow(/live pin/);
        expect(
          planStoredResponsesRequest(old, SETTINGS, 0, request(), 123)
            .contentLength,
        ).toBe(before);
      } finally {
        await old.close();
      }
      await session.store.compact();
      await verify(session);
      const read = await session.store.openRead();
      if (read.version === undefined) throw new Error('No copied version');
      await new OffsetAudit(read.access).walkVersion(read.version);
      await read.close();
    });
  });

  it('captures settings and preserves held old pins across generation eviction', async () => {
    await withSession('capture', async (session) => {
      await session.append([textRow('captured')]);
      const settings = { ...SETTINGS };
      const filling = session.registerRowFormat(
        responsesLengthRegistration(settings),
      );
      settings.model = 'changed';
      await filling;
      const pin = await session.store.snapshot();
      try {
        const plan = planStoredResponsesRequest(
          pin,
          SETTINGS,
          0,
          request(),
          123,
        );
        expect(() =>
          planStoredResponsesRequest(pin, settings, 0, request('changed'), 123),
        ).toThrow(/registered/);
        for (const model of ['b', 'c', 'd'])
          await session.registerRowFormat(
            responsesLengthRegistration({ ...SETTINGS, model }),
          );
        const current = await session.store.snapshot();
        expect(() =>
          planStoredResponsesRequest(current, SETTINGS, 0, request(), 123),
        ).toThrow(/registered/);
        await current.close();
        expect(
          planStoredResponsesRequest(pin, SETTINGS, 0, request(), 123)
            .contentLength,
        ).toBe(plan.contentLength);
        await verify(session, { ...SETTINGS, model: 'd' });
      } finally {
        await pin.close();
      }
    });
  });

  it('rejects stale generations and unmeasured zero facts', async () => {
    await withSession('stale', async (session) => {
      await session.append([textRow('measured')]);
      await session.registerRowFormat(responsesLengthRegistration(SETTINGS));
      expect(await verify(session)).toBeGreaterThan(0);
      await assertInvalid(session, (version) => ({
        ...version,
        slots: {
          ...version.slots,
          formatSlots: [
            {
              ...version.slots.formatSlots[0],
              gen: version.slots.formatSlots[0].gen + 1,
            },
            version.slots.formatSlots[1],
            version.slots.formatSlots[2],
          ],
        },
      }));
      await assertInvalid(session, (version) => ({
        ...version,
        aggregate: {
          ...version.aggregate,
          missingBase: [1, 0, 0],
          summaries: [
            new Uint8Array(296),
            version.aggregate.summaries[1],
            version.aggregate.summaries[2],
          ],
        },
      }));
    });
  });

  it('keeps the acknowledged version and original error when measurement fails, then recovers on reopen', async () => {
    await withSession('failure', async (session) => {
      await session.append([textRow('before')]);
      await session.registerRowFormat(responsesLengthRegistration(SETTINGS));
      const old = await session.store.snapshot();
      const failure = new Error('measurement failed');
      try {
        await expect(
          session.registerRowFormat({
            settings: { ...SETTINGS, model: 'failure' },
            measure: async () => {
              throw failure;
            },
          }),
        ).rejects.toBe(failure);
        expect(session.store.published).toStrictEqual(old.version);
        await verify(session);
        await expect(
          session.append([textRow('unacknowledged')]),
        ).rejects.toBeInstanceOf(JournalWriterPoisonedError);
        await session.close();
        const reopened = await JournalSession.open(session.path);
        try {
          await verify(reopened);
          await reopened.registerRowFormat(
            responsesLengthRegistration(SETTINGS),
          );
          await reopened.append([textRow('recovered')]);
          await verify(reopened);
        } finally {
          await reopened.close();
        }
      } finally {
        await old.close();
      }
    });
  });
});
