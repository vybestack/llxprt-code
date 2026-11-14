/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export function assertHistorySettled(
  actual: number,
  expected: number,
  doing: string,
): void {
  if (actual !== expected)
    throw new Error(`History changed while it was being ${doing}`);
}
import {
  openJournalResponseArrival,
  type ResponseArrival,
} from './history-response-arrival.js';
import type { JournalOwners } from './journalOwners.js';
import type { IContent } from './IContent.js';
import type { ArrivalAttempt } from '../../journal/arrival-group.js';
import type { ArrivalStore } from '../../journal/arrival-group.js';
import type { JournalStore } from '../../journal/journalStore.js';
import type { CommitAck } from '../../journal/groupWriter.js';
import type { EditBuilder } from './journalPublication.js';

export function responseArrivalOpener(
  host: Parameters<typeof openStoreResponseArrival>[0],
): (
  content: IContent,
  attempt: ArrivalAttempt,
  origin?: string,
) => Promise<ResponseArrival> {
  return (content, attempt, origin) =>
    openStoreResponseArrival(host, content, attempt, origin);
}
export function assertArrivalRowDelta(added: number): void {
  if (added !== 0 && added !== 1)
    throw new Error('Arrival changed more than one context row');
}
export async function openStoreResponseArrival(
  host: Parameters<typeof journalArrivalAdapter>[0] & {
    owners(): JournalOwners;
  },
  content: IContent,
  attempt: ArrivalAttempt,
  origin?: string,
): Promise<ResponseArrival> {
  const owner = await host.exclusive(async () => {
    const resolved = await host.owners().resolve(origin);
    await host.commit(async () => [
      ...resolved.edits,
      { kind: 'append', rows: [] },
    ]);
    return resolved.id;
  });
  return openJournalResponseArrival(
    journalArrivalAdapter(host),
    content,
    owner,
    attempt,
  );
}

export function journalArrivalAdapter(host: {
  store(): JournalStore;
  exclusive<T>(run: () => Promise<T>): Promise<T>;
  commit(build: EditBuilder): Promise<CommitAck>;
}): ArrivalStore {
  const store = host.store();
  return {
    pin: () => store.pin(),
    // Text is delta-only at this seam, so admission needs no stored prefix.
    readRecordingField: (block, name) =>
      name === 'text'
        ? Promise.resolve(undefined)
        : store.readRecordingField(block, name),
    mutateRecording: (build) =>
      host.exclusive(async () => {
        if (host.store() !== store)
          throw new Error('Response arrival primary changed');
        let result:
          | { value: Awaited<ReturnType<typeof build>>['value'] }
          | undefined;
        const ack = await host.commit(async () => [
          {
            kind: 'prepared',
            admission: [{ kind: 'append', rows: [] }],
            prepare: (group) =>
              group.recordArrival(async (context, appender) => {
                const mutation = await build(context, appender);
                result = { value: mutation.value };
                return mutation.built;
              }),
          },
        ]);
        if (result === undefined)
          throw new Error('Arrival mutation produced no result');
        return { value: result.value, ack };
      }),
  };
}
