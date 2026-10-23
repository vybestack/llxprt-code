/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { streamCuratedProviderHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { JournalProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/journal-provider-request.js';
import { prepareProviderContentSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-curated-stream.js';
import type {
  ProviderRequestRows,
  ProviderRequestSnapshot,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { describe, expect, it } from 'bun:test';
import { exactTokenizer } from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { operationFileCreates } from '../compression/__tests__/support/operation-file-creates.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';
import { streamSemanticPurgeRequest } from './streamRequestHelpers.js';

async function collect(rows: ProviderRequestRows): Promise<IContent[]> {
  const output: IContent[] = [];
  for await (const row of rows.openReader()) output.push(row);
  return output;
}
async function compareIndexed(
  native: ProviderRequestSnapshot,
  old: ProviderRequestSnapshot,
): Promise<void> {
  for (let index = 0; index < native.count; index++) {
    expect(await native.readAt(index)).toStrictEqual(await old.readAt(index));
    expect(native.isPending(index)).toBe(old.isPending(index));
  }
}

describe('native purge request normalization', () => {
  it.each<{ mode: 'remove' | 'summary'; explicit: boolean }>([
    { mode: 'remove', explicit: false },
    { mode: 'remove', explicit: true },
    { mode: 'summary', explicit: false },
    { mode: 'summary', explicit: true },
  ])(
    'matches legacy units and pending membership for %j without scratch',
    async ({ mode, explicit }) => {
      const history = new HistoryService({});
      history.setTokenizerFactory(exactTokenizer());
      try {
        await history.replaceAll([
          {
            speaker: 'ai',
            blocks: [
              { type: 'tool_call', id: 'x', name: 'read', parameters: {} },
            ],
          },
          {
            speaker: 'tool',
            blocks: [
              {
                type: 'media',
                mimeType: 'image/png',
                encoding: 'base64',
                data: 'aW1hZ2U=',
                caption: 'image caption',
              },
              {
                type: 'tool_response',
                callId: 'x',
                toolName: 'read',
                result: 'read result',
              },
            ],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'after' }],
            metadata: { responsesStored: true },
          },
        ]);
        const session = new SemanticMediaPurgeSession({
          history,
          mode: () => mode,
          requiresExplicitCacheWrite: () => explicit,
          persist: async () => undefined,
        });
        const attempt = await session.begin(false);
        if (attempt === undefined) throw new Error('Missing purge attempt');
        const override = streamSemanticPurgeRequest(attempt);
        if (override === undefined) throw new Error('Missing purge override');
        const tail: IContent[] = [
          { speaker: 'human', blocks: [{ type: 'text', text: 'pending' }] },
        ];
        const logger = new DebugLogger('purge-normalization-test');
        const old = await prepareProviderContentSnapshot(
          streamCuratedProviderHistory(logger, override, false),
          tail,
          logger,
        );
        try {
          const creates = await operationFileCreates(async () => {
            const native = await history.prepareCuratedForProviderSnapshot(
              tail,
              {},
              override,
            );
            try {
              expect(native instanceof JournalProviderRequestSnapshot).toBe(
                true,
              );
              expect(await collect(native)).toStrictEqual(await collect(old));
              expect(native.count).toBe(old.count);
              expect(native.pending).toStrictEqual(old.pending);
              await compareIndexed(native, old);
            } finally {
              await native.close();
            }
          }, true);
          expect(creates).toStrictEqual({ directories: [], files: [] });
        } finally {
          await old.close();
          await attempt.finalize();
        }
      } finally {
        await history.dispose();
      }
    },
  );
});
