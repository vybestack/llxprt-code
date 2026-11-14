/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  JournalDisplayWriter,
  type JournalDisplayDescriptor,
} from '../../journal/display-recording.js';
import type { ArrivalRow, ArrivalStore } from '../../journal/arrival-group.js';
import type { journalArrivalAdapter } from './journal-arrival-adapter.js';
import type { JournalOwners } from './journalOwners.js';
import type { JournalStore } from '../../journal/journalStore.js';

export interface JournalDisplayHandle extends ArrivalRow {
  readonly origin?: string;
}

export interface JournalDisplayCommands {
  append(
    descriptor: JournalDisplayDescriptor,
    source: string | AsyncIterable<string>,
    origin?: string,
  ): Promise<JournalDisplayHandle>;
  retract(row: JournalDisplayHandle): Promise<void>;
}

type DisplayHost = Parameters<typeof journalArrivalAdapter>[0] & {
  owners(): JournalOwners;
  target(origin: string | undefined): Promise<JournalStore>;
};

function displayStore(host: DisplayHost, store: JournalStore): ArrivalStore {
  return {
    pin: () => store.pin(),
    readRecordingField: (block, field) =>
      store.readRecordingField(block, field),
    mutateRecording: (build) =>
      host.exclusive(() => store.mutateRecording(build)),
  };
}

export function journalDisplayCommands(
  host: DisplayHost,
): JournalDisplayCommands {
  return {
    async append(descriptor, source, origin): Promise<JournalDisplayHandle> {
      const target = await host.exclusive(async () => {
        const owner = await host.owners().resolve(origin);
        await host.commit(async () => [
          ...owner.edits,
          { kind: 'append', rows: [] },
        ]);
        return host.target(origin);
      });
      const writer = new JournalDisplayWriter(displayStore(host, target));
      const row = await writer.append(descriptor, source);
      await target.flushCommitted();
      return { ...row, origin };
    },
    async retract(row): Promise<void> {
      const target = await host.exclusive(() => host.target(row.origin));
      await new JournalDisplayWriter(displayStore(host, target)).retract(row);
      await target.flushCommitted();
    },
  };
}
