/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { JournalStore } from './journalStore.js';
import { MirrorFanout } from './mirrorFanout.js';
import { JOURNAL_HEADER_BYTES } from './fileHeader.js';
import { FRAME_HEAD_BYTES } from './frame.js';
import { RECORD_KIND } from './recordKinds.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

async function countNodes(path: string): Promise<number> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const bytes = Buffer.alloc(FRAME_HEAD_BYTES);
    let count = 0;
    for (let offset = JOURNAL_HEADER_BYTES; offset < size; ) {
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset);
      expect(bytesRead).toBe(bytes.length);
      if (bytes[0] === RECORD_KIND.RTNODE) count++;
      offset += 24 + bytes.readUInt32LE(4) + Number(bytes.readBigUInt64LE(8));
    }
    return count;
  } finally {
    await handle.close();
  }
}

function treeNodes(rows: number): number {
  let count = 0;
  for (let level = Math.ceil(rows / 8); ; level = Math.ceil(level / 8)) {
    count += level;
    if (level === 1) return count;
  }
}

describe('recording mirror rebuild cost', () => {
  const directory = useTempDir('mirror-rebuild-cost-');
  it.each([512, 8192])(
    'builds each plain %i-row tree once with one commit and flush per file',
    async (rows) => {
      const primaryPath = join(directory(), `primary-${rows}.llxj`);
      const mirrorPath = join(directory(), `mirror-${rows}.llxj`);
      const primarySeams = testJournalSeams({ recordKinds: true });
      const mirrorSeams = testJournalSeams({ recordKinds: true });
      const primary = await JournalStore.create(
        primaryPath,
        storeDeps({ seams: primarySeams }),
      );
      const mirror = await JournalStore.create(
        mirrorPath,
        storeDeps({ seams: mirrorSeams }),
      );
      const fanout = new MirrorFanout(primary);
      try {
        await fanout.attach(mirror, 0);
        const before = [primarySeams.events.length, mirrorSeams.events.length];
        await fanout.commit([
          {
            kind: 'replace',
            rows: (function* () {
              for (let index = 0; index < rows; index++)
                yield draftRow({ text: `row ${index}` });
            })(),
          },
        ]);
        await fanout.flush();
        for (const [index, seams] of [primarySeams, mirrorSeams].entries()) {
          const events = seams.events.slice(before[index]);
          expect(events.filter((event) => event.type === 'flush').length).toBe(
            1,
          );
          expect(
            events.filter(
              (event) =>
                event.type === 'write' && event.kind === RECORD_KIND.TRAILER,
            ).length,
          ).toBe(1);
          expect(
            events.filter((event) => event.type === 'write').length,
          ).toBeLessThan(rows);
        }
        expect(primary.published?.rows).toBe(rows);
        expect(mirror.published?.rows).toBe(rows);
        expect(primary.published?.aggregate.units).toBe(rows);
        expect(mirror.published?.aggregate.units).toBe(rows);
        const primaryNodes = await countNodes(primaryPath);
        const mirrorNodes = await countNodes(mirrorPath);
        expect(primaryNodes).toBe(treeNodes(rows));
        expect(mirrorNodes).toBe(treeNodes(rows));
        let seen = 0;
        for await (const entry of mirror.rows()) {
          const row = await mirror.readRow(entry);
          expect(new TextDecoder().decode(row.blocks[0])).toBe(`row ${seen++}`);
        }
        expect(seen).toBe(rows);
        process.stdout.write(
          `MIRROR_REBUILD_COST ${JSON.stringify({ rows, primaryNodes, mirrorNodes })}
`,
        );
      } finally {
        await primary.close();
        await mirror.close();
      }
    },
    180000,
  );
});
