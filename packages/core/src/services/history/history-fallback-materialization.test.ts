import { observeHistorySynchronouslyForTest } from '@vybestack/llxprt-code-test-utils/core/synchronous-history-test-observation.js';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';

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
  it('RestoreOnlyHistory rejects journal eager materialization', async () => {
    const history = new RestoreOnlyHistory();
    history.forbidMaterialization = true;
    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'eager rollback materialization',
      );
    } finally {
      await history.dispose();
    }
  });
});
