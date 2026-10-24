/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { recordedMessages as emittedCandidate } from './__tests__/wire-reference/support/recorded-wire-oracle.js';
import { describe, expect, it } from 'bun:test';
import { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import {
  PinnedRead,
  PinLease,
} from '@vybestack/llxprt-code-core/journal/pinLease.js';
import type { Version } from '@vybestack/llxprt-code-core/journal/version.js';
import { sha256KeyHash } from '@vybestack/llxprt-code-core/journal/idKeys.js';
import { BoundedIdNodeCache } from '@vybestack/llxprt-code-core/journal/idTrieCache.js';
import {
  normalizeToOpenAIToolId,
  normalizeToAnthropicToolId,
} from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { anthropicScenarios } from '../__tests__/support/frozenWire/explicit/anthropicCases.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';
import { type WireSettings } from './__tests__/wire-reference/support/wireBuilderHarness.js';
import { wireSettingsOf } from './__tests__/wire-reference/support/lengthModel/frozenInputs.js';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
import {
  anthropicLengthRegistration,
  planStoredAnthropicRequest,
} from './journal-anthropic-length.js';
const settingsOf = (wire: WireSettings): RowFormatSettings => ({
  formatId: 'anthropic',
  formatRev: 1,
  model: wire.currentModel ?? 'claude-sonnet-4',
  endpoint: 'https://api.anthropic.com',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: wire.reasoningEnabled,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: true,
  unsupportedMedia: 'notice',
  outputLimits: null,
  anthropic: { cache: 'off', imageBudget: wire.imageBudget ?? null },
});
async function alteredSnapshot(
  session: JournalSession,
  alter: (version: Version) => Version,
): Promise<VersionSnapshot> {
  const read = await session.store.openRead();
  if (read.version === undefined) {
    await read.close();
    throw new Error('Missing measured version');
  }
  return new VersionSnapshot(
    new PinnedRead(
      alter(read.version),
      read.access,
      new PinLease(() => read.close()),
    ),
    {
      hasher: sha256KeyHash,
      normalizers: {
        openai: normalizeToOpenAIToolId,
        anthropic: normalizeToAnthropicToolId,
      },
      occurrenceSpace: 'normalized',
    },
    new BoundedIdNodeCache(),
    session.store.sortedLabels,
  );
}
const think = (thought: string): IContent => ({
  speaker: 'ai',
  blocks: [
    { type: 'thinking', thought, sourceField: 'thinking', signature: 'sig' },
  ],
});
describe('stored Anthropic named conversion and async ownership', () => {
  const directory = useTempDir('stored-anthropic-named-');
  let serial = 0;
  async function withStored<T>(
    rows: readonly IContent[],
    wire: WireSettings,
    consume: (
      session: JournalSession,
      settings: RowFormatSettings,
    ) => Promise<T>,
  ): Promise<T> {
    const settings = settingsOf(wire);
    const session = await JournalSession.create(
      `${directory()}/named-${serial++}.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    try {
      await session.store.commit([
        {
          kind: 'replace',
          rows: rows.map((row) => encodeContentRow(row, { owner: 0 })),
        },
        { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
      ]);
      await session.registerRowFormat(anthropicLengthRegistration(settings));
      return await consume(session, settings);
    } finally {
      await session.close();
    }
  }
  async function matches(
    rows: readonly IContent[],
    wire: WireSettings,
  ): Promise<number> {
    const expected = await emittedCandidate(
      await normalizedRows(rows),
      wire,
      {},
    );
    return withStored(rows, wire, async (session, settings) => {
      const pin = await session.store.snapshot();
      try {
        const plan = await planStoredAnthropicRequest(pin, settings, wire, {
          model: settings.model,
          max_tokens: 1,
        });
        expect(plan.messagesBytes).toBe(Buffer.byteLength(expected));
        return plan.messagesBytes;
      } finally {
        await pin.close();
      }
    });
  }
  for (const scenario of anthropicScenarios())
    it(`plans independent normalized lengths for ${scenario.name}`, async () => {
      const wire = wireSettingsOf(
        scenario.send.model ?? 'claude-opus-5',
        scenario.send.ephemerals ?? {},
      );
      expect(await matches(scenario.send.rows, wire)).toBeGreaterThan(0);
    });
  it('keeps the raw ONE ONE TWO expectation distinct from normalized stored lengths', async () => {
    const scenario = anthropicScenarios().find((item) =>
      item.name.includes('ONE, ONE, TWO'),
    );
    if (scenario === undefined) throw new Error('Missing duplicate scenario');
    const wire = { reasoningEnabled: false, currentModel: 'claude-opus-5' };
    const raw = await emittedCandidate(scenario.send.rows, wire, {});
    expect(raw.match(/ONE|TWO/g)).toStrictEqual(['ONE', 'ONE', 'TWO']);
    expect(
      await emittedCandidate(
        await normalizedRows(scenario.send.rows),
        wire,
        {},
      ),
    ).not.toBe(raw);
    await matches(scenario.send.rows, wire);
  });
  it('handles whitespace and both thinking blocks in the last-kept multi-row chain', async () => {
    const rows: readonly IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'q' }] },
      think('first'),
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: '  \n' }, ...think('second').blocks],
      },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'answer' }] },
    ];
    for (const strip of ['none', 'all', 'allButLast'] as const)
      expect(
        await matches(rows, {
          reasoningEnabled: true,
          currentModel: 'claude-sonnet-4',
          strip,
        }),
      ).toBeGreaterThan(0);
  });
  it('captures measured settings and envelope values before asynchronous metadata reads', async () => {
    const rows: readonly IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'answer' }] },
    ];
    const wire: WireSettings = {
      reasoningEnabled: true,
      currentModel: 'claude-sonnet-4',
      strip: 'allButLast',
    };
    const expected = await emittedCandidate(
      await normalizedRows(rows),
      wire,
      {},
    );
    await withStored(rows, wire, async (session, original) => {
      const pin = await session.store.snapshot();
      const mutable = { ...original, reasoningEnabled: true };
      const request = { model: original.model, max_tokens: 1 };
      try {
        const planning = planStoredAnthropicRequest(
          pin,
          mutable,
          wire,
          request,
        );
        mutable.reasoningEnabled = false;
        request.max_tokens = 123456789;
        const plan = await planning;
        expect(plan.messagesBytes).toBe(Buffer.byteLength(expected));
        expect(plan.contentLength).toBe(
          Buffer.byteLength(
            JSON.stringify({
              model: original.model,
              max_tokens: 1,
              messages: JSON.parse(expected),
            }),
          ),
        );
        expect(plan.settings.reasoningEnabled).toBe(true);
      } finally {
        await pin.close();
      }
    });
  });
  it('rejects unknown thinking policies and callback envelope values rather than reusing a measured length', async () => {
    await withStored(
      [think('keep')],
      { reasoningEnabled: true },
      async (session, settings) => {
        const pin = await session.store.snapshot();
        try {
          const invalidStrip: { strip: 'none' } = { strip: 'none' };
          Reflect.set(invalidStrip, 'strip', 'future');
          await expect(
            planStoredAnthropicRequest(pin, settings, invalidStrip, {
              model: settings.model,
            }),
          ).rejects.toThrow(/policy/);
          const invalidInclude = { includeInContext: true };
          Reflect.set(invalidInclude, 'includeInContext', () => false);
          await expect(
            planStoredAnthropicRequest(pin, settings, invalidInclude, {
              model: settings.model,
            }),
          ).rejects.toThrow(/policy/);
          await expect(
            planStoredAnthropicRequest(
              pin,
              settings,
              {},
              { model: settings.model, system: () => 'dynamic' },
            ),
          ).rejects.toThrow(/serializ|clon/i);
          const unknownSettings = {
            ...settings,
            futureConverterMode: 'future',
          };
          await expect(
            planStoredAnthropicRequest(
              pin,
              unknownSettings,
              {},
              { model: settings.model },
            ),
          ).rejects.toThrow(/not registered/);
          const callbacks = { ...settings, model: settings.model };
          Reflect.set(callbacks, 'futureConverterCallback', () => 'dynamic');
          await expect(
            planStoredAnthropicRequest(
              pin,
              callbacks,
              {},
              { model: settings.model },
            ),
          ).rejects.toThrow(/serializ|clon/i);
        } finally {
          await pin.close();
        }
      },
    );
  });
  it('rejects stale slot generations before using native aggregate bytes', async () => {
    await withStored(
      [think('keep')],
      { reasoningEnabled: true },
      async (session, settings) => {
        const pin = await alteredSnapshot(session, (version) => ({
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
        try {
          await expect(
            planStoredAnthropicRequest(
              pin,
              settings,
              {},
              { model: settings.model, max_tokens: 1 },
            ),
          ).rejects.toThrow(/unmeasured or stale/);
        } finally {
          await pin.close();
        }
      },
    );
  });
  it('rejects an unmeasured aggregate instead of silently planning zero bytes', async () => {
    await withStored(
      [think('keep')],
      { reasoningEnabled: true },
      async (session, settings) => {
        const pin = await alteredSnapshot(session, (version) => ({
          ...version,
          aggregate: { ...version.aggregate, missingBase: [1, 0, 0] },
        }));
        try {
          await expect(
            planStoredAnthropicRequest(
              pin,
              settings,
              {},
              { model: settings.model, max_tokens: 1 },
            ),
          ).rejects.toThrow(/unmeasured or stale/);
        } finally {
          await pin.close();
        }
      },
    );
  });
  it('holds a metadata plan alive after its caller releases the snapshot', async () => {
    await withStored(
      [think('keep')],
      { reasoningEnabled: true },
      async (session, settings) => {
        const pin = await session.store.snapshot();
        const planning = planStoredAnthropicRequest(
          pin,
          settings,
          { strip: 'allButLast' },
          { model: settings.model, max_tokens: 1 },
        );
        await pin.close();
        expect((await planning).messagesBytes).toBeGreaterThan(0);
      },
    );
  });
});
