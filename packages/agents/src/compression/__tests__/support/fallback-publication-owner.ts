/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import type { PreparedHistoryBatchEffect } from '@vybestack/llxprt-code-core/services/history/historyBatchContracts.js';
import type { HistoryDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';

export class FallbackPublicationOwner extends HistoryMediaOwnership {
  private rejection:
    | {
        failure: Error;
        snapshot?: HistoryDumpSnapshot;
        ready?: () => void;
        release?: Promise<void>;
      }
    | undefined;

  rejectNext(
    failure: Error,
    pause?: {
      snapshot: HistoryDumpSnapshot;
      ready(): void;
      release: Promise<void>;
    },
  ): void {
    this.rejection = { failure, ...pause };
  }

  override prepareReplacement(
    ...args: Parameters<HistoryMediaOwnership['prepareReplacement']>
  ): ReturnType<HistoryMediaOwnership['prepareReplacement']> {
    return this.reject(super.prepareReplacement(...args));
  }

  override prepareReferenceReplacement(
    ...args: Parameters<HistoryMediaOwnership['prepareReferenceReplacement']>
  ): ReturnType<HistoryMediaOwnership['prepareReferenceReplacement']> {
    return this.reject(super.prepareReferenceReplacement(...args));
  }

  private reject(
    effect: PreparedHistoryBatchEffect,
  ): PreparedHistoryBatchEffect {
    const rejection = this.rejection;
    this.rejection = undefined;
    if (rejection === undefined) return effect;
    return {
      publish: async () => {
        await effect.publish();
        try {
          if (rejection.snapshot !== undefined) {
            for await (const _row of rejection.snapshot.rows()) {
              rejection.ready?.();
              await rejection.release;
              break;
            }
          }
          throw rejection.failure;
        } finally {
          await rejection.snapshot?.close();
        }
      },
      rollback: async () => {
        await rejection.snapshot?.close();
        await effect.rollback();
      },
      finalize: () => effect.finalize?.(),
    };
  }
}
