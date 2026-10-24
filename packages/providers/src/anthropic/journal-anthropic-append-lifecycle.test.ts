/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { recordedMessages as emittedCandidate } from './message-table/__tests__/support/recorded-wire-oracle.js';
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
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { AnthropicStreamRepair } from './anthropic-stream-repair.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  anthropicLengthRegistration,
  planStoredAnthropicRequest,
} from './journal-anthropic-length.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';

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
async function rendered(
  pin: VersionSnapshot,
  input = settings,
  strip: 'none' | 'all' | 'allButLast' = 'allButLast',
): Promise<string> {
  const query = await IndexedJournalRequestSnapshot.create(pin);
  try {
    const engine = await AnthropicStreamRepair.create(query, input, { strip });
    let body = '';
    for await (const chunk of engine.serialize()) body += chunk;
    return body;
  } finally {
    await query.close();
  }
}
const call = (id = 'call_round', name = 'read'): IContent => ({
  speaker: 'ai',
  blocks: [{ type: 'tool_call', id, name, parameters: {} }],
});
const response = (
  id = 'call_round',
  speaker: IContent['speaker'] = 'tool',
  result: unknown = 'result',
): IContent => ({
  speaker,
  blocks: [
    {
      type: 'tool_response',
      callId: id,
      toolName: 'read',
      result,
      isComplete: true,
    },
  ],
});
async function oldBody(
  rows: readonly IContent[],
  input = settings,
): Promise<string> {
  return emittedCandidate(
    await normalizedRows(
      buildCuratedHistory(new DebugLogger('held-tool-old'), rows, false),
    ),
    {
      reasoningEnabled: true,
      currentModel: input.model,
      strip: 'allButLast',
    },
    {},
  );
}
async function matchesOldEmitter(
  session: JournalSession,
  rows: readonly IContent[],
  input = settings,
): Promise<void> {
  const pin = await session.store.snapshot();
  const normalized = await normalizedRows(
    buildCuratedHistory(new DebugLogger('tool-append-old'), rows, false),
  );
  try {
    for (const strip of ['none', 'all', 'allButLast'] as const) {
      const expected = await emittedCandidate(
        normalized,
        { reasoningEnabled: true, currentModel: input.model, strip },
        {},
      );
      const plan = await planStoredAnthropicRequest(
        pin,
        input,
        { strip },
        { model: input.model },
      );
      expect(plan.messagesBytes).toBe(Buffer.byteLength(expected));
      expect(plan.messages).toBe(JSON.parse(expected).length);
      expect(await rendered(pin, input, strip)).toBe(expected);
    }
    expect(pin.version?.aggregate.units).toBe(normalized.length);
  } finally {
    await pin.close();
  }
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
    it(`${mutation === 'append-result' ? 'maintains' : 'invalidates'} ${mutation} without publishing a stale length and permits explicit refill`, async () => {
      const session = await JournalSession.create(
        `${directory()}/${mutation}.llxj`,
        { journal: testJournalSeams().dependencies },
      );
      try {
        const specialRows: Readonly<Record<string, IContent>> = {
          'append-result': {
            speaker: 'ai',
            blocks: [
              { type: 'tool_call', id: 'call_x', name: 'read', parameters: {} },
            ],
          },
          'chain-thinking': {
            speaker: 'ai',
            blocks: [
              {
                type: 'thinking',
                thought: 'old',
                sourceField: 'thinking',
                signature: 'sig',
              },
            ],
          },
        };
        const row = specialRows[mutation] ?? text('original');
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
          const verify =
            mutation === 'append-result'
              ? async (current: JournalSession): Promise<void> =>
                  matchesOldEmitter(current, await storedRows(current))
              : rejectsInvalidatedPolicies;
          await verify(session);
          await session.append([text('after mutation')]);
          await verify(session);
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
  for (const scenario of [
    { name: 'empty-ID call', before: [text('q')], added: call('') },
    {
      name: 'unnamed call',
      before: [text('q')],
      added: call('call_round', ''),
    },
    {
      name: 'non-AI call',
      before: [text('q')],
      added: { ...call(), speaker: 'human' } satisfies IContent,
    },
    { name: 'unmatched result', before: [text('q')], added: response() },
    {
      name: 'normalized-ID collision',
      before: [call('hist_tool_round')],
      added: response('toolu_round'),
    },
    { name: 'duplicate call', before: [call()], added: call() },
    {
      name: 'late first response',
      before: [call(), text('later boundary')],
      added: response(),
    },
    {
      name: 'better late response',
      before: [call(), response('call_round', 'tool', null)],
      added: response(),
    },
    {
      name: 'tool in a thinking chain',
      before: [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'chain',
              sourceField: 'thinking',
              signature: 'sig',
            },
          ],
        } satisfies IContent,
      ],
      added: call(),
    },
  ]) {
    it(`invalidates ${scenario.name}, preserves old pins and refills exact repaired bytes`, async () => {
      const session = await JournalSession.create(
        `${directory()}/${scenario.name}.llxj`,
        { journal: testJournalSeams().dependencies },
      );
      try {
        await session.append(scenario.before);
        await register(session);
        const old = await session.store.snapshot();
        try {
          const before = await oldBody(scenario.before);
          expect(await rendered(old)).toBe(before);
          await session.append([scenario.added]);
          await rejectsInvalidatedPolicies(session);
          expect(await rendered(old)).toBe(before);
          await register(session);
          await matchesOldEmitter(session, [
            ...scenario.before,
            scenario.added,
          ]);
        } finally {
          await old.close();
        }
      } finally {
        await session.close();
      }
    });
  }
  it('maintains real tool rounds on empty, reopened, forked and physically copied versions with held repair roots', async () => {
    const path = `${directory()}/tool-reopen.llxj`;
    const options = { journal: testJournalSeams().dependencies };
    let session = await JournalSession.create(path, options);
    await register(session);
    await session.append([call()]);
    await matchesOldEmitter(session, [call()]);
    await session.close();
    session = await JournalSession.open(path, options);
    try {
      await register(session);
      for (let at = 0; at < 4; at++)
        await register(session, { ...settings, model: `claude-tool-${at}` });
      const current = { ...settings, model: 'claude-tool-3' };
      const old = await session.store.snapshot();
      const before = await oldBody([call()], current);
      expect(await rendered(old, current)).toBe(before);
      const plan = await planStoredAnthropicRequest(
        old,
        current,
        {},
        { model: current.model },
      );
      const fork = await session.cloneUnlinked({
        unlinkedDirectory: directory(),
      });
      try {
        await fork.append([response('call_round', 'tool', 'fork result')]);
        await matchesOldEmitter(
          fork,
          [call(), response('call_round', 'tool', 'fork result')],
          current,
        );
        await session.append([
          response('call_round', 'human', 'parent result'),
        ]);
        await matchesOldEmitter(
          session,
          [call(), response('call_round', 'human', 'parent result')],
          current,
        );
        expect(await rendered(old, current)).toBe(before);
        expect(
          await planStoredAnthropicRequest(
            old,
            current,
            {},
            { model: current.model },
          ),
        ).toStrictEqual(plan);
      } finally {
        await fork.close();
        await old.close();
      }
      expect(await session.store.compact()).toBe('swapped');
      await session.append([call('call_copy')]);
      await session.append([response('call_copy')]);
      await matchesOldEmitter(
        session,
        [
          call(),
          response('call_round', 'human', 'parent result'),
          call('call_copy'),
          response('call_copy'),
        ],
        current,
      );
    } finally {
      await session.close();
    }
  });
  it('keeps a pending response request-only and refuses stored tail planning', async () => {
    const session = await JournalSession.create(
      `${directory()}/tool-tail.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    try {
      await register(session);
      await session.append([call()]);
      const pin = await session.store.snapshot();
      const query = await IndexedJournalRequestSnapshot.create(pin, [
        response(),
      ]);
      try {
        const expected = await normalizedRows([call(), response()]);
        expect(await query.readAt(1)).toStrictEqual(expected[1]);
        expect(query.pending.inputCount).toBe(1);
        expect(query.isPending(1)).toBe(true);
        await expect(
          planStoredAnthropicRequest(
            pin,
            settings,
            {},
            { model: settings.model },
            { pendingInputCount: 1 },
          ),
        ).rejects.toThrow(/pending-tail/);
        expect(session.store.published).toBe(pin.version);
        expect(pin.rows).toBe(1);
        await matchesOldEmitter(session, [call()]);
      } finally {
        await query.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });
  it('preserves the published repair root after an actual holder measurement fails and poisons disk writes', async () => {
    const path = `${directory()}/tool-failure.llxj`;
    const options = { journal: testJournalSeams().dependencies };
    const session = await JournalSession.create(path, options);
    await register(session);
    await session.append([call()]);
    const original = anthropicLengthRegistration(settings);
    const failure = new Error('actual holder measurement failure');
    await session.registerRowFormat({
      ...original,
      prepareAppend: async (...args) => {
        if (original.prepareAppend === undefined)
          throw new Error('Missing append preparation');
        const fill = await original.prepareAppend(...args);
        return {
          ...fill,
          measure: async (...measureArgs) => {
            await fill.measure(...measureArgs);
            throw failure;
          },
        };
      },
    });
    const old = await session.store.snapshot();
    try {
      const body = await oldBody([call()]);
      expect(await rendered(old)).toBe(body);
      await expect(session.append([response()])).rejects.toBe(failure);
      expect(session.store.published).toBe(old.version);
      expect(await rendered(old)).toBe(body);
      await expect(session.append([text('poison')])).rejects.toBeInstanceOf(
        JournalWriterPoisonedError,
      );
    } finally {
      await old.close();
      await session.close();
    }
    const reopened = await JournalSession.open(path, options);
    try {
      await register(reopened);
      await reopened.append([response()]);
      await matchesOldEmitter(reopened, [call(), response()]);
    } finally {
      await reopened.close();
    }
  });
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
        await matchesOldEmitter(
          fork,
          [text('original'), text('fork')],
          current,
        );
        await session.append([text('parent')]);
        expect(await bytes(session, current)).toBeGreaterThan(
          old.messagesBytes,
        );
        await matchesOldEmitter(
          session,
          [text('original'), text('parent')],
          current,
        );
        await matchesOldEmitter(
          fork,
          [text('original'), text('fork')],
          current,
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
      await session.close();
      session = await JournalSession.open(path, {
        journal: testJournalSeams().dependencies,
      });
      await register(session, current);
      const reopened = await session.store.snapshot();
      try {
        const before = await planStoredAnthropicRequest(
          reopened,
          current,
          {},
          { model: current.model },
        );
        await session.append([
          text('reopened with only current settings attached'),
        ]);
        await matchesOldEmitter(
          session,
          [
            text('original'),
            text('parent'),
            text('after physical copy'),
            text('reopened with only current settings attached'),
          ],
          current,
        );
        const latest = await session.store.snapshot();
        try {
          const after = await planStoredAnthropicRequest(
            latest,
            current,
            {},
            { model: current.model },
          );
          expect(after.generation).toBe(before.generation);
          await expect(
            planStoredAnthropicRequest(
              latest,
              { ...settings, model: 'claude-sonnet-4-2' },
              {},
              { model: 'claude-sonnet-4-2' },
            ),
          ).rejects.toThrow(/stale|unmeasured/);
          expect(
            await planStoredAnthropicRequest(
              reopened,
              current,
              {},
              { model: current.model },
            ),
          ).toStrictEqual(before);
        } finally {
          await latest.close();
        }
      } finally {
        await reopened.close();
      }
    } finally {
      await session.close();
    }
  });
  it('keeps warm empty registrations and clear/refill free of phantom units', async () => {
    const session = await JournalSession.create(`${directory()}/empty.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await register(session);
      await matchesOldEmitter(session, []);
      const measured = await session.store.snapshot();
      try {
        await register(session);
        expect(session.store.published).toBe(measured.version);
      } finally {
        await measured.close();
      }
      const changed = { ...settings, model: 'claude-sonnet-4-empty' };
      await register(session, changed);
      await matchesOldEmitter(session, [], changed);
      await session.append([text('first')]);
      await matchesOldEmitter(session, [text('first')], changed);
      await session.store.commit([{ kind: 'clear' }]);
      const stale = await session.store.snapshot();
      try {
        for (const strip of ['none', 'all', 'allButLast'] as const)
          await expect(
            planStoredAnthropicRequest(
              stale,
              changed,
              { strip },
              { model: changed.model },
            ),
          ).rejects.toThrow(/stale|unmeasured/);
        expect(stale.version?.aggregate.units).toBe(0);
      } finally {
        await stale.close();
      }
      await register(session, changed);
      await matchesOldEmitter(session, [], changed);
      await session.append([text('after empty refill')]);
      await matchesOldEmitter(session, [text('after empty refill')], changed);
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
