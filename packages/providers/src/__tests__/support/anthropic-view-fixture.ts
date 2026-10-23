/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { JournalProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/journal-provider-request.js';
import { nativeRequestResources } from '@vybestack/llxprt-code-core/services/history/native-provider-format.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export async function anthropicViewFixture(
  rows: Iterable<IContent>,
  tail: readonly IContent[],
  change?: { readonly at: number; readonly replacement?: IContent },
): Promise<{
  readonly selection: JournalProviderRequestSnapshot;
  close(): Promise<void>;
}> {
  const parent = `${import.meta.dir}/../../../../../tmp/anthropic-views/fixtures`;
  mkdirSync(parent, { recursive: true });
  const recording = JournalRecordingService.create({
    sessionId: 'anthropic-view',
    projectHash: 'anthropic-view',
    chatsDir: mkdtempSync(`${parent}/session-`),
    workspaceDirs: [],
    provider: 'anthropic',
    model: 'claude-opus-5',
  });
  const history = new HistoryService({ backend: 'journal', recording });
  try {
    await history.addBatch(Array.from(rows));
    await history.waitForCommit();
    const { store } = await recording.session();
    const snapshot = await store.snapshot();
    const label =
      change === undefined
        ? undefined
        : (await snapshot.entryAt(change.at)).label;
    const projection =
      change === undefined
        ? undefined
        : {
            label,
            removedRow: change.replacement === undefined,
            readChangedRow: async (): Promise<IContent> => {
              if (change.replacement === undefined)
                throw new Error('Removed view row cannot be read');
              return change.replacement;
            },
            header: (row: IContent): IContent => row,
          };
    const resources = nativeRequestResources(store);
    const selection = await JournalProviderRequestSnapshot.create(
      snapshot,
      tail,
      {},
      projection,
      () => snapshot.close(),
      resources.prepareRequestFormat,
    );
    return {
      selection,
      async close() {
        await selection.close();
        await history.dispose();
        await recording.dispose();
      },
    };
  } catch (error) {
    await history.dispose();
    await recording.dispose();
    throw error;
  }
}
