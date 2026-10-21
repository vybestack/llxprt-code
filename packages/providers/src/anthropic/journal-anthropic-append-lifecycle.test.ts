/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { VersionEdit } from '@vybestack/llxprt-code-core/journal/groupEdits.js';
import { JournalWriterPoisonedError } from '@vybestack/llxprt-code-core/journal/errors.js';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
import {
  anthropicLengthRegistration,
  planStoredAnthropicRequest,
} from './journal-anthropic-length.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';
import { emittedCandidate } from './message-table/__tests__/support/wireBuilderHarness.js';

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
const text = (value: string): IContent => ({
  speaker: 'human',
  blocks: [{ type: 'text', text: value }],
});
async function register(
  session: JournalSession,
  input = settings,
): Promise<void> {
  await session.store.commit([
    { kind: 'factIndex', registration: anthropicRepairFactIndex(input) },
  ]);
  await session.registerRowFormat(anthropicLengthRegistration(input));
}
async function rejectsInvalidatedPolicies(
  session: JournalSession,
): Promise<void> {
  const pin = await session.store.snapshot();
  try {
    for (const strip of ['none', 'all', 'allButLast'] as const)
      await expect(
        planStoredAnthropicRequest(
          pin,
          settings,
          { strip },
          { model: settings.model },
        ),
      ).rejects.toThrow(/stale|unmeasured/);
  } finally {
    await pin.close();
  }
}
async function storedRows(session: JournalSession): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const stored of session.rows()) rows.push(stored.content);
  return rows;
}
async function bytes(
  session: JournalSession,
  input = settings,
): Promise<number> {
  const pin = await session.store.snapshot();
  try {
    return (
      await planStoredAnthropicRequest(
        pin,
        input,
        { strip: 'allButLast' },
        { model: input.model },
      )
    ).messagesBytes;
  } finally {
    await pin.close();
  }
}

describe('native Anthropic append lifetime and invalidation', () => {
  const directory = useTempDir('anthropic-append-life-');
  for (const mutation of [
    'append-result',
    'pop',
    'clear',
    'replace',
    'density',
    'compress',
    'owner',
    'chain-thinking',
  ] as const) {
    it(`invalidates ${mutation} without publishing a stale length and permits explicit refill`, async () => {
      const session = await JournalSession.create(
        `${directory()}/${mutation}.llxj`,
        { journal: testJournalSeams().dependencies },
      );
      try {
        const row: IContent =
          mutation === 'chain-thinking'
            ? {
                speaker: 'ai',
                blocks: [
                  {
                    type: 'thinking',
                    thought: 'old',
                    sourceField: 'thinking',
                    signature: 'sig',
                  },
                ],
              }
            : text('original');
        await session.append([row]);
        await register(session);
        const old = await session.store.snapshot();
        const entry = await old.entryAt(0);
        const oldPlan = await planStoredAnthropicRequest(
          old,
          settings,
          {},
          { model: settings.model },
        );
        try {
          const draft = encodeContentRow(text('replacement'), { owner: 0 });
          const result = encodeContentRow(
            {
              speaker: 'tool',
              blocks: [
                {
                  type: 'tool_response',
                  callId: 'call_x',
                  toolName: 'read',
                  result: 'later',
                  isComplete: true,
                },
              ],
            },
            { owner: 0 },
          );
          const edits: Record<typeof mutation, VersionEdit> = {
            'append-result': { kind: 'append', rows: [result] },
            pop: { kind: 'pop', cutLabel: entry.label, expectedRemoved: 1 },
            clear: { kind: 'clear' },
            replace: { kind: 'replace', rows: [draft] },
            density: {
              kind: 'density',
              replacements: [{ label: entry.label, draft }],
              removed: [],
            },
            compress: {
              kind: 'compress',
              summary: draft,
              retainFromLabel: entry.label + 1n,
              expectedReplaced: 1,
            },
            owner: {
              kind: 'owner',
              changes: [{ label: entry.label, owner: 7 }],
            },
            'chain-thinking': {
              kind: 'append',
              rows: [encodeContentRow(row, { owner: 0 })],
            },
          };
          await session.store.commit([edits[mutation]]);
          expect(session.store.published).not.toBe(old.version);
          await expect(bytes(session)).rejects.toThrow(/stale|unmeasured/);
          await rejectsInvalidatedPolicies(session);
          expect(
            await planStoredAnthropicRequest(
              old,
              settings,
              {},
              { model: settings.model },
            ),
          ).toStrictEqual(oldPlan);
          await register(session);
          const rows = await storedRows(session);
          const expected = await emittedCandidate(
            await normalizedRows(rows),
            {
              reasoningEnabled: true,
              currentModel: settings.model,
              strip: 'allButLast',
            },
            {},
          );
          expect(await bytes(session)).toBe(Buffer.byteLength(expected));
        } finally {
          await old.close();
        }
      } finally {
        await session.close();
      }
    });
  }
  it('reattaches matching factories after reopen and appends independently on a fork across slot reuse', async () => {
    const path = `${directory()}/reopen.llxj`;
    let session = await JournalSession.create(path, {
      journal: testJournalSeams().dependencies,
    });
    await session.append([text('original')]);
    await register(session);
    await session.close();
    session = await JournalSession.open(path, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await register(session);
      for (let at = 0; at < 4; at++)
        await register(session, {
          ...settings,
          model: `claude-sonnet-4-${at}`,
        });
      const current = { ...settings, model: 'claude-sonnet-4-3' };
      const pin = await session.store.snapshot();
      const old = await planStoredAnthropicRequest(
        pin,
        current,
        {},
        { model: current.model },
      );
      const fork = await session.cloneUnlinked({
        unlinkedDirectory: directory(),
      });
      try {
        await fork.append([text('fork')]);
        expect(await bytes(fork, current)).toBeGreaterThan(old.messagesBytes);
        await session.append([text('parent')]);
        expect(await bytes(session, current)).toBeGreaterThan(
          old.messagesBytes,
        );
        expect(
          await planStoredAnthropicRequest(
            pin,
            current,
            {},
            { model: current.model },
          ),
        ).toStrictEqual(old);
      } finally {
        await fork.close();
        await pin.close();
      }
      expect(await session.store.compact()).toBe('swapped');
      await session.append([text('after physical copy')]);
      expect(await bytes(session, current)).toBeGreaterThan(0);
    } finally {
      await session.close();
    }
  });
  it('preserves the acknowledged version and original append failure, then recovers on reopen', async () => {
    const path = `${directory()}/failure.llxj`;
    const session = await JournalSession.create(path, {
      journal: testJournalSeams().dependencies,
    });
    await session.append([text('original')]);
    await register(session);
    const failure = new Error('append measurement failed');
    const registration = anthropicLengthRegistration(settings);
    await session.registerRowFormat({
      ...registration,
      prepareAppend: async () => {
        throw failure;
      },
    });
    const acknowledged = await session.store.snapshot();
    const version = acknowledged.version;
    await acknowledged.close();
    try {
      await expect(session.append([text('new')])).rejects.toBe(failure);
      expect(session.store.published).toBe(version);
      await expect(session.append([text('poison')])).rejects.toBeInstanceOf(
        JournalWriterPoisonedError,
      );
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(path, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await register(reopened);
      await reopened.append([text('recovered')]);
      expect(await bytes(reopened)).toBeGreaterThan(0);
    } finally {
      await reopened.close();
    }
  });
});
