/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { HistoryService } from '@vybestack/llxprt-code-core';

type JournalDisplayHandle = Awaited<
  ReturnType<HistoryService['appendDisplay']>
>;
import type { CommandContext } from '../commands/types.js';
import type { HistoryItemWithoutId } from '../types.js';
import { requireSessionAgent } from '../commands/historyServiceAccess.js';
import { encodeJournalUiItem } from '../stores/turn/journal-ui-item.js';

export async function appendJournalUiItem(
  agent: Agent,
  item: HistoryItemWithoutId,
): Promise<JournalDisplayHandle> {
  const source = encodeJournalUiItem(item);
  const history = agent.agentClient.getHistoryService();
  if (history === null) throw new Error('Session history is unavailable');
  return history.appendDisplay({ type: 'ui-item' }, source, agent.session);
}

export async function writeCommandOutput(
  context: CommandContext,
  item: HistoryItemWithoutId,
  timestamp?: number,
): Promise<void> {
  if (context.recordingOwner !== 'agent') {
    if (timestamp === undefined) context.ui.addItem(item);
    else context.ui.addItem(item, timestamp);
    return;
  }
  await appendJournalUiItem(requireSessionAgent(context), item);
}
