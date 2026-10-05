/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { withSynchronousFixture } from './synchronous-ticket-test-helpers.js';
import { batchRow } from './addbatch-stream-test-helpers.js';

function ticketFiles(): string[] {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith('history-value-ticket-'))
    .sort();
}

function expectRetired(before: string[]): void {
  expect(ticketFiles()).toStrictEqual(before);
}

describe('synchronous ticket durable retirement', () => {
  it('retires idle value spools only after durable acknowledgement while allowing later adds', async () => {
    const before = ticketFiles();
    await withSynchronousFixture(async (fixture) => {
      fixture.pauseWriter();
      fixture.history.add(batchRow(0));
      await fixture.waitForPausedWrite;
      expect(ticketFiles().length).toBeGreaterThan(before.length);
      fixture.releaseWriter();
      await fixture.history.waitForCommit();
      await fixture.history.waitForTokenUpdates();
      expectRetired(before);
      fixture.history.add(batchRow(1));
      await fixture.history.waitForCommit();
      await fixture.history.waitForTokenUpdates();
      let ordinal = 0;
      for await (const row of fixture.history.streamRawHistory()) {
        expect(row.blocks).toStrictEqual(batchRow(ordinal++).blocks);
      }
      expect(ordinal).toBe(2);
      expectRetired(before);
    });
  });
});
