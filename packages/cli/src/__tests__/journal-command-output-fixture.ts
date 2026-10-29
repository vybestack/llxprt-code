/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { UseHistoryManagerReturn } from '../ui/hooks/useHistoryManager.js';
import { appendJournalUiItem } from '../ui/hooks/command-journal-output.js';

export function journalCommandOutput(session: Agent['session']): {
  readonly addItem: UseHistoryManagerReturn['addItem'];
  readonly settle: () => Promise<void>;
} {
  const pending: Array<Promise<unknown>> = [];
  return {
    addItem: (item) => {
      pending.push(appendJournalUiItem(session, session, item));
      return pending.length;
    },
    settle: async () => {
      await Promise.all(pending);
      pending.length = 0;
    },
  };
}
