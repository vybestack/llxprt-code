/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  journalSendFixture,
  type JournalSendFixture,
} from '../../../__tests__/support/journal-send-fixture.js';
import type { ProjectionDiskFixture } from './projection-ownership-fixture.js';

export async function nativeDiskRows(
  disk: ProjectionDiskFixture,
  retain = false,
): Promise<JournalSendFixture> {
  return journalSendFixture({
    *[Symbol.iterator]() {
      for (let index = 0; index < disk.rows.count; index++) {
        const row = disk.rows.readAt(index);
        if (row instanceof Promise)
          throw new Error('Expected synchronous fixture row');
        disk.state.pulled++;
        disk.references.push(new WeakRef(row));
        if (retain) disk.retained.push(row);
        yield row;
      }
    },
  });
}
