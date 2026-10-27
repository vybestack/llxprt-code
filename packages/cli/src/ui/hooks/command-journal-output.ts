/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core';

type JournalDisplayHandle = Awaited<
  ReturnType<HistoryService['appendDisplay']>
>;
import type { CommandContext } from '../commands/types.js';
import type { HistoryItemWithoutId } from '../types.js';
import { encodeJournalUiItem } from '../stores/turn/journal-ui-item.js';

export async function appendJournalUiItem(
  history: HistoryService | null,
  origin: Parameters<HistoryService['appendDisplay']>[2],
  item: HistoryItemWithoutId,
): Promise<JournalDisplayHandle> {
  const source = encodeJournalUiItem(item);
  if (history === null) throw new Error('Session history is unavailable');
  return history.appendDisplay({ type: 'ui-item' }, source, origin);
}

export async function writeCommandOutput(
  readHistory: () => HistoryService | null,
  origin: Parameters<HistoryService['appendDisplay']>[2],
  recordingOwner: 'agent' | undefined,
  addItem: CommandContext['ui']['addItem'],
  item: HistoryItemWithoutId,
  timestamp?: number,
): Promise<void> {
  if (recordingOwner !== 'agent') {
    if (timestamp === undefined) addItem(item);
    else addItem(item, timestamp);
    return;
  }
  await appendJournalUiItem(readHistory(), origin, item);
}
