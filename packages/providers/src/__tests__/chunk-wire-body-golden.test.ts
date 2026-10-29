/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import { join } from 'node:path';
import {
  ARRIVAL_FIELDS,
  type ArrivalFieldName,
} from '@vybestack/llxprt-code-core/journal/chunk-fields.js';
import { JournalArrivalRecorder } from '@vybestack/llxprt-code-core/journal/arrival-recorder.js';
import { JournalStore } from '@vybestack/llxprt-code-core/journal/journalStore.js';
import { storeDeps } from '@vybestack/llxprt-code-core/journal/__tests__/support/storeFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import {
  decodeStoredRow,
  encodeContentRow,
} from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { ROW_BLOCK_TYPE } from '@vybestack/llxprt-code-core/journal/rowRecord.js';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  captureRecord,
  createCorpus,
  GoldenRecorder,
} from './support/wireBodyCorpus.js';
import { WIRE_ROUTES } from './support/wireBodyCapture.js';
import { PINNED_CLOCK } from './support/wireBodyFixtures.js';
import type { HistoryCase } from './support/wireBodyHistories.js';

const corpus = await createCorpus();
const golden = new GoldenRecorder(false);

async function recordBlock(
  recorder: JournalArrivalRecorder,
  row: { readonly transcriptId: bigint },
  source: { readonly type: number; readonly bytes: Uint8Array },
): Promise<void> {
  const block = await recorder.beginBlock(row, source.type);
  for (let at = 0; at < source.bytes.length; at += 137)
    await recorder.appendField(block, source.bytes.subarray(at, at + 137));
  await recorder.endBlock(block);
}

function isField(name: string): name is ArrivalFieldName {
  return ARRIVAL_FIELDS.includes(name);
}
function supportsNamed(block: ContentBlock): boolean {
  return Object.entries(block).every(
    ([name, value]) =>
      name === 'type' ||
      (isField(name) && (typeof value === 'string' || name === 'parameters')),
  );
}
async function recordNamed(
  recorder: JournalArrivalRecorder,
  row: { readonly transcriptId: bigint },
  content: ContentBlock,
): Promise<void> {
  const block = await recorder.beginNamedBlock(
    row,
    ROW_BLOCK_TYPE[content.type],
  );
  for (const [name, value] of Object.entries(content)) {
    if (!isField(name)) continue;
    if (name === 'parameters') {
      const json = JSON.stringify(value);
      await recorder.appendText(block, name, json);
    } else if (typeof value === 'string')
      await recorder.appendText(block, name, value);
  }
  await recorder.endBlock(block);
}

async function recordContent(
  recorder: JournalArrivalRecorder,
  row: { readonly transcriptId: bigint },
  content: IContent,
): Promise<void> {
  const draft = encodeContentRow(content, { owner: 0 });
  for (const [ordinal, source] of draft.blocks.entries()) {
    const block = content.blocks[ordinal];
    if (supportsNamed(block)) await recordNamed(recorder, row, block);
    else await recordBlock(recorder, row, source);
  }
}

async function roundTrip(
  path: string,
  input: HistoryCase,
): Promise<HistoryCase> {
  const store = await JournalStore.create(path, storeDeps());
  const recorder = new JournalArrivalRecorder(store);
  const rows: IContent[] = [];
  try {
    for (const [index, content] of input.rows.entries()) {
      const draft = encodeContentRow(content, { owner: 0 });
      const row = await recorder.beginRow(
        { ...draft, ids: [], blocks: [] },
        { id: `attempt-${index}`, submissionId: 'golden' },
      );
      await recordContent(recorder, row, content);
      await recorder.sealRow(row);
    }
    for await (const entry of store.rows()) {
      const content = decodeStoredRow(await store.readRow(entry));
      const metadata = input.rows[rows.length].metadata;
      // Purge boundaries belong to the request transaction, not its stored row.
      rows.push(
        metadata?.semanticMediaPurgeBoundary === undefined
          ? content
          : {
              ...content,
              metadata: {
                ...content.metadata,
                semanticMediaPurgeBoundary: metadata.semanticMediaPurgeBoundary,
                semanticMediaPurgeCacheWriteEvidence:
                  metadata.semanticMediaPurgeCacheWriteEvidence,
              },
            },
      );
    }
    return { ...input, rows };
  } finally {
    await recorder.close();
    await store.close();
  }
}

describe('chunk-backed frozen provider bodies', () => {
  const directory = useTempDir('chunk-wire-');
  beforeAll(() => setSystemTime(new Date(PINNED_CLOCK)));
  afterAll(async () => {
    setSystemTime();
    await corpus.dispose();
  });
  for (const input of corpus.histories) {
    it(`${input.id} preserves every provider converter's frozen bytes`, async () => {
      const chunked = await roundTrip(
        join(directory(), `${input.id}.llxj`),
        input,
      );
      for (const route of WIRE_ROUTES) {
        const actual = await captureRecord(
          route,
          chunked,
          'stream',
          corpus.binding,
        );
        expect(
          golden.check(route.id, input.id, 'stream', actual),
        ).toBeUndefined();
      }
    });
  }
});
