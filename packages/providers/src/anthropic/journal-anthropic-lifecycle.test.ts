/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { VersionEdit } from '@vybestack/llxprt-code-core/journal/groupEdits.js';
import { JournalWriterPoisonedError } from '@vybestack/llxprt-code-core/journal/errors.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { OffsetAudit } from '@vybestack/llxprt-code-core/journal/__tests__/support/offsetAudit.js';
import { IdTrieReader } from '@vybestack/llxprt-code-core/journal/idTrieReader.js';
import { decodeMapRef } from '@vybestack/llxprt-code-core/journal/keyedMap.js';
import { BoundedIdNodeCache } from '@vybestack/llxprt-code-core/journal/idTrieCache.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
import {
  anthropicLengthRegistration,
  planStoredAnthropicRequest,
} from './journal-anthropic-length.js';

const settings: RowFormatSettings = {
  formatId: 'anthropic',
  formatRev: 1,
  model: 'claude-sonnet-4',
  endpoint: 'https://api.anthropic.com',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: true,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: true,
  unsupportedMedia: 'notice',
  outputLimits: null,
  anthropic: { cache: 'off', imageBudget: null },
};
async function register(
  session: JournalSession,
  input: RowFormatSettings = settings,
): Promise<void> {
  await session.store.commit([
    { kind: 'factIndex', registration: anthropicRepairFactIndex(input) },
  ]);
  await session.registerRowFormat(anthropicLengthRegistration(input));
}
async function bytes(
  session: JournalSession,
  input: RowFormatSettings = settings,
): Promise<number> {
  const pin = await session.store.snapshot();
  try {
    return (
      await planStoredAnthropicRequest(
        pin,
        input,
        { strip: 'allButLast' },
        { model: input.model, max_tokens: 1 },
      )
    ).messagesBytes;
  } finally {
    await pin.close();
  }
}
async function metaCount(session: JournalSession): Promise<number> {
  const read = await session.store.openRead();
  try {
    if (read.version === undefined)
      throw new Error('Missing generation version');
    let count = 0;
    const memberships: string[] = [];
    for await (const entry of new IdTrieReader(
      read.access,
      new BoundedIdNodeCache(),
    ).entries(read.version.roots.metaRoot)) {
      const record = await read.access.readRecordHead(
        decodeMapRef(entry.value),
        'VALUE',
      );
      const key = new TextDecoder().decode(record.kindHeader);
      if (key.startsWith('member:')) memberships.push(key);
      else count++;
    }
    // Transcript membership is row state, separate from the generation-slot census.
    expect(memberships).toStrictEqual(['member:1']);
    return count;
  } finally {
    await read.close();
  }
}

describe('stored Anthropic generations and pinned lifetime', () => {
  const directory = useTempDir('stored-anthropic-life-');
  it('bounds live auxiliary metadata to the three generation slots while preserving old pins', async () => {
    const session = await JournalSession.create(
      `${directory()}/generations.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    try {
      await session.append([
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'kept',
              sourceField: 'thinking',
              signature: 'sig',
            },
          ],
        },
      ]);
      await register(session);
      const old = await session.store.snapshot();
      const expected = await planStoredAnthropicRequest(
        old,
        settings,
        { strip: 'allButLast' },
        { model: settings.model, max_tokens: 1 },
      );
      try {
        for (let at = 0; at < 12; at++)
          await register(session, {
            ...settings,
            model: `claude-sonnet-4-${at}`,
          });
        expect(
          await planStoredAnthropicRequest(
            old,
            settings,
            { strip: 'allButLast' },
            { model: settings.model, max_tokens: 1 },
          ),
        ).toStrictEqual(expected);
        expect(await metaCount(session)).toBeLessThanOrEqual(7);
      } finally {
        await old.close();
      }
      const latest = await session.store.snapshot();
      try {
        await expect(
          planStoredAnthropicRequest(
            latest,
            settings,
            {},
            { model: settings.model, max_tokens: 1 },
          ),
        ).rejects.toThrow(/not registered/);
      } finally {
        await latest.close();
      }
    } finally {
      await session.close();
    }
  });
  it('refuses unattached history edits before changing an acknowledged measured version', async () => {
    let session = await JournalSession.create(
      `${directory()}/unsupported-edits.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    try {
      await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'original' }] },
      ]);
      await register(session);
      await session.close();
      session = await JournalSession.open(
        `${directory()}/unsupported-edits.llxj`,
        {
          journal: testJournalSeams().dependencies,
        },
      );
      const pin = await session.store.snapshot();
      const entry = await pin.entryAt(0);
      const published = pin.version;
      await pin.close();
      const draft = encodeContentRow(
        { speaker: 'human', blocks: [{ type: 'text', text: 'change' }] },
        { owner: 0 },
      );
      const edits: readonly VersionEdit[] = [
        { kind: 'append', rows: [draft] },
        { kind: 'pop', cutLabel: entry.label, expectedRemoved: 1 },
        { kind: 'replace', rows: [draft] },
        {
          kind: 'density',
          replacements: [{ label: entry.label, draft }],
          removed: [],
        },
        {
          kind: 'compress',
          summary: draft,
          retainFromLabel: entry.label + 1n,
          expectedReplaced: 1,
        },
        { kind: 'owner', changes: [{ label: entry.label, owner: 7 }] },
      ];
      for (const edit of edits)
        await expect(session.store.commit([edit])).rejects.toThrow(
          /incremental holder maintenance is not implemented/,
        );
      expect(session.store.published).toBe(published);
      expect(await bytes(session)).toBeGreaterThan(0);
    } finally {
      await session.close();
    }
  });
  it('disposes the native iterator and preserves the original finish failure and acknowledgement', async () => {
    const path = `${directory()}/failure.llxj`;
    const session = await JournalSession.create(path, {
      journal: testJournalSeams().dependencies,
    });
    await session.append([
      { speaker: 'human', blocks: [{ type: 'text', text: 'before' }] },
    ]);
    await session.store.commit([
      { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
    ]);
    const acknowledged = await session.store.snapshot();
    const published = acknowledged.version;
    await acknowledged.close();
    const failure = new Error('stored summary finish failure');
    const registration = anthropicLengthRegistration(settings);
    let disposed = false;
    try {
      await expect(
        session.registerRowFormat({
          ...registration,
          prepare: async (snapshot, input) => {
            const fill = await registration.prepare?.(snapshot, input);
            if (fill === undefined)
              throw new Error('Missing fill-scoped measurer');
            return {
              ...fill,
              finish: async () => {
                throw failure;
              },
              close: async () => {
                await fill.close();
                disposed = true;
              },
            };
          },
        }),
      ).rejects.toBe(failure);
      expect(disposed).toBe(true);
      expect(session.store.published).toBe(published);
      await expect(
        session.append([{ speaker: 'human', blocks: [] }]),
      ).rejects.toBeInstanceOf(JournalWriterPoisonedError);
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(path, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await register(reopened);
      expect(await bytes(reopened)).toBeGreaterThan(0);
    } finally {
      await reopened.close();
    }
  });
  it('preserves stored correction lengths through reopen, fork and physical compaction', async () => {
    const path = `${directory()}/lifetime.llxj`;
    const session = await JournalSession.create(path, {
      journal: testJournalSeams().dependencies,
    });
    await session.append([
      { speaker: 'human', blocks: [{ type: 'text', text: 'q' }] },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'keep 雪',
            sourceField: 'thinking',
            signature: 'sig',
          },
          { type: 'text', text: 'answer' },
        ],
      },
    ]);
    await register(session);
    const expected = await bytes(session);
    await session.close();
    const reopened = await JournalSession.open(path, {
      journal: testJournalSeams().dependencies,
    });
    try {
      expect(await bytes(reopened)).toBe(expected);
      expect(await reopened.store.compact()).toBe('swapped');
      expect(await bytes(reopened)).toBe(expected);
      const read = await reopened.store.openRead();
      try {
        if (read.version === undefined)
          throw new Error('Missing compacted version');
        const audit = new OffsetAudit(read.access);
        await audit.walkVersion(read.version);
        expect(audit.checked.size).toBeGreaterThan(0);
      } finally {
        await read.close();
      }
      const fork = await reopened.cloneUnlinked({
        unlinkedDirectory: directory(),
      });
      try {
        expect(await bytes(fork)).toBe(expected);
      } finally {
        await fork.close();
      }
    } finally {
      await reopened.close();
    }
  });
});
