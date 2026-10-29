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
      // A failed release keeps the index so a later release can retry it.
      for (const reference of references.values(options.ownership)) {
        await store.release(
          reference.contentId,
          historyOwnerIdFor(reference.contentId, scope),
        );
        references.delete(reference.contentId);
      }
      references.close();
    },
  };
}

function eligibleAdmittedRow(
  content: IContent | undefined,
  references: HistoryMediaIndex,
): content is IContent {
  if (content === undefined) return false;
  for (const reference of collectMediaReferences([content]))
    references.set(reference);
  return (
    ['human', 'ai', 'tool'].includes(content.speaker) &&
    content.blocks.length > 0
  );
}

async function* admittedArrayRows(
  input: { rows: readonly IContent[] | undefined },
  admission: MediaAdmissionService,
  context: { turnId: string; source: string; reservationOwnerScope: string },
  references: HistoryMediaIndex,
  options: DeferredHistorySourceOptions,
  discardInput: () => void,
): AsyncGenerator<IContent, void, unknown> {
  let admitted: readonly IContent[] = [];
  let content: IContent | undefined;
  let inputIndex = 0;
  let admittedIndex = 0;
  try {
    if (input.rows === undefined)
      throw new Error('Deferred array already consumed');
    while (inputIndex < input.rows.length || admittedIndex < admitted.length) {
      options.signal?.throwIfAborted();
      if (admittedIndex === admitted.length) {
        admitted = await admission.admitContents(
          [input.rows[inputIndex++]],
          context,
        );
        admittedIndex = 0;
      }
      content = admitted[admittedIndex];
      admittedIndex = Math.min(admittedIndex + 1, admitted.length);
      if (!eligibleAdmittedRow(content, references)) {
        content = undefined;
        continue;
      }
      options.ownership?.retain(content);
      try {
        yield content;
      } finally {
        options.ownership?.release(content);
        content = undefined;
      }
    }
  } finally {
    admitted = [];
    content = undefined;
    discardInput();
  }
}
