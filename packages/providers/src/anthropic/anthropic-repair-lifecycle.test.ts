/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { recordedMessages as emittedCandidate } from './__tests__/wire-reference/support/recorded-wire-oracle.js';
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { OffsetAudit } from '@vybestack/llxprt-code-core/journal/__tests__/support/offsetAudit.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';

import { withAnthropicStreamRepair } from './anthropic-stream-repair.js';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
import { anthropicRepairScope } from './anthropic-repair-index.js';

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
const call = (id: string): IContent => ({
  speaker: 'ai',
  blocks: [{ type: 'tool_call', id, name: 'read', parameters: {} }],
});
const result = (id: string, value: string): IContent => ({
  speaker: 'tool',
  blocks: [
    { type: 'tool_response', callId: id, toolName: 'read', result: value },
  ],
});
async function output(query: IndexedJournalRequestSnapshot): Promise<string> {
  return withAnthropicStreamRepair(
    query,
    settings,
    { strip: 'allButLast' },
    async (engine) => {
      let value = '';
      for await (const chunk of engine.serialize()) value += chunk;
      expect((await engine.measure()).bytes).toBe(Buffer.byteLength(value));
      return value;
    },
  );
}
async function matches(
  session: JournalSession,
  rows: readonly IContent[],
): Promise<void> {
  const expected = await emittedCandidate(
    await normalizedRows(rows),
    {
      reasoningEnabled: true,
      strip: 'allButLast',
      currentModel: settings.model,
    },
    {},
  );
  const pin = await session.store.snapshot();
  const query = await IndexedJournalRequestSnapshot.create(pin);
  try {
    expect(await output(query)).toBe(expected);
  } finally {
    await query.close();
    await pin.close();
  }
}

describe('persisted native Anthropic repair facts', () => {
  const directory = useTempDir('anthropic-repair-lifecycle-');
  it('reuses an explicit fill without rewriting facts or changing the pinned version', async () => {
    const counter = { reads: 0 };
    const session = await JournalSession.create(`${directory()}/warm.llxj`, {
      journal: testJournalSeams({ readCounter: counter }, 1, false)
        .dependencies,
    });
    try {
      const rows = [text('q'), call('x'), text('next')];
      await session.append(rows);
      await session.store.commit([
        { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
      ]);
      const beforePin = await session.store.snapshot();
      const before = beforePin.version;
      await beforePin.close();
      const reads = counter.reads;
      await session.store.commit([
        { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
      ]);
      expect(session.store.published).toBe(before);
      expect(counter.reads - reads).toBeLessThan(30);
      await matches(session, rows);
      await session.append([result('x', 'late')]);
      await matches(session, [...rows, result('x', 'late')]);
    } finally {
      await session.close();
    }
  });
  it.each(['x', 'orphan'])(
    'maintains native decisions when a streamed %s result changes the normalized units',
    async (id) => {
      const session = await JournalSession.create(
        `${directory()}/stream-${id}.llxj`,
      );
      const rows = [text('q'), call('x')];
      const added = result(id, 'streamed value');
      try {
        await session.append(rows);
        await session.store.commit([
          {
            kind: 'factIndex',
            registration: anthropicRepairFactIndex(settings),
          },
        ]);
        await session.store.commit([
          {
            kind: 'prepared',
            admission: [],
            prepare: async (group) => {
              await group.append(
                (async function* () {
                  yield encodeContentRow(added, { owner: 0 });
                })(),
                [],
              );
            },
          },
        ]);
        const pin = await session.store.snapshot();
        const query = await IndexedJournalRequestSnapshot.create(pin);
        try {
          const wire = await output(query);
          expect(wire).toContain('streamed value');
          expect(wire).toContain(`"tool_use_id":"toolu_${id}"`);
        } finally {
          await query.close();
          await pin.close();
        }
      } finally {
        await session.close();
      }
    },
  );
  it('maintains native decisions across append, fill, pop, fork and compaction while an old request stays pinned', async () => {
    const rows = [text('q'), call(''), text('next')];
    const added = [
      call('hist_tool_empty'),
      result('hist_tool_empty', 'ONE'),
      text('again'),
      call('toolu_empty'),
      result('toolu_empty', 'TWO'),
    ];
    const session = await JournalSession.create(`${directory()}/native.llxj`, {
      journal: testJournalSeams({}, 1, false).dependencies,
    });
    try {
      await session.store.commit([
        {
          kind: 'replace',
          rows: rows.map((row) => encodeContentRow(row, { owner: 0 })),
        },
        { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
      ]);
      const pin = await session.store.snapshot();
      const query = await IndexedJournalRequestSnapshot.create(pin);
      try {
        const old = await emittedCandidate(
          await normalizedRows(rows),
          {
            reasoningEnabled: true,
            strip: 'allButLast',
            currentModel: settings.model,
          },
          {},
        );
        expect(await output(query)).toBe(old);
        await session.append(added);
        await matches(session, [...rows, ...added]);
        expect(await output(query)).toBe(old);
        await session.store.commit([
          {
            kind: 'fill',
            fills: [
              {
                label: (await pin.entryAt(0)).label,
                tokens: (await pin.entryAt(0)).tokens,
              },
            ],
          },
        ]);
        await matches(session, [...rows, ...added]);
        const after = await session.store.snapshot();
        const cut = (await after.entryAt(rows.length)).label;
        await after.close();
        await session.store.commit([
          { kind: 'pop', cutLabel: cut, expectedRemoved: added.length },
        ]);
        await matches(session, rows);
        await session.append(added);
      } finally {
        await query.close();
        await pin.close();
      }
      expect(await session.store.compact()).toBe('swapped');
      await matches(session, [...rows, ...added]);
      const read = await session.store.openRead();
      try {
        if (read.version === undefined)
          throw new Error('Missing compacted version');
        const audit = new OffsetAudit(read.access);
        await audit.walkVersion(read.version);
        expect(audit.checked.size).toBeGreaterThan(0);
      } finally {
        await read.close();
      }
      const fork = await session.cloneUnlinked({
        unlinkedDirectory: directory(),
      });
      try {
        await matches(fork, [...rows, ...added]);
        await fork.append([text('fork'), call('hist_tool_empty')]);
        await matches(fork, [
          ...rows,
          ...added,
          text('fork'),
          call('hist_tool_empty'),
        ]);
        await matches(session, [...rows, ...added]);
      } finally {
        await fork.close();
      }
    } finally {
      await session.close();
    }
  });
  it('reads persisted facts after reopen and refuses to change history without its native writer', async () => {
    const path = `${directory()}/reopen.llxj`;
    const rows = [text('q'), call('x'), result('x', 'value')];
    const session = await JournalSession.create(path, {
      journal: testJournalSeams().dependencies,
    });
    await session.append(rows);
    await session.store.commit([
      { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
    ]);
    await session.close();
    const reopened = await JournalSession.open(path, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await matches(reopened, rows);
      await expect(reopened.append([text('must register')])).rejects.toThrow(
        /native fact writer must be registered/,
      );
      const pin = await reopened.store.snapshot();
      const entry = await pin.entryAt(0);
      await pin.close();
      await expect(
        reopened.store.commit([
          { kind: 'owner', changes: [{ label: entry.label, owner: 0 }] },
        ]),
      ).rejects.toThrow(/native fact writer must be registered/);
      await reopened.store.commit([
        { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
      ]);
      await reopened.append([text('registered')]);
      await matches(reopened, [...rows, text('registered')]);
    } finally {
      await reopened.close();
    }
  });
  it('throws on inconsistent native message facts without falling back to old normalization', async () => {
    const session = await JournalSession.create(`${directory()}/broken.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.store.commit([
        {
          kind: 'factIndex',
          registration: {
            scope: anthropicRepairScope(settings),
            write: async (_snapshot, writer): Promise<void> => {
              await writer.set(['messages'], [1, 0]);
            },
          },
        },
      ]);
      const pin = await session.store.snapshot();
      const query = await IndexedJournalRequestSnapshot.create(pin);
      try {
        await expect(output(query)).rejects.toThrow(
          /Invalid Anthropic native message facts/,
        );
      } finally {
        await query.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });
  it('preserves a native fact writer failure as the original error', async () => {
    const session = await JournalSession.create(`${directory()}/failure.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    const error = new Error('native scalar writer failure');
    try {
      await expect(
        session.store.commit([
          {
            kind: 'factIndex',
            registration: {
              scope: anthropicRepairScope(settings),
              write: async (): Promise<void> => {
                throw error;
              },
            },
          },
        ]),
      ).rejects.toBe(error);
    } finally {
      await session.close();
    }
  });
});
