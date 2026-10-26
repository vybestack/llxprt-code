/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '../packages/core/src/services/history/HistoryService.js';
import type { IContent } from '../packages/core/src/services/history/IContent.js';
import type { JournalSession } from '../packages/core/src/services/history/journalSession.js';
import type { NativeRecordingProbe } from '../packages/core/src/storage/native-recording-probe.test-support.js';
import { encodeContentRow } from '../packages/core/src/services/history/journalRowCodec.js';

async function* acceptedProbeRow(
  history: HistoryService,
): AsyncGenerator<IContent, void, unknown> {
  let count = 0;
  for await (const row of history.streamRawHistory()) {
    count++;
    if (count > 1)
      throw new Error('Media probe requires exactly one history row');
    yield row;
  }
  if (count !== 1)
    throw new Error('Media probe requires exactly one history row');
}

export async function saveMediaProbeHistory(
  history: HistoryService,
  session: JournalSession,
  probe: NativeRecordingProbe,
  observePendingRow?: () => Promise<void>,
): Promise<number> {
  async function* rows() {
    for await (const row of acceptedProbeRow(history))
      yield encodeContentRow(row, { owner: 0 });
  }
  const write = async (): Promise<void> => {
    await session.store.commit([{ kind: 'replace', rows: rows() }]);
  };
  if (observePendingRow === undefined) await write();
  else await probe.measureWrite(write, observePendingRow);
  return 1;
}

export async function countMediaProbeHistory(
  history: HistoryService,
): Promise<number> {
  let count = 0;
  for await (const row of history.streamRawHistory()) {
    void row;
    count++;
  }
  return count;
}
