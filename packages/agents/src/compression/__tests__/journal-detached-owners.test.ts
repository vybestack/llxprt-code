/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { detachedRow } from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import { historyOriginId } from '@vybestack/llxprt-code-core/services/history/historyOriginId.js';
import { checkpointRows } from '@vybestack/llxprt-code-core/services/history/historyCheckpointRows.js';
import type {
  IContent,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  openOwnedJournal,
  type OwnedJournal,
} from '@vybestack/llxprt-code-core/services/history/journalOwnedFixture.js';
import { curatedCandidate } from '../curatedCandidate.js';
import { publishCandidate } from '../diskTruncation.js';
import { publishProviderFallbackCandidate } from '../providerFallbackCandidate.js';
import {
  publishSelectedToolResponses,
  replaceRankedToolResponse,
  ToolResponseDiskRanking,
} from '../toolResponseDiskRanking.js';
import { journalBackedHistory } from './support/journal-detached-history.js';

const OWNERS = ['agent-a', 'agent-b'] as const;
const SIZES: number[] = [3, 64, 65];

let directory: string;
const opened: OwnedJournal[] = [];

/** `count` rows alternating between two owners. */
async function ownedHistory(
  count: number,
  name: string,
): Promise<OwnedJournal> {
  const journal = await openOwnedJournal(
    path.join(directory, `${name}-${count}.llxj`),
    Array.from({ length: count }, (_, index) => ({
      content: detachedRow(index, 64),
      origin: OWNERS[index % OWNERS.length],
    })),
  );
  opened.push(journal);
  return journal;
}

/** Row 1 is an empty ai row, row 2 carries the tool response, the rest are plain. */
function toolHistoryRow(index: number, response: ToolResponseBlock): IContent {
  if (index === 1) return { speaker: 'ai', blocks: [] };
  if (index === 2) return { speaker: 'tool', blocks: [response] };
  return detachedRow(index, 64);
}

function ownersFrom(start: number, count: number): string[] {
  return Array.from(
    { length: count - start },
    (_, offset) => OWNERS[(start + offset) % OWNERS.length],
  );
}

describe('compression modules on the journal store keep the owner of every row they retain', () => {
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-owners-'));
  });

  afterEach(async () => {
    for (const journal of opened.splice(0)) await journal.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it.each(SIZES)(
    'provider fallback over %i rows drops a head and keeps the owners of the rest',
    async (count) => {
      const owned = await ownedHistory(count, 'fallback');
      const history = journalBackedHistory(owned);
      await history.detachedValues.withCheckpoint(async (checkpoint) => {
        const rows = await curatedCandidate(checkpointRows(checkpoint));
        try {
          await publishProviderFallbackCandidate(
            history,
            {
              rows,
              start: 1,
              hasPendingRows: false,
              sourceOrdinalAt: (i) => rows.sourceOrdinalAt(i),
            },
            'model',
          );
        } finally {
          rows.close();
        }
      });
      expect(await owned.originsOfRows()).toStrictEqual(ownersFrom(1, count));
      expect(owned.store.getLength()).toBe(count - 1);
    },
  );

  it('writes a candidate row that comes from no history row unowned', async () => {
    const owned = await ownedHistory(4, 'summary');
    const history = journalBackedHistory(owned);
    await history.detachedValues.withCheckpoint(async (checkpoint) => {
      const rows = await curatedCandidate(checkpointRows(checkpoint));
      try {
        rows.append({
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'new summary' }],
        });
        await publishProviderFallbackCandidate(
          history,
          {
            rows,
            start: 3,
            hasPendingRows: false,
            sourceOrdinalAt: (i) => rows.sourceOrdinalAt(i),
          },
          'model',
        );
      } finally {
        rows.close();
      }
    });
    expect(await owned.originsOfRows()).toStrictEqual(['agent-b', undefined]);
  });

  it.each(SIZES)(
    'top-down truncation over %i rows keeps the owners of the retained tail',
    async (count) => {
      const owned = await ownedHistory(count, 'truncation');
      const history = journalBackedHistory(owned);
      await history.detachedValues.withCheckpoint(async (checkpoint) => {
        const curated = await curatedCandidate(checkpointRows(checkpoint));
        try {
          await publishCandidate(
            history,
            { rows: () => checkpointRows(checkpoint) },
            curated,
            2,
            'model',
            0,
            {},
            (position) => curated.sourceOrdinalAt(position),
          );
        } finally {
          curated.close();
        }
      });
      expect(await owned.originsOfRows()).toStrictEqual(ownersFrom(2, count));
    },
  );

  it.each(SIZES)(
    'top-down truncation over %i rows writes its summary under the origin the operation names',
    async (count) => {
      const owned = await ownedHistory(count, 'origin');
      const origin = {};
      const history = journalBackedHistory(owned);
      await history.detachedValues.withCheckpoint(async (checkpoint) => {
        const curated = await curatedCandidate(checkpointRows(checkpoint));
        try {
          curated.append({
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'new summary' }],
            metadata: { isSummary: true },
          });
          const summary = await publishCandidate(
            history,
            { rows: () => checkpointRows(checkpoint) },
            curated,
            count - 2,
            'model',
            0,
            { origin },
            (position) => curated.sourceOrdinalAt(position),
          );
          expect(summary?.metadata?.isSummary).toBe(true);
        } finally {
          curated.close();
        }
      });
      expect(await owned.originsOfRows()).toStrictEqual([
        ...ownersFrom(count - 2, count),
        historyOriginId(origin),
      ]);
    },
  );

  it('keeps the owners of the rows after a non-curated row the candidate leaves out', async () => {
    const owned = await openOwnedJournal(path.join(directory, 'gap.llxj'), [
      { content: detachedRow(0, 64), origin: 'agent-a' },
      { content: { speaker: 'ai', blocks: [] }, origin: 'agent-a' },
      { content: detachedRow(2, 64), origin: 'agent-b' },
      { content: detachedRow(3, 64), origin: 'agent-a' },
    ]);
    opened.push(owned);
    const history = journalBackedHistory(owned);
    await history.detachedValues.withCheckpoint(async (checkpoint) => {
      const rows = await curatedCandidate(checkpointRows(checkpoint));
      try {
        // The empty ai row is not curated, so candidate row 1 is history row 2.
        expect(rows.length).toBe(3);
        await publishProviderFallbackCandidate(
          history,
          {
            rows,
            start: 1,
            hasPendingRows: false,
            sourceOrdinalAt: (i) => rows.sourceOrdinalAt(i),
          },
          'model',
        );
      } finally {
        rows.close();
      }
    });
    expect(await owned.originsOfRows()).toStrictEqual(['agent-b', 'agent-a']);
  });

  it.each(SIZES)(
    'publishing the selected tool responses of %i rows keeps every owner, across empty rows',
    async (count) => {
      const response: ToolResponseBlock = {
        type: 'tool_response',
        callId: 'call-1',
        toolName: 'read',
        result: 'big',
      };
      const owned = await openOwnedJournal(
        path.join(directory, `selected-${count}.llxj`),
        Array.from({ length: count }, (_, index) => ({
          content: toolHistoryRow(index, response),
          origin: OWNERS[index % OWNERS.length],
        })),
      );
      opened.push(owned);
      const history = journalBackedHistory(owned);
      const ranking = new ToolResponseDiskRanking([]);
      try {
        await ranking.capture(
          { streamRawHistory: () => owned.store.streamRows() },
          () => Promise.resolve(10),
        );
        expect(ranking.take()).toBeDefined();
        const replaced = await publishSelectedToolResponses(
          history,
          ranking,
          (block) => ({ ...block, result: 'stub' }),
          'model',
        );
        expect(replaced).toBe(1);
      } finally {
        ranking.close();
      }
      expect(await owned.originsOfRows()).toStrictEqual(
        ownersFrom(0, count).filter((_, index) => index !== 1),
      );
    },
  );

  it.each(SIZES)(
    'replacing one tool response in %i rows keeps every owner, across empty rows',
    async (count) => {
      const response: ToolResponseBlock = {
        type: 'tool_response',
        callId: 'call-1',
        toolName: 'read',
        result: 'big',
      };
      const owned = await openOwnedJournal(
        path.join(directory, `tools-${count}.llxj`),
        Array.from({ length: count }, (_, index) => ({
          content: toolHistoryRow(index, response),
          origin: OWNERS[index % OWNERS.length],
        })),
      );
      opened.push(owned);
      const history = journalBackedHistory(owned);
      const replaced = await replaceRankedToolResponse(
        history,
        {
          historyLength: count - 1,
          location: 'history',
          entryIndex: 1,
          blockIndex: 0,
          block: response,
          estimatedTokens: 1,
        },
        { ...response, result: 'stub' },
        'model',
      );
      expect(replaced).toBe(true);
      // The empty row is dropped by the rewrite; every other row keeps its owner.
      expect(await owned.originsOfRows()).toStrictEqual(
        ownersFrom(0, count).filter((_, index) => index !== 1),
      );
    },
  );
});
