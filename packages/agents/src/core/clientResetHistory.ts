/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ChatSession } from './chatSession.js';
import { isHistorySource } from './deferredHistorySource.js';
import { NativeHistoryPrefix } from './native-history-prefix.js';

export async function resetClientHistory(
  chat: ChatSession,
  preserved: readonly IContent[] | AsyncIterable<IContent> | undefined,
  replaceSource: (source: AsyncIterable<IContent>) => Promise<void>,
): Promise<void> {
  if (preserved === undefined) {
    await chat.clearHistory();
    return;
  }
  if (preserved instanceof NativeHistoryPrefix) {
    await preserved.apply(chat.getHistoryService());
  } else if (isHistorySource(preserved)) {
    await replaceSource(preserved);
    await chat.getHistoryService().settleMediaOwnership();
  } else {
    await chat.setHistory(preserved);
    await chat.getHistoryService().waitForCommit();
  }
}
