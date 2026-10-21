/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { OffsetAudit } from '@vybestack/llxprt-code-core/journal/__tests__/support/offsetAudit.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
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
  normalizeToAnthropicToolId,
  normalizeToOpenAIToolId,
} from '@vybestack/llxprt-code-tools';
import {
  plainChatLengthRegistration,
  planStoredChatMessages,
} from './journal-chat-length.js';

const SETTINGS: RowFormatSettings = {
  formatId: 'openai-chat:plain',
  formatRev: 1,
  model: 'a',
  endpoint: 'https://example.test/v1',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: false,
  unsupportedMedia: 'notice',
  outputLimits: null,
};
const textRow = (text: string): IContent => ({
  speaker: 'human',
  blocks: [{ type: 'text', text }],
});

function textMessageLength(texts: readonly string[]): number {
  return Buffer.byteLength(
    JSON.stringify([
      { role: 'system', content: '' },
      ...texts.map((text) => ({ role: 'user', content: text })),
    ]),
  );
}

async function planned(
  session: JournalSession,
  settings = SETTINGS,
): Promise<number> {
  const pin = await session.store.snapshot();
  try {
    return planStoredChatMessages(pin, settings, 0, '').bytes;
  } finally {
    await pin.close();
  }
}
async function assertPoisonedPin(
  session: JournalSession,
  alter: (version: Version) => Version,
): Promise<void> {
  const read = await session.store.openRead();
  if (read.version === undefined) throw new Error('No version');
  const snapshot = new VersionSnapshot(
    new PinnedRead(
      alter(read.version),
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
  );
  try {
    expect(() => planStoredChatMessages(snapshot, SETTINGS, 0, '')).toThrow(
      /unmeasured|stale/,
    );
  } finally {
    await snapshot.close();
  }
}

describe('native format registration lifecycle', () => {
  const directory = useTempDir('journal-format-length-');
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

  it('reads explicitly on cold fill, zero bytes for warm plans and bounded paths for an append', async () => {
    await withSession('reads', async (session, counter) => {
      await session.append(
        Array.from({ length: 128 }, (_, index) => textRow(`row-${index} 雪`)),
      );
      counter.reads = 0;
      await session.registerRowFormat(plainChatLengthRegistration(SETTINGS));
      expect(counter.reads).toBeGreaterThan(128);
      counter.reads = 0;
      const before = textMessageLength(
        Array.from({ length: 128 }, (_, index) => `row-${index} 雪`),
      );
      expect(await planned(session)).toBe(before);
      expect(counter.reads).toBe(0);
      await session.append([textRow('tail')]);
      const appendReads = counter.reads;
      expect(appendReads).toBeLessThan(150);
      counter.reads = 0;
      expect(await planned(session)).toBeGreaterThan(before);
      expect(counter.reads).toBe(0);
      await session.registerRowFormat(
        plainChatLengthRegistration({
          ...SETTINGS,
          endpoint: 'https://other.test/v1',
        }),
      );
      expect(counter.reads).toBeGreaterThan(128);
    });
  });

  it('restores lengths through pop, owner edits, rebuild, clone, compaction and reopen', async () => {
    await withSession('mutations', async (session) => {
      await session.append([textRow('one'), textRow('two')]);
      await session.registerRowFormat(plainChatLengthRegistration(SETTINGS));
      const before = textMessageLength(['one', 'two']);
      expect(await planned(session)).toBe(before);
      await session.append([textRow('three')]);
      const pin = await session.store.snapshot();
      const cut = (await pin.entryAt(2)).label;
      const ownerLabel = (await pin.entryAt(0)).label;
      await pin.close();
      await session.store.commit([
        { kind: 'pop', cutLabel: cut, expectedRemoved: 1 },
      ]);
      expect(await planned(session)).toBe(before);
      await session.store.commit([
        { kind: 'owner', changes: [{ label: ownerLabel, owner: 7 }] },
      ]);
      expect(await planned(session)).toBe(before);
      await session.store.commit([
        { kind: 'density', removed: [ownerLabel], replacements: [] },
      ]);
      const after = textMessageLength(['two']);
      expect(await planned(session)).toBe(after);
      const clone = await session.cloneUnlinked();
      expect(await planned(clone)).toBe(after);
      await clone.append([textRow('cloned append')]);
      expect(await planned(clone)).toBeGreaterThan(after);
      await clone.close();
      await session.store.compact();
      expect(await planned(session)).toBe(after);
      const read = await session.store.openRead();
      if (read.version === undefined) throw new Error('No copied version');
      await new OffsetAudit(read.access).walkVersion(read.version);
      await read.close();
      await session.close();
      const reopened = await JournalSession.open(session.path);
      expect(await planned(reopened)).toBe(after);
      await reopened.registerRowFormat(plainChatLengthRegistration(SETTINGS));
      await reopened.append([textRow('reopened append')]);
      expect(await planned(reopened)).toBeGreaterThan(after);
      await reopened.close();
    });
  });

  it('captures settings before asynchronous registration and leaves a plan unchanged after a model change', async () => {
    await withSession('capture', async (session) => {
      await session.append([textRow('captured')]);
      const settings = { ...SETTINGS, model: 'captured-model' };
      const filling = session.registerRowFormat(
        plainChatLengthRegistration(settings),
      );
      settings.model = 'later-model';
      await filling;
      const pin = await session.store.snapshot();
      const plan = planStoredChatMessages(
        pin,
        { ...SETTINGS, model: 'captured-model' },
        0,
        '',
      );
      await session.registerRowFormat(plainChatLengthRegistration(settings));
      expect(plan.settings.model).toBe('captured-model');
      expect(planStoredChatMessages(pin, plan.settings, 0, '').bytes).toBe(
        plan.bytes,
      );
      expect(() => planStoredChatMessages(pin, settings, 0, '')).toThrow(
        /registered/,
      );
      await pin.close();
    });
  });

  it('does not assign mapping-only and length formats conflicting meanings in one slot', async () => {
    await withSession('reserved', async (session) => {
      await session.append([textRow('mapping reserved')]);
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      await session.registerRowFormat(plainChatLengthRegistration(SETTINGS));
      expect(
        session.store.published?.slots.formatSlots[0].summaryKind,
      ).toBeNull();
      expect(session.store.published?.slots.formatSlots[1].summaryKind).toBe(
        'chat',
      );
      await expect(
        session.store.commit([{ kind: 'mistral', slot: 1 }]),
      ).rejects.toThrow(/format slot/);
      expect(await planned(session)).toBeGreaterThan(0);
    });
  });

  it('preserves the published version, old pin and original cause when a measurer fails', async () => {
    await withSession('callback-error', async (session) => {
      await session.append([textRow('before failure')]);
      await session.registerRowFormat(plainChatLengthRegistration(SETTINGS));
      const expected = textMessageLength(['before failure']);
      const pin = await session.store.snapshot();
      const failedSettings = { ...SETTINGS, model: 'failing-model' };
      const failure = new Error('injected measurement failure');
      try {
        await expect(
          session.registerRowFormat({
            settings: failedSettings,
            measure: async () => {
              throw failure;
            },
          }),
        ).rejects.toBe(failure);
        expect(session.store.published).toStrictEqual(pin.version);
        expect(planStoredChatMessages(pin, SETTINGS, 0, '').bytes).toBe(
          expected,
        );
        expect(await planned(session)).toBe(expected);
        expect(() =>
          planStoredChatMessages(pin, failedSettings, 0, ''),
        ).toThrow(/registered/);
        await session.close();
        const reopened = await JournalSession.open(session.path);
        try {
          expect(await planned(reopened)).toBe(expected);
          await reopened.registerRowFormat(
            plainChatLengthRegistration(SETTINGS),
          );
          await reopened.append([textRow('after recovery')]);
          expect(await planned(reopened)).toBe(
            textMessageLength(['before failure', 'after recovery']),
          );
        } finally {
          await reopened.close();
        }
      } finally {
        await pin.close();
      }
    });
  });

  it('refuses stale generations and an unmeasured zero summary instead of declaring a length', async () => {
    await withSession('stale', async (session) => {
      await session.append([textRow('measured')]);
      await session.registerRowFormat(plainChatLengthRegistration(SETTINGS));
      expect(await planned(session)).toBeGreaterThan(0);
      await assertPoisonedPin(session, (version) => ({
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
      await assertPoisonedPin(session, (version) => ({
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
});
