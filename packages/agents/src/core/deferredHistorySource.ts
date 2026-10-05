/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type {
  DetachedHistorySink,
  DetachedHistoryTransform,
} from '@vybestack/llxprt-code-core/services/history/detachedHistoryAPI.js';
import { sanitizeProviderContentForSerialization } from '@vybestack/llxprt-code-core/services/history/historyCloneUtils.js';
import type { ChatSession } from './chatSession.js';

export function hasReferenceMedia(history?: readonly IContent[]): boolean {
  return (
    history?.some((content) =>
      content.blocks.some(
        (block) => block.type === 'media' && block.encoding === 'reference',
      ),
    ) ?? false
  );
}

export async function clearClientHistoryForDisposal(
  chat: ChatSession,
  streamed: boolean,
): Promise<void> {
  await chat.clearHistory();
  if (streamed) {
    const history = chat.getHistoryService();
    await history.waitForOwnershipSettlement();
    history.dispose();
  }
}
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { HistoryMediaIndex } from '@vybestack/llxprt-code-core/storage/history-media-index.js';
import {
  MediaAdmissionService,
  historyOwnerIdFor,
} from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import { collectMediaReferences } from '@vybestack/llxprt-code-core/storage/media-reference-lifecycle.js';
import type { DeferredHistorySourceOptions } from '@vybestack/llxprt-code-core/core/clientContract.js';

function appendAdmittedRows(
  rows: readonly IContent[],
  references: HistoryMediaIndex,
  sink: DetachedHistorySink,
  options: DeferredHistorySourceOptions,
): void {
  for (const content of rows) {
    options.ownership?.retain(content);
    try {
      for (const reference of collectMediaReferences([content]))
        references.set(reference);
      sink.appendValue(sanitizeProviderContentForSerialization(content));
    } finally {
      options.ownership?.release(content);
    }
  }
}

export async function prepareDeferredHistorySource(
  source: AsyncIterable<IContent>,
  config: Config,
  runtime: AgentRuntimeState,
  stored: HistoryService | undefined,
  options: DeferredHistorySourceOptions,
): Promise<{ journal: HistoryService; release: () => Promise<void> }> {
  const journal = new HistoryService({
    mutationOwnership: options.ownership,
    attachmentCounters: options.counters,
  });
  const factory = config.getTokenizerFactory();
  if (factory) journal.setTokenizerFactory(factory);
  journal.setActiveTokenizationTarget(runtime.model, runtime.provider);
  try {
    options.signal?.throwIfAborted();
    if (stored !== undefined) await journal.merge(stored);
    const release = await admitDeferredHistorySource(
      journal,
      source,
      config.getLocalMediaStore(),
      options,
      runtime.model,
    );
    return { journal, release };
  } catch (error) {
    journal.dispose();
    throw error;
  }
}

export function admitDeferredHistorySource(
  journal: HistoryService,
  source: AsyncIterable<IContent>,
  store: LocalMediaStore,
  options: DeferredHistorySourceOptions,
  modelName: string,
): Promise<() => Promise<void>> {
  const admission = new MediaAdmissionService(store);
  const scope = `deferred-source:${randomUUID()}`;
  const context = {
    turnId: scope,
    source: scope,
    reservationOwnerScope: scope,
  };
  const references = new HistoryMediaIndex();
  const release = async (): Promise<void> => {
    for (const reference of references.values(options.ownership)) {
      await store.release(
        reference.contentId,
        historyOwnerIdFor(reference.contentId, scope),
      );
      references.delete(reference.contentId);
    }
    references.close();
  };
  return commitDeferredAdmission(
    journal,
    deferredAdmissionTransform(
      { source },
      admission,
      context,
      references,
      options,
    ),
    options,
    modelName,
    release,
  );
}

function deferredAdmissionTransform(
  input: { source: AsyncIterable<IContent> | undefined },
  admission: MediaAdmissionService,
  context: Parameters<MediaAdmissionService['admitContents']>[1],
  references: HistoryMediaIndex,
  options: DeferredHistorySourceOptions,
): DetachedHistoryTransform {
  return async (_previous, sink): Promise<void> => {
    if (input.source === undefined)
      throw new Error('Deferred source already consumed');
    try {
      for await (const row of input.source) {
        options.signal?.throwIfAborted();
        options.ownership?.retain(row);
        try {
          const admitted = await admission.admitContents([row], context);
          appendAdmittedRows(admitted, references, sink, options);
        } finally {
          options.ownership?.release(row);
        }
      }
    } finally {
      input.source = undefined;
    }
  };
}

async function commitDeferredAdmission(
  journal: HistoryService,
  transform: DetachedHistoryTransform,
  options: DeferredHistorySourceOptions,
  modelName: string,
  release: () => Promise<void>,
): Promise<() => Promise<void>> {
  try {
    await journal.detachedValues.transform(transform, modelName, {
      signal: options.signal,
    });
    return release;
  } catch (error) {
    try {
      await release();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Deferred disk admission cleanup failed',
      );
    }
    throw error;
  }
}

export function isHistorySource(
  history: readonly IContent[] | AsyncIterable<IContent>,
): history is AsyncIterable<IContent> {
  return Symbol.asyncIterator in history;
}
