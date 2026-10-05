/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRowCounters } from '../../recording/journalCounters.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { HistoryService } from './HistoryService.js';
import type { IContent, ToolCallBlock } from './IContent.js';

function call(id: string, name = `tool-${id}`): ToolCallBlock {
  return { type: 'tool_call', id, name, parameters: { value: id } };
}
function calls(...blocks: ToolCallBlock[]): IContent {
  return { speaker: 'ai', blocks };
}
function response(callId: string): IContent {
  return {
    speaker: 'tool',
    blocks: [{ type: 'tool_response', callId, toolName: 'tool', result: null }],
  };
}
async function collect(
  source: AsyncIterable<ToolCallBlock>,
): Promise<ToolCallBlock[]> {
  const result: ToolCallBlock[] = [];
  for await (const block of source) result.push(block);
  return result;
}

describe('unmatched tool call cursor', () => {
  it('suppresses duplicate response IDs and yields first unmatched calls in block order across speakers', async () => {
    const service = new HistoryService();
    try {
      await service.addBatch([
        response('future'),
        calls(call('a'), call('done'), call('b')),
        { speaker: 'human', blocks: [call('human')] },
        response('done'),
        calls(call('a', 'duplicate'), call('future'), call('c')),
        response('done'),
        calls(call('')),
        response(''),
      ]);
      expect(await collect(service.findUnmatchedToolCalls())).toStrictEqual([
        call('a'),
        call('b'),
        call('human'),
        call('c'),
        call(''),
      ]);
    } finally {
      service.dispose();
    }
  });
});

describe('unmatched tool call cursor ownership', () => {
  for (const size of [512, 8192]) {
    it(`drains ${size} calls in pages with one live output and no read-ahead while paused`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'pairing-test-'));
      const ownership = new RowOwnership();
      const counters = createRowCounters();
      const service = new HistoryService({
        attachmentCounters: { ...counters.counters, ownership },
      });
      try {
        await service.addBatch(
          Array.from({ length: size }, (_, index) =>
            calls(call(String(index))),
          ),
        );
        const cursor = service.findUnmatchedToolCalls({ root, ownership });
        expect(readdirSync(root)).toHaveLength(0);
        let index = 0;
        for await (const block of cursor) {
          expect(block.id).toBe(String(index));
          expect(ownership.snapshot().liveRows).toBe(1);
          expect(ownership.snapshot().peakRows).toBe(1);
          await Promise.resolve();
          expect(ownership.snapshot().acquisitions).toBe(size + index + 1);
          index += 1;
        }
        expect(index).toBe(size);
        expect(counters.snapshot().rowsDecoded).toBe(size);
        expect(counters.snapshot().peakDecodedRows).toBe(1);
        expect(
          ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
        expect({
          liveRows: ownership.snapshot().liveRows,
          diskEntries: readdirSync(root).length,
        }).toStrictEqual({ liveRows: 0, diskEntries: 0 });
      } finally {
        service.dispose();
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

describe('unmatched tool call cursor snapshot', () => {
  it('does not yield a call matched by the last row and fixes the snapshot at first next', async () => {
    const service = new HistoryService();
    try {
      await service.addBatch([
        calls(call('late'), call('open')),
        response('late'),
      ]);
      const cursor = service.findUnmatchedToolCalls();
      const first = await cursor.next();
      expect(first.value?.id).toBe('open');
      await service.addBatch([calls(call('new'))]);
      expect(await cursor.next()).toStrictEqual({
        done: true,
        value: undefined,
      });
    } finally {
      service.dispose();
    }
  });
});

describe('unmatched tool call cursor lifecycle', () => {
  it('closes disk state and output owners on early return and consumer failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pairing-test-'));
    const ownership = new RowOwnership();
    const service = new HistoryService();
    try {
      await service.addBatch([calls(call('a'), call('b'))]);
      const cursor = service.findUnmatchedToolCalls({ root, ownership });
      await cursor.next();
      expect(readdirSync(root)).toHaveLength(1);
      expect(ownership.snapshot().liveRows).toBe(1);
      await cursor.return();
      const afterReturn = {
        liveRows: ownership.snapshot().liveRows,
        diskEntries: readdirSync(root).length,
      };
      await expect(
        (async (): Promise<void> => {
          for await (const block of service.findUnmatchedToolCalls({
            root,
            ownership,
          })) {
            throw new Error(`consumer failed at ${block.id}`);
          }
        })(),
      ).rejects.toThrow('consumer failed at a');
      expect({
        afterReturn,
        afterFailure: {
          liveRows: ownership.snapshot().liveRows,
          diskEntries: readdirSync(root).length,
        },
      }).toStrictEqual({
        afterReturn: { liveRows: 0, diskEntries: 0 },
        afterFailure: { liveRows: 0, diskEntries: 0 },
      });
    } finally {
      service.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('unmatched tool call cursor failures', () => {
  it('cleans up on a journal failure without yielding a premature match', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pairing-test-'));
    const ownership = new RowOwnership();
    let reads = 0;
    const service = new HistoryService({
      attachmentCounters: {
        recordDecoded: () => {},
        rowDecoded: () => {
          reads += 1;
          if (reads === 2) throw new Error('read failure');
        },
        rowReleased: () => {},
        ownership,
      },
    });
    try {
      await service.addBatch([calls(call('a')), response('a')]);
      await expect(
        service.findUnmatchedToolCalls({ root, ownership }).next(),
      ).rejects.toThrow('read failure');
      expect(reads).toBe(2);
      expect(ownership.snapshot().liveRows).toBe(0);
      expect(readdirSync(root)).toHaveLength(0);
    } finally {
      service.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
