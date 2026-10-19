/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { HistoryDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';
import type { PreparedHistoryBatchEffect } from '@vybestack/llxprt-code-core/services/history/historyBatchContracts.js';

export class PendingPublicationOwner extends HistoryMediaOwnership {
  private snapshot: HistoryDumpSnapshot | undefined;

  constructor(
    store: LocalMediaStore,
    private readonly ready: () => void,
    private readonly release: Promise<void>,
  ) {
    super(store);
  }

  arm(snapshot: HistoryDumpSnapshot): void {
    this.snapshot = snapshot;
  }

  override prepareReplacement(
    ...args: Parameters<HistoryMediaOwnership['prepareReplacement']>
  ): ReturnType<HistoryMediaOwnership['prepareReplacement']> {
    return this.hold(super.prepareReplacement(...args));
  }

  override prepareReferenceReplacement(
    ...args: Parameters<HistoryMediaOwnership['prepareReferenceReplacement']>
  ): ReturnType<HistoryMediaOwnership['prepareReferenceReplacement']> {
    return this.hold(super.prepareReferenceReplacement(...args));
  }

  private hold(effect: PreparedHistoryBatchEffect): PreparedHistoryBatchEffect {
    const snapshot = this.snapshot;
    this.snapshot = undefined;
    if (snapshot === undefined) return effect;
    return {
      publish: async () => {
        await effect.publish();
        try {
          for await (const _row of snapshot.rows()) {
            this.ready();
            await this.release;
            break;
          }
        } finally {
          await snapshot.close();
        }
      },
      rollback: async () => {
        await snapshot.close();
        await effect.rollback();
      },
      finalize: () => effect.finalize?.(),
    };
  }
}
