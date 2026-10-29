/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach } from 'bun:test';
import { join } from 'node:path';
import { useTempDir } from '../../../../journal/__tests__/support/useTempDir.js';
import { loadFlushRecords } from '../../../../journal/flushRecords.js';
import { sha256KeyHash } from '../../../../journal/idKeys.js';
import { openJournalReadOnly } from '../../../../journal/journalReader.js';
import { stateReaderOf } from '../../../../journal/journalReaderState.js';
import { ownerKey } from '../../../../journal/ownerDictionary.js';
import { readStoredRow } from '../../../../journal/rowReads.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '../../../../journal/rowTreeReader.js';
import { JournalRecordingService } from '../../../../recording/journalRecordingService.js';
import { RecordingIntegration } from '../../../../recording/RecordingIntegration.js';
import type { SessionRecordingPort } from '../../../../recording/recordingPort.js';
import { HistoryService } from '../../HistoryService.js';
import type { IContent } from '../../IContent.js';
import { decodeStoredRow } from '../../journalRowCodec.js';

export interface PersistedMutationRow {
  readonly content: IContent;
  readonly origin: string | undefined;
}

export interface ObservedRecorder {
  readonly recording: JournalRecordingService;
  readonly integration: RecordingIntegration;
  readonly origin: object;
  flushes(): number;
}

export async function persistedMutationRows(
  recording: SessionRecordingPort,
): Promise<PersistedMutationRow[]> {
  const path = recording.getFilePath();
  if (path === null) throw new Error('Recorder has no native file');
  const reader = await openJournalReadOnly(path);
  try {
    const root = rowTreeRootOf(reader.trailer);
    const rows: PersistedMutationRow[] = [];
    if (root === undefined) return rows;
    const readState = stateReaderOf(reader, sha256KeyHash);
    for await (const entry of iterateRowEntries(reader, root)) {
      const storedOrigin =
        entry.owner === 0 ? undefined : await readState(ownerKey(entry.owner));
      if (entry.owner !== 0 && storedOrigin === undefined)
        throw new Error(`Missing persisted owner ${entry.owner}`);
      rows.push({
        content: decodeStoredRow(await readStoredRow(reader, entry)),
        origin:
          storedOrigin === undefined
            ? undefined
            : new TextDecoder().decode(storedOrigin),
      });
    }
    return rows;
  } finally {
    await reader.close();
  }
}

export function mutationText(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

export function useServiceRecorderMutations(): {
  history(): HistoryService;
  recorder(name: string): Promise<ObservedRecorder>;
} {
  const directory = useTempDir('service-recorder-mutations-');
  const resources: Array<{ dispose(): Promise<void> }> = [];
  afterEach(async () => {
    for (const resource of resources.splice(0).reverse())
      await resource.dispose();
  });
  return {
    history: () => {
      const history = new HistoryService({});
      resources.push(history);
      return history;
    },
    recorder: async (name) => {
      const flush = await loadFlushRecords();
      let flushes = 0;
      const recording = JournalRecordingService.create({
        sessionId: `service-mutations-${name}`,
        projectHash: 'service-mutations',
        chatsDir: join(directory(), 'chats'),
        workspaceDirs: ['/work'],
        provider: 'anthropic',
        model: 'model-1',
        journal: {
          journal: {
            flush: (fd) => {
              flush(fd);
              flushes++;
            },
          },
        },
      });
      const integration = new RecordingIntegration(recording);
      resources.push(recording, integration);
      return { recording, integration, origin: {}, flushes: () => flushes };
    },
  };
}
