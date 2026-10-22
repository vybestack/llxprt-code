/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { identitySlotSummary } from '@vybestack/llxprt-code-core/journal/summaryComposition.js';
import { requestFormatSlot } from '@vybestack/llxprt-code-core/services/history/native-provider-format.js';
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { OffsetAudit } from '@vybestack/llxprt-code-core/journal/__tests__/support/offsetAudit.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  RowFormatRegistration,
  RowFormatSettings,
} from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { Version } from '@vybestack/llxprt-code-core/journal/version.js';
import { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { observeRowFormat } from './__tests__/support/observeRowFormat.js';
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
  PLAIN_CHAT_FORMAT_REV,
} from './journal-chat-length.js';

const SETTINGS: RowFormatSettings = {
  formatId: 'openai-chat:plain',
  formatRev: PLAIN_CHAT_FORMAT_REV,
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
    session.store.sortedLabels,
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
  it('allocates Mistral after all three native format slots have been filled', async () => {
    await withSession('occupied-mistral', async (session) => {
      await session.append([textRow('occupied formats')]);
      for (const model of ['plain', 'anthropic', 'responses']) {
        const pin = await session.store.snapshot();
        try {
          await session.store.commit([
            {
              kind: 'format',
              registration:
                model === 'plain'
                  ? plainChatLengthRegistration({ ...SETTINGS, model })
                  : {
                      settings: {
                        ...SETTINGS,
                        model,
                        formatId:
                          model === 'anthropic' ? 'anthropic' : 'responses',
                      },
                      measure: async () => ({
                        summary: identitySlotSummary(
                          model === 'anthropic' ? 'anthropic' : 'responses',
                        ),
                        lens: new Uint8Array(0),
                      }),
                    },
            },
          ]);
        } finally {
          await pin.close();
        }
      }
      const pin = await session.store.snapshot();
      const settings: RowFormatSettings = {
        ...SETTINGS,
        formatId: 'openai-chat:mistral',
        chat: { includeInContext: true, toolFormat: 'mistral' },
      };
      try {
        const measured = await session.store.prepareSnapshotFormat(
          pin,
          plainChatLengthRegistration(settings),
        );
        try {
          expect(planStoredChatMessages(measured, settings, 0, '').bytes).toBe(
            textMessageLength(['occupied formats']),
          );
          const slot = requestFormatSlot(measured, settings);
          expect(slot).toBe(0);
          expect(measured.version?.slots.formatSlots[slot].gen).toBe(2);
          expect(
            measured.version?.slots.formatSlots.map(
              (format) => format.summaryKind,
            ),
          ).toStrictEqual(['chat', 'anthropic', 'responses']);
          const warm = await session.store.prepareSnapshotFormat(
            measured,
            plainChatLengthRegistration(settings),
          );
          try {
            expect(requestFormatSlot(warm, settings)).toBe(slot);
            expect(
              planStoredChatMessages(warm, settings, 0, '').generation,
            ).toBe(2);
          } finally {
            await warm.close();
          }
        } finally {
          await measured.close();
        }
      } finally {
        await pin.close();
      }
    });
  });

  it('fills an immutable older view without changing the published rows', async () => {
    await withSession('old-view-fill', async (session) => {
      await session.append([textRow('before purge')]);
      const old = await session.store.snapshot();
      try {
        await session.append([textRow('current only')]);
        const measured = await session.store.prepareSnapshotFormat(
          old,
          plainChatLengthRegistration(SETTINGS),
        );
        try {
          expect(planStoredChatMessages(measured, SETTINGS, 0, '').bytes).toBe(
            textMessageLength(['before purge']),
          );
          expect(session.store.published?.rows).toBe(2);
          expect(old.rows).toBe(1);
          const other = await session.store.prepareSnapshotFormat(
            measured,
            plainChatLengthRegistration({ ...SETTINGS, endpoint: 'other' }),
          );
          try {
            expect(
              planStoredChatMessages(
                other,
                { ...SETTINGS, endpoint: 'other' },
                0,
                '',
              ).bytes,
            ).toBe(textMessageLength(['before purge']));
            expect(
              planStoredChatMessages(measured, SETTINGS, 0, '').bytes,
            ).toBe(textMessageLength(['before purge']));
          } finally {
            await other.close();
          }
        } finally {
          await measured.close();
        }
      } finally {
        await old.close();
      }
    });
  });

  it('reads explicitly on cold fill, zero bytes for warm plans and bounded paths for an append', async () => {
    await withSession('reads', async (session, counter) => {
      await session.append(
        Array.from({ length: 128 }, (_, index) => textRow(`row-${index} 雪`)),
      );
      const texts = Array.from(
        { length: 128 },
        (_, index) => `row-${index} 雪`,
      );
      const measured: Array<{ label: bigint; lens: unknown }> = [];
      function registration(
        settings: RowFormatSettings,
      ): RowFormatRegistration {
        return observeRowFormat(
          plainChatLengthRegistration(settings),
          (entry, facts) => {
            measured.push({
              label: entry.label,
              lens: JSON.parse(new TextDecoder().decode(facts.lens)),
            });
          },
        );
      }
      function expectCoverage(expected: readonly string[]): void {
        expect(measured).toHaveLength(expected.length);
        expect(new Set(measured.map(({ label }) => label)).size).toBe(
          expected.length,
        );
        expect(measured.map(({ label }) => label)).toStrictEqual(
          measured
            .map(({ label }) => label)
            .sort((a, b) => (a < b ? -1 : Number(a > b))),
        );
        expect(measured.map(({ lens }) => lens)).toStrictEqual(
          expected.map((text) => {
            const unit = {
              speaker: 'human',
              messages: [
                {
                  bytes: Buffer.byteLength(
                    JSON.stringify({ role: 'user', content: text }),
                  ),
                  dropped: false,
                },
              ],
              media: [],
            };
            return { revision: 1, units: [[unit, unit]] };
          }),
        );
      }
      counter.reads = 0;
      await session.registerRowFormat(registration(SETTINGS));
      expectCoverage(texts);
      expect(counter.reads).toBeGreaterThan(0);
      expect(counter.reads).toBeLessThan(128);
      counter.reads = 0;
      const before = textMessageLength(texts);
      expect(await planned(session)).toBe(before);
      expect(counter.reads).toBe(0);
      expectCoverage(texts);
      await session.append([textRow('tail')]);
      const appendReads = counter.reads;
      expect(appendReads).toBeLessThan(150);
      expectCoverage([...texts, 'tail']);
      counter.reads = 0;
      expect(await planned(session)).toBe(
        textMessageLength([...texts, 'tail']),
      );
      expect(counter.reads).toBe(0);
      const otherSettings = { ...SETTINGS, endpoint: 'https://other.test/v1' };
      measured.length = 0;
      await session.registerRowFormat(registration(otherSettings));
      expectCoverage([...texts, 'tail']);
      expect(counter.reads).toBeGreaterThan(0);
      expect(counter.reads).toBeLessThan(129);
      counter.reads = 0;
      expect(await planned(session, otherSettings)).toBe(
        textMessageLength([...texts, 'tail']),
      );
      expect(counter.reads).toBe(0);
      expectCoverage([...texts, 'tail']);
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
