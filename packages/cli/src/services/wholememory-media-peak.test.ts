/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RowOwnership } from '../../../core/src/recording/rowOwnership.js';
import { isMediaReferenceBlock } from '../../../core/src/services/history/IContent.js';
import { MemoryCommand } from './wholememory-command.js';
import {
  type MemoryWorkload,
  writeMemoryFixture,
} from './wholememory-fixture.js';

class RetainingMediaConsumer extends RowOwnership {
  private readonly retained: object[] = [];

  override retain(row: object): void {
    super.retain(row);
    if (isMediaReferenceBlock(row)) {
      super.retain(row);
      this.retained.push(row);
    }
  }

  releaseConsumer(): void {
    for (const reference of this.retained) super.release(reference);
    this.retained.length = 0;
  }
}

describe('bounded media ownership', () => {
  it('rejects media retained by a consumer after the real dense command closes', async () => {
    const directory = await mkdtemp(
      join(process.cwd(), 'tmp/verify854/p05d/mediapeak-consumer-'),
    );
    const ownership = new RetainingMediaConsumer();
    const command = new MemoryCommand(ownership);
    try {
      try {
        await writeMemoryFixture(directory, 512, 'media-dense');
        await command.run(directory, 512, 'media-dense', 'latest');
      } finally {
        await command.close();
      }
      await writeFile(
        'tmp/verify854/p05d/mediapeak-command-retaining-control.json',
        JSON.stringify(ownership.snapshot(), null, 2),
      );
      expect(ownership.snapshot().liveRows).toBeGreaterThan(440);
      expect(
        ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(false);
    } finally {
      ownership.releaseConsumer();
      await rm(directory, { recursive: true, force: true });
    }
    expect(ownership.snapshot().liveRows).toBe(0);
  }, 600000);
  const cases: ReadonlyArray<readonly [number, MemoryWorkload]> = [
    [512, 'media'],
    [8192, 'media'],
    [512, 'media-dense'],
    [2048, 'media-dense'],
  ];
  for (const [count, workload] of cases) {
    it(`bounds real ${workload} continuation with ${count} rows`, async () => {
      const directory = await mkdtemp(
        join(process.cwd(), 'tmp/verify854/p05d/mediapeak-fixture-'),
      );
      const ownership = new RowOwnership();
      const command = new MemoryCommand(ownership);
      try {
        await writeMemoryFixture(directory, count, workload);
        await command.run(directory, count, workload, 'latest');
        await writeFile(
          `tmp/verify854/p05d/mediapeak-command-${workload}-${count}.json`,
          JSON.stringify(
            {
              ownership: ownership.snapshot(),
              reader: command.counters.snapshot(),
            },
            null,
            2,
          ),
        );
        expect(
          ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
      } finally {
        await command.close();
        await rm(directory, { recursive: true, force: true });
        expect(ownership.snapshot().liveRows).toBe(0);
      }
    }, 600000);
  }
});
