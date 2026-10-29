/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  inMemoryRequestSelection,
  type ProviderRequestRows,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import type { MediaStage } from '../../native-anthropic-media-stage.js';
import { CURRENT_MODEL } from './support/wireBuilderCorpus.js';
import {
  aiText,
  answerRow,
  callRow,
  text,
  thinkingOnly,
} from './support/wireBuilderRows.js';
import {
  candidateJson,
  renderNativeRows,
  describeDifference,
  oracleJson,
  type WireSettings,
} from './support/wireBuilderHarness.js';

async function build(
  rows: ProviderRequestRows,
  settings: WireSettings,
  extra: { signal?: AbortSignal } = {},
): Promise<void> {
  await renderNativeRows(rows, settings, extra);
}

describe('wire builder reads', () => {
  const plain: IContent[] = [
    text('q'),
    callRow('a'),
    answerRow('a'),
    aiText('done'),
  ];
  const withRun: IContent[] = [
    text('q'),
    thinkingOnly('t'),
    aiText('one'),
    callRow('a'),
    answerRow('a'),
    aiText('after the run'),
  ];

  it('fails when the media stage does not return one row per row', async () => {
    const mediaStage: MediaStage = async function* (input) {
      for await (const row of input) {
        yield row;
        return;
      }
    };
    await expect(
      renderNativeRows(
        inMemoryRequestSelection(plain),
        { reasoningEnabled: false },
        { mediaStage },
      ),
    ).rejects.toThrow('The media stage changed the number of rows');
  });

  it.each(['first', 'last'])(
    'refuses a media stage that drops the %s wire row',
    async (dropped) => {
      let total = 0;
      await renderNativeRows(
        inMemoryRequestSelection(plain),
        { reasoningEnabled: false },
        {
          async *mediaStage(input) {
            for await (const row of input) {
              total++;
              yield row;
            }
          },
        },
      );
      let at = 0;
      const mediaStage: MediaStage = async function* (input) {
        for await (const row of input) {
          at++;
          if (at !== (dropped === 'first' ? 1 : total)) yield row;
        }
      };
      await expect(
        renderNativeRows(
          inMemoryRequestSelection(plain),
          { reasoningEnabled: false },
          { mediaStage },
        ),
      ).rejects.toThrow('The media stage changed the number of rows');
    },
  );

  it('fails when the native media stage returns an extra row', async () => {
    const mediaStage: MediaStage = async function* (input) {
      for await (const row of input) {
        yield row;
        yield row;
      }
    };
    await expect(
      renderNativeRows(
        inMemoryRequestSelection(plain),
        { reasoningEnabled: false },
        { mediaStage },
      ),
    ).rejects.toThrow('Anthropic media stage yielded an extra row');
  });

  it('fails on an aborted request without leaving scratch behind', async () => {
    const before = readdirSync(getScratchRoot()).length;
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    await expect(
      build(
        inMemoryRequestSelection(withRun),
        { reasoningEnabled: true },
        { signal: controller.signal },
      ),
    ).rejects.toThrow('stop');
    expect(readdirSync(getScratchRoot()).length).toBe(before);
  });
});

describe('wire builder controls', () => {
  const history: IContent[] = [
    text('q'),
    thinkingOnly('t'),
    thinkingOnly('from another model', 'other-model'),
    aiText('one'),
    callRow('a', 'b'),
    text('interrupt'),
    answerRow('b'),
    answerRow('ghost'),
  ];

  it('is compared under settings that change the bytes', async () => {
    const settings: WireSettings = {
      reasoningEnabled: true,
      strip: 'all',
      currentModel: CURRENT_MODEL,
    };
    const expected = oracleJson(history, settings);
    expect(
      describeDifference(
        expected,
        await candidateJson(history, { ...settings, strip: 'none' }),
      ),
    ).toBeDefined();
    expect(
      describeDifference(
        expected,
        await candidateJson(history, { ...settings, currentModel: undefined }),
      ),
    ).toBeDefined();
    expect(
      describeDifference(expected, await candidateJson(history, settings)),
    ).toBeUndefined();
  });

  it('differs from the array route when the media stage rewrites a row', async () => {
    const settings: WireSettings = { reasoningEnabled: false };
    const mediaStage: MediaStage = async function* (input) {
      for await (const row of input)
        yield row.speaker === 'human'
          ? { ...row, blocks: [{ type: 'text', text: 'rewritten' }] }
          : row;
    };
    expect(
      describeDifference(
        oracleJson(history, settings),
        await candidateJson(history, settings, { mediaStage }),
      ),
    ).toContain('rewritten');
  });
});

describe('wire builder residency', () => {
  const ROWS = 240;

  function bulkyRows(): IContent[] {
    return Array.from({ length: ROWS }, (_, index) =>
      index % 2 === 0
        ? text(`question ${index} ${'q'.repeat(20_000)}`)
        : aiText(`answer ${index} ${'a'.repeat(20_000)}`),
    );
  }

  /** Rows whose objects are watched; the stage reports how many earlier ones are still alive. */
  function watched(retain: IContent[] | undefined): {
    rows: ProviderRequestRows;
    peak: () => number;
  } {
    const source = bulkyRows();
    const refs: Array<WeakRef<IContent>> = [];
    let peak = 0;
    const fetch = async (index: number): Promise<IContent> => {
      const fresh = structuredClone(source[index]);
      refs.push(new WeakRef(fresh));
      if (retain !== undefined && !(index in retain)) retain[index] = fresh;
      Bun.gc(true);
      await Bun.sleep(0);
      peak = Math.max(
        peak,
        refs.filter((ref) => ref.deref() !== undefined).length,
      );
      return fresh;
    };
    const rows: ProviderRequestRows = {
      count: source.length,
      async *openReader() {
        for (let at = 0; at < source.length; at++) yield await fetch(at);
      },
      readAt: fetch,
    };
    return { rows, peak: () => peak };
  }

  it('holds only a few rows while repairing and serializing a long history', async () => {
    const run = watched(undefined);
    await build(run.rows, { reasoningEnabled: true });
    expect(run.peak()).toBeLessThanOrEqual(6);
  }, 120_000);

  it('would show a history array: a source that keeps the rows exceeds the bound', async () => {
    const kept: IContent[] = [];
    const run = watched(kept);
    await build(run.rows, { reasoningEnabled: true });
    expect(kept).toHaveLength(ROWS);
    expect(run.peak()).toBeGreaterThan(ROWS / 2);
  }, 120_000);
});
