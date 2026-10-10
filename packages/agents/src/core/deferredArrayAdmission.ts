/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { DeferredHistorySourceOptions } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { HistoryMediaIndex } from '@vybestack/llxprt-code-core/storage/history-media-index.js';
import {
  MediaAdmissionService,
  historyOwnerIdFor,
} from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import { collectMediaReferences } from '@vybestack/llxprt-code-core/storage/media-reference-lifecycle.js';
import { trackMutationOwners } from '@vybestack/llxprt-code-core/services/history/historyMutationOwnership.js';

export interface DeferredArrayAdmission {
  rows: AsyncIterable<IContent> | undefined;
  discardInput(): void;
  release(): Promise<void>;
}

export function prepareDeferredArrayAdmission(
  rows: readonly IContent[],
  store: LocalMediaStore,
  scope: string,
  options: DeferredHistorySourceOptions,
): DeferredArrayAdmission {
  return createDeferredArrayAdmission(
    { rows, release: trackMutationOwners(rows, options.ownership) },
    store,
    scope,
    options,
  );
}

function createDeferredArrayAdmission(
  input: { rows: readonly IContent[] | undefined; release: () => void },
  store: LocalMediaStore,
  scope: string,
  options: DeferredHistorySourceOptions,
): DeferredArrayAdmission {
  const discardInput = (): void => {
    input.release();
    input.rows = undefined;
    input.release = (): void => {};
  };
  const references = new HistoryMediaIndex();
  const admission = new MediaAdmissionService(store);
  const context = {
    turnId: scope,
    source: scope,
    reservationOwnerScope: scope,
  };
  return {
    rows: admittedArrayRows(
      input,
      admission,
      context,
      references,
      options,
      discardInput,
    ),
    discardInput,
    release: async (): Promise<void> => {
      try {
        for (const reference of references.values(options.ownership)) {
          await store.release(
            reference.contentId,
            historyOwnerIdFor(reference.contentId, scope),
          );
          references.delete(reference.contentId);
        }
      } finally {
        references.close();
      }
    },
  };
}

async function* admittedArrayRows(
  input: { rows: readonly IContent[] | undefined },
  admission: MediaAdmissionService,
  context: { turnId: string; source: string; reservationOwnerScope: string },
  references: HistoryMediaIndex,
  options: DeferredHistorySourceOptions,
  discardInput: () => void,
): AsyncGenerator<IContent, void, unknown> {
  try {
    if (input.rows === undefined)
      throw new Error('Deferred array already consumed');
    for (const row of input.rows) {
      options.signal?.throwIfAborted();
      const admitted = await admission.admitContents([row], context);
      yield* admittedRowValues(admitted, references, options);
    }
  } finally {
    discardInput();
  }
}

async function* admittedRowValues(
  admitted: readonly IContent[],
  references: HistoryMediaIndex,
  options: DeferredHistorySourceOptions,
): AsyncGenerator<IContent, void, unknown> {
  for (const content of admitted) {
    options.ownership?.retain(content);
    try {
      for (const reference of collectMediaReferences([content]))
        references.set(reference);
      if (
        ['human', 'ai', 'tool'].includes(content.speaker) &&
        content.blocks.length > 0
      )
        yield content;
    } finally {
      options.ownership?.release(content);
    }
  }
}
