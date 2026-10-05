import { forbidHistoryMaterializationForTest } from '../../test-utils/history-materialization-test-guard.js';
import { withCuratedHistoryForTest } from '../../test-utils/curated-history-fixture.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRowCounters } from '../../recording/journalCounters.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

const human = (text: string): IContent => ({
  speaker: 'human',
  blocks: [{ type: 'text', text }],
});
const ai = (text: string): IContent => ({
  speaker: 'ai',
  blocks: [{ type: 'text', text }],
});
const tool = (): IContent => ({
  speaker: 'tool',
  blocks: [{ type: 'tool_response', callId: 'c', toolName: 't', result: 1 }],
});

describe('bounded curated journal queries', () => {
  for (const size of [512, 8192]) {
    it(`matches the independent eager oracle for ${size} rows`, async () => {
      const counters = createRowCounters();
      const service = new HistoryService({
        attachmentCounters: counters.counters,
      });
      try {
        const rows = Array.from({ length: size }, (_, index): IContent => {
          if (index % 7 === 0) return human(`question-${index}`);
          if (index % 7 === 1) return tool();
          if (index % 7 === 2) return ai('');
          return ai(`answer-${index}`);
        });
        await service.addBatch(rows, 'test');
        await withCuratedHistoryForTest(service, async (oracle) => {
          const incoming: IContent[] = oracle.map((row) => ({
            speaker: row.speaker,
            blocks: row.blocks,
            metadata: { turnId: 'provider-only' },
          }));
          const restoreMaterialization = forbidHistoryMaterializationForTest(
            service,
            'eager curated history',
          );
          try {
            expect(await service.countCuratedRows()).toBe(oracle.length);
            expect(await service.matchingCuratedPrefix(incoming)).toBe(
              oracle.length,
            );
            const altered = [...incoming];
            altered[3] = ai('mismatch');
            expect(await service.matchingCuratedPrefix(altered)).toBe(3);
            expect(
              await service.matchingCuratedPrefix(incoming.slice(0, 2)),
            ).toBe(2);
            expect(await service.matchingCuratedPrefix([])).toBe(0);
            expect(counters.snapshot().peakDecodedRows).toBe(1);
          } finally {
            restoreMaterialization();
          }
        });
      } finally {
        service.dispose();
      }
    });
  }
});

describe('curated journal query cursor ownership', () => {
  it('closes the journal cursor on mismatch, input exhaustion, and full scan', async () => {
    const counters = createRowCounters();
    let activeRows = 0;
    const service = new HistoryService({
      attachmentCounters: {
        ...counters.counters,
        rowDecoded: () => {
          activeRows += 1;
          counters.counters.rowDecoded();
        },
        rowReleased: () => {
          activeRows -= 1;
          counters.counters.rowReleased();
        },
      },
    });
    try {
      await service.addBatch(
        [human('first'), ai(''), tool(), ai('last')],
        'test',
      );
      expect(await service.matchingCuratedPrefix([human('wrong')])).toBe(0);
      expect(activeRows).toBe(0);
      expect(await service.matchingCuratedPrefix([human('first')])).toBe(1);
      expect(activeRows).toBe(0);
      expect(await service.countCuratedRows()).toBe(3);
      expect(activeRows).toBe(0);
      expect(
        await service.matchingCuratedPrefix([
          human('first'),
          tool(),
          ai('last'),
          human('extra'),
        ]),
      ).toBe(3);
      expect(activeRows).toBe(0);
      expect(counters.snapshot().peakDecodedRows).toBe(1);
    } finally {
      service.dispose();
    }
  });
});

describe('curated journal query failure and eager-read guards', () => {
  it('releases previous rows when journal reading fails', async () => {
    let activeRows = 0;
    let decoded = 0;
    const service = new HistoryService({
      attachmentCounters: {
        recordDecoded: () => {},
        rowDecoded: () => {
          decoded += 1;
          if (decoded === 2) throw new Error('decode failure');
          activeRows += 1;
        },
        rowReleased: () => {
          activeRows -= 1;
        },
      },
    });
    try {
      await service.addBatch([human('first'), human('second')], 'test');
      await expect(service.countCuratedRows()).rejects.toThrow(
        'decode failure',
      );
      expect(decoded).toBe(2);
      expect(activeRows).toBe(0);
    } finally {
      service.dispose();
    }
  });

  it('rejects eager materialization and generators that cache the entire history', () => {
    const source = readFileSync(
      new URL('./HistoryService.ts', import.meta.url),
      'utf8',
    );
    const count = source.split('async countCuratedRows(')[1]?.split('\n  }')[0];
    const prefix = source
      .split('async matchingCuratedPrefix(')[1]
      ?.split('\n  }')[0];
    const rows = source
      .split('async *streamCuratedHistory(')[1]
      ?.split('\n  }')[0];
    expect(count).toBeDefined();
    expect(prefix).toBeDefined();
    expect(rows).toBeDefined();
    const eagerRead =
      /getCurated\s*\(|materializeHistory\s*\(|getAll\s*\(|Array\.fromAsync\s*\(|\.toArray\s*\(|\.push\s*\(|\.concat\s*\(|=\s*\[|yield\s*\*/;
    for (const body of [count, prefix, rows]) {
      expect(body).not.toMatch(eagerRead);
    }
    const fakeCachingGenerator = `
      const cached: IContent[] = [];
      for await (const row of this.journal.streamRows()) cached.push(row);
      for (const row of cached) yield row;
    `;
    expect(fakeCachingGenerator).toMatch(eagerRead);
    expect(rows).toContain('this.journal.streamRows(undefined, signal)');
  });
});
