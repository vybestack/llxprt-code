/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { HistoryDensityRows } from './historyDensityRows.js';
import { SemanticMediaPurgeStreamCoordinator } from './semantic-purge-stream.js';
import { rowsOf } from './chronology-rollback-test-helpers.js';
import { withPurgeFailureFixture } from './__tests__/support/purge-failure-fixture.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';

describe.each(['old', 'journal'] as const)(
  'semantic purge disk snapshot failure on %s',
  (backend) => {
    it('preserves the exact disk-write failure and original membership without acquiring detached owners', async () => {
      await withPurgeFailureFixture(backend, async (history) => {
        const input: IContent[] = [
          {
            speaker: 'human',
            blocks: [
              { type: 'text', text: 'prefix' },
              {
                type: 'media',
                mimeType: 'image/png',
                encoding: 'base64',
                data: 'aW1hZ2U=',
              },
            ],
            metadata: {
              chronology: { seq: 1, userTurn: 1, step: 1, recordedAt: 1 },
            },
          },
        ];
        const before = structuredClone(input);
        await history.addBatch(input);
        await history.waitForCommit();
        const owners = new RowOwnership();
        const failure = new Error('candidate disk write failed');
        const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
          enabled: true,
          explicitCacheWriteRequired: false,
          ownership: owners,
        });
        const writer = vi
          .spyOn(HistoryDensityRows.prototype, 'writeRow')
          .mockImplementationOnce(() => {
            throw failure;
          });
        try {
          await expect(coordinator.begin({ mode: 'remove' })).rejects.toBe(
            failure,
          );
        } finally {
          writer.mockRestore();
        }
        expect(await rowsOf(history)).toStrictEqual(before);
        expect(owners.snapshot().liveRows).toBe(0);
      });
    });
  },
);
