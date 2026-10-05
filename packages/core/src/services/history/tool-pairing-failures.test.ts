/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

function row(id: string): IContent {
  return {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id,
        name: 'tool',
        parameters: { unique: id, payload: id + 'x'.repeat(16384) },
        description: 'preserve description',
        providerMetadata: { signature: `sig-${id}` },
      },
    ],
  };
}

describe('tool pairing payload ownership', () => {
  it('preserves complete tool call JSON bytes and rejects a retaining-owner trap at both fixture sizes', async () => {
    for (const size of [512, 8192]) {
      const ownership = new RowOwnership();
      const service = new HistoryService({
        attachmentCounters: {
          recordDecoded: () => {},
          rowDecoded: () => {},
          rowReleased: () => {},
          ownership,
        },
      });
      try {
        await service.addBatch(
          Array.from({ length: size }, (_, index) => row(String(index))),
        );
        const cursor = service.findUnmatchedToolCalls({ ownership });
        const first = await cursor.next();
        expect(JSON.stringify(first.value)).toBe(
          JSON.stringify(row('0').blocks[0]),
        );
        await cursor.return();
        expect(ownership.snapshot().liveRows).toBe(0);
        expect(ownership.snapshot().peakRows).toBe(1);
        expect(
          ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
        const trap = new RowOwnership();
        const retained = Array.from({ length: size }, (_, index) =>
          row(String(index)),
        );
        for (const content of retained) trap.retain(content);
        expect(
          trap.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(false);
        expect(trap.snapshot().peakSerializedBytes).toBeGreaterThan(
          8 * 1024 * 1024,
        );
        for (const content of retained) trap.release(content);
      } finally {
        service.dispose();
      }
    }
  });
});

describe('tool pairing disk read failure', () => {
  it('cleans up and propagates corrupt FIFO reads after a paused yield', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pairing-test-'));
    const ownership = new RowOwnership();
    const service = new HistoryService();
    try {
      await service.addBatch([row('a'), row('b')]);
      const cursor = service.findUnmatchedToolCalls({ root, ownership });
      await cursor.next();
      const directory = readdirSync(root)[0];
      writeFileSync(join(root, directory, 'call-1'), '{');
      await expect(cursor.next()).rejects.toThrow(/JSON|Expected|property/i);
      expect(ownership.snapshot().liveRows).toBe(0);
      expect(readdirSync(root)).toHaveLength(0);
    } finally {
      service.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('tool pairing disk write failure', () => {
  it('closes the captured journal when disk writes fail during indexing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pairing-test-'));
    const ownership = new RowOwnership();
    let reads = 0;
    const service = new HistoryService({
      attachmentCounters: {
        recordDecoded: () => {},
        rowReleased: () => {},
        ownership,
        rowDecoded: () => {
          reads += 1;
          if (reads === 2)
            rmSync(join(root, readdirSync(root)[0]), { recursive: true });
        },
      },
    });
    try {
      await service.addBatch([row('a'), row('b')]);
      await expect(
        service.findUnmatchedToolCalls({ root, ownership }).next(),
      ).rejects.toThrow('ENOENT');
      expect(ownership.snapshot().liveRows).toBe(0);
      expect(readdirSync(root)).toHaveLength(0);
    } finally {
      service.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('tool pairing empty cursors', () => {
  it('opens no disk state on an unstarted return and yields nothing for fully responded history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pairing-test-'));
    const service = new HistoryService();
    try {
      const cursor = service.findUnmatchedToolCalls({ root });
      await cursor.return();
      const unstartedDiskEntries = readdirSync(root).length;
      service.add(row('a'));
      service.add({
        speaker: 'tool',
        blocks: [
          { type: 'tool_response', callId: 'a', toolName: 'tool', result: 1 },
        ],
      });
      expect(
        await service.findUnmatchedToolCalls({ root }).next(),
      ).toStrictEqual({
        done: true,
        value: undefined,
      });
      expect({
        unstartedDiskEntries,
        exhaustedDiskEntries: readdirSync(root).length,
      }).toStrictEqual({ unstartedDiskEntries: 0, exhaustedDiskEntries: 0 });
    } finally {
      service.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
