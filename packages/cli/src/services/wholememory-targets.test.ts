/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RowOwnership } from '../../../core/src/recording/rowOwnership.js';
import { MemoryCommand } from './__tests__/support/wholememory-command.js';
import { writeMemoryFixture } from './__tests__/support/wholememory-fixture.js';

const sessionId = '85400000-0000-4000-8000-000000000001';
const sessionName = 'acceptance-named-session';

async function targetFixture(directory: string, count: number): Promise<void> {
  await writeMemoryFixture(directory, count, 'plain', {
    sessionId,
    name: sessionName,
  });
}

describe('full command target ownership', () => {
  it.each(['1', sessionName, sessionId])(
    'bounds discovery, adoption and UI ownership for target %s',
    measureTarget,
    600000,
  );
});

async function measureTarget(target: string): Promise<void> {
  for (const count of [512, 2048]) {
    const directory = await mkdtemp(join(tmpdir(), 'acceptance-final-target-'));
    await targetFixture(directory, count);
    const ownership = new RowOwnership();
    const command = new MemoryCommand(ownership);
    try {
      await command.run(directory, count, 'plain', target);
      const reader = command.counters.snapshot();
      await writeFile(
        join(directory, 'report.json'),
        JSON.stringify(
          { target, count, reader, ownership: ownership.snapshot() },
          null,
          2,
        ),
      );
      expect(reader.recordsDecoded).toBeGreaterThan(count);
      expect(reader.rowsDecoded).toBeGreaterThanOrEqual(count);
      expect(reader.peakDecodedRows).toBeLessThanOrEqual(440);
      expect(
        ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      expect(command.recording?.getSessionId()).toBe(sessionId);
    } finally {
      await command.close();
    }
    expect(ownership.snapshot().liveRows).toBe(0);
  }
}
