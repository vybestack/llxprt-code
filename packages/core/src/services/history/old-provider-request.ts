/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryPrepareCuratedRequest } from './historyStorePort.js';
import type { IContent } from './IContent.js';
import { streamCuratedProviderHistory } from './historyCuration.js';
import { prepareProviderContentSnapshot } from './provider-curated-stream.js';
import type { ProviderRequestSnapshot } from './provider-request-snapshot.js';

export function oldProviderRequest(
  store: {
    streamRows(query: undefined, signal?: AbortSignal): AsyncIterable<IContent>;
  },
  request: HistoryPrepareCuratedRequest,
): Promise<ProviderRequestSnapshot> {
  return prepareProviderContentSnapshot(
    streamCuratedProviderHistory(
      request.logger,
      request.historyOverride ??
        store.streamRows(undefined, request.options.signal),
      request.isCompressing,
      request.options.signal,
    ),
    request.tail,
    request.logger,
    request.options,
  );
}
