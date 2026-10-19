/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryMediaOwnership } from '../../../../storage/history-media-ownership.js';
import { LocalMediaStore } from '../../../../storage/local-media-store.js';
import type { RowOwnership } from '../../../../recording/rowOwnership.js';
import type { PreparedHistoryBatchEffect } from '../../historyBatchContracts.js';

type References = Parameters<
  HistoryMediaOwnership['prepareReferenceReplacement']
>[0];

export class DetachedMediaOwner extends HistoryMediaOwnership {
  stage: string | undefined;
  readonly failure = new Error('detached media stage');
  rollbackFailure: Error | undefined;
  onPrepare: (() => void) | undefined;
  onRollback: (() => void) | undefined;

  override prepareReferenceReplacement(
    references: References,
    ownership?: RowOwnership,
  ): PreparedHistoryBatchEffect {
    this.onPrepare?.();
    if (this.stage === 'prepare') throw this.failure;
    const effect = super.prepareReferenceReplacement(references, ownership);
    return {
      publish: async (): Promise<void> => {
        await effect.publish();
        if (this.stage === 'publish') throw this.failure;
      },
      finalize: async (): Promise<void> => {
        if (this.stage === 'finalize') throw this.failure;
        await effect.finalize?.();
      },
      rollback: async (): Promise<void> => {
        await effect.rollback();
        this.onRollback?.();
        if (this.rollbackFailure !== undefined) throw this.rollbackFailure;
      },
    };
  }
}

export async function withDetachedMedia(
  action: (store: LocalMediaStore, owner: DetachedMediaOwner) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'detached-media-'));
  const store = new LocalMediaStore({ rootDirectory: root, quotaBytes: 1024 });
  const owner = new DetachedMediaOwner(store);
  try {
    await action(store, owner);
  } finally {
    await owner.releaseAll();
    await store.close();
    rmSync(root, { recursive: true, force: true });
  }
}
