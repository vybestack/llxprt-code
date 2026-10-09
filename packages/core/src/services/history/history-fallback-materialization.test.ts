import { observeHistorySynchronouslyForTest } from '@vybestack/llxprt-code-test-utils/core/synchronous-history-test-observation.js';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import {
  exactTokenizer,
  rollbackRow,
} from './chronology-rollback-test-helpers.js';

class RestoreOnlyHistory extends HistoryService {
  forbidMaterialization = false;
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'eager rollback materialization',
      () => this.forbidMaterialization,
    );
  }
}

describe('journal materialization guard', () => {
  it('RestoreOnlyHistory rejects journal eager materialization', () => {
    const history = new RestoreOnlyHistory();
    history.forbidMaterialization = true;
    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'eager rollback materialization',
      );
    } finally {
      history.dispose();
    }
  });
});

describe('pending fallback publication', () => {
  it('publishes a pending-owner fallback rollback without eager history materialization', async () => {
    const history = new RestoreOnlyHistory();
    history.setTokenizerFactory(exactTokenizer());
    const row = rollbackRow(0);
    try {
      history.add(row);
      await history.waitForTokenUpdates();
      await history.withRawHistorySnapshot(async (snapshot) => {
        expect(snapshot.hasPendingRows).toBe(true);
        await history.replaceAll([rollbackRow(1)]);
        history.forbidMaterialization = true;
        await history.restoreRawHistorySnapshot(snapshot);
        const blocks: unknown[] = [];
        for await (const restored of history.streamRawHistory())
          blocks.push(restored.blocks);
        expect(blocks).toStrictEqual([rollbackRow(0).blocks]);
      });
    } finally {
      history.forbidMaterialization = false;
      history.dispose();
    }
  });
});
