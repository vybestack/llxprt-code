/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  inMemoryRequestSelection,
  type ProviderRequestRows,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { MessageTable } from '../message-table.js';
import {
  buildWireTable,
  type MediaStage,
  type WireBuildOptions,
} from '../wire-builder.js';
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
  conversionOptions,
  describeDifference,
  oracleJson,
  tableMessages,
  type WireSettings,
} from './support/wireBuilderHarness.js';

/** Rows that report which positions were opened and which were read at. */
function recordingRows(rows: readonly IContent[]): {
  rows: ProviderRequestRows;
  readAt: number[];
  opened: () => number;
} {
  const inner = inMemoryRequestSelection(structuredClone([...rows]));
  const readAt: number[] = [];
  let opened = 0;
  return {
    readAt,
    opened: () => opened,
    rows: {
      count: inner.count,
      openReader: (signal) => {
        opened++;
        return inner.openReader(signal);
      },
      readAt: (index, signal) => {
        readAt.push(index);
        return inner.readAt(index, signal);
      },
    },
  };
}

async function build(
  rows: ProviderRequestRows,
  settings: WireSettings,
  extra: Partial<WireBuildOptions> = {},
): Promise<MessageTable> {
  const table = new MessageTable();
  try {
    await buildWireTable(table, rows, {
      ...conversionOptions(settings),
      ...extra,
    });
    return table;
  } catch (error) {
    table.close();
    throw error;
  }
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

  it('never reads a row at a position for a history without thinking runs', async () => {
    const recorder = recordingRows(plain);
    (await build(recorder.rows, { reasoningEnabled: true })).close();
    expect(recorder.readAt).toStrictEqual([]);
    expect(recorder.opened()).toBe(1);
  });

  it('reads a thinking run back with readAt from the run to the row that ends it', async () => {
    const recorder = recordingRows(withRun);
    (await build(recorder.rows, { reasoningEnabled: true })).close();
    const reads = [...new Set(recorder.readAt)].sort();
    // Scan of the run (rows 2, 3, 4 ends it), then rows 1..3 for the four categories.
    expect(reads).toStrictEqual([1, 2, 3, 4]);
  });

  it('makes one extra pass over the rows only for the allButLast policy', async () => {
    for (const [strip, passes] of [
      ['none', 1],
      ['all', 1],
      ['allButLast', 2],
    ] as const) {
      const recorder = recordingRows(withRun);
      (await build(recorder.rows, { reasoningEnabled: true, strip })).close();
      expect(recorder.opened()).toBe(passes);
    }
  });

  it('sends every row through the media stage once, in order', async () => {
    const seen: string[] = [];
    const mediaStage: MediaStage = async function* (input) {
      for await (const row of input) {
        seen.push(row.speaker);
        yield row;
      }
    };
    const recorder = recordingRows(withRun);
    (
      await build(
        recorder.rows,
        { reasoningEnabled: true, strip: 'allButLast' },
        { mediaStage },
      )
    ).close();
    expect(seen).toStrictEqual(withRun.map((row) => row.speaker));
  });

  it('runs the media stage again only for a thinking run that carries tool results', async () => {
    const withResults: IContent[] = [
      thinkingOnly('t'),
      {
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'k', name: 'read_file', parameters: {} },
          {
            type: 'tool_response',
            callId: 'k',
            toolName: 'read_file',
            result: 'inline',
          },
        ],
      },
    ];
    const counts: Record<string, number> = {};
    for (const [label, rows] of [
      ['without', withRun],
      ['with', withResults],
    ] as const) {
      let pulled = 0;
      const mediaStage: MediaStage = async function* (input) {
        for await (const row of input) {
          pulled++;
          yield row;
        }
      };
      (
        await build(
          recordingRows(rows).rows,
          { reasoningEnabled: true },
          { mediaStage },
        )
      ).close();
      counts[label] = pulled - rows.length;
    }
    expect(counts).toStrictEqual({ without: 0, with: 2 });
  });

  it('fails when the media stage does not return one row per row', async () => {
    const mediaStage: MediaStage = async function* (input) {
      for await (const row of input) {
        yield row;
        return;
      }
    };
    const recorder = recordingRows(plain);
    await expect(
      build(recorder.rows, { reasoningEnabled: false }, { mediaStage }),
    ).rejects.toThrow('The media stage changed the number of rows');
  });

  it('fails on an aborted request without leaving scratch behind', async () => {
    const before = readdirSync(getScratchRoot()).length;
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    const recorder = recordingRows(withRun);
    await expect(
      build(
        recorder.rows,
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

  it('keeps orphan and displaced results only until the validation passes run', async () => {
    const table = await build(
      inMemoryRequestSelection(structuredClone(history)),
      { reasoningEnabled: true },
    );
    try {
      expect(JSON.stringify(tableMessages(table))).toContain('ghost');
      expect(
        await candidateJson(history, { reasoningEnabled: true }),
      ).not.toContain('ghost');
    } finally {
      table.close();
    }
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
    stage: MediaStage;
    peak: () => number;
  } {
    const source = bulkyRows();
    const refs: Array<WeakRef<IContent>> = [];
    let peak = 0;
    const rows: ProviderRequestRows = {
      count: source.length,
      async *openReader() {
        for (const row of source) {
          const fresh = structuredClone(row);
          refs.push(new WeakRef(fresh));
          yield fresh;
        }
      },
      readAt: (index) => structuredClone(source[index]),
    };
    const stage: MediaStage = async function* (input) {
      for await (const row of input) {
        retain?.push(row);
        Bun.gc(true);
        await Bun.sleep(0);
        const alive = refs.filter((ref) => ref.deref() !== undefined).length;
        peak = Math.max(peak, alive);
        yield row;
      }
    };
    return { rows, stage, peak: () => peak };
  }

  it('holds only a few rows while converting a long history', async () => {
    const run = watched(undefined);
    (
      await build(
        run.rows,
        { reasoningEnabled: true },
        { mediaStage: run.stage },
      )
    ).close();
    expect(run.peak()).toBeLessThanOrEqual(6);
  }, 120_000);

  it('would show a history array: a stage that keeps the rows exceeds the bound', async () => {
    const kept: IContent[] = [];
    const run = watched(kept);
    (
      await build(
        run.rows,
        { reasoningEnabled: true },
        { mediaStage: run.stage },
      )
    ).close();
    expect(kept).toHaveLength(ROWS);
    expect(run.peak()).toBeGreaterThan(ROWS / 2);
  }, 120_000);
});
