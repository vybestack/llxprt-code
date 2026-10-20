/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createCoreSuffixFixtureGraph } from '@vybestack/llxprt-code-core/services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

export interface JournalSendFixture {
  readonly selection: ProviderRequestSnapshot;
  close(): Promise<void>;
}

export async function journalSendFixture(
  rows: Iterable<IContent>,
): Promise<JournalSendFixture> {
  const parent = join(
    import.meta.dir,
    '../../../../../tmp/854-notes/p4/w23/limits-memory-run-c/fixtures',
  );
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'native-send-'));
  const graph = createCoreSuffixFixtureGraph(
    root,
    undefined,
    (options) => {
      const service = new HistoryService(options);
      forbidHistoryMaterializationForTest(
        service,
        'native send materialized history',
      );
      return service;
    },
    'journal',
  );
  try {
    await graph.seed(rows);
    const selection = await graph.service.prepareCuratedForProviderSnapshot(
      [],
      {
        ownership: graph.ownership,
      },
    );
    return {
      selection,
      async close(): Promise<void> {
        selection.close();
        await graph.service.dispose();
        await graph.recording.dispose();
      },
    };
  } catch (error) {
    await graph.service.dispose();
    await graph.recording.dispose();
    throw error;
  }
}
