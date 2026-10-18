/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import {
  HistoryDensityRows,
  validateHistoryEntry,
  MediaAdmissionService,
  HistoryMediaIndex,
  collectMediaReferences,
  clientMediaStore,
  type IContent,
  type SessionRecordingPort,
  type AgentClientContract,
  type LocalMediaStore,
} from '@vybestack/llxprt-code-core';
import { MessageType, type HistoryItemWithoutId } from '../types.js';
import {
  createEmojiFilter,
  filterHistoryItems,
  resolveEmojiFilterMode,
  type EmojiFilterSettingsSource,
} from '../utils/iContentToHistoryItems.js';
import type { CommandContext, MessageActionReturn } from './types.js';

interface SnapshotMedia {
  readonly references: HistoryMediaIndex;
  readonly store: LocalMediaStore | undefined;
  readonly owner: string;
}

function cutIndex(rows: HistoryDensityRows, turns: number | undefined): number {
  if (turns !== undefined) {
    let humans = 0;
    for (let index = rows.length - 1; index >= 0; index--) {
      if (rows.readRow(index).speaker === 'human' && ++humans === turns)
        return index;
    }
    return 0;
  }
  let foundHuman = false;
  for (let index = 0; index < rows.length; index++) {
    if (rows.readRow(index).speaker !== 'human') continue;
    if (foundHuman) return index;
    foundHuman = true;
  }
  return rows.length;
}

async function captureRows(
  source: AsyncIterable<IContent>,
  rows: HistoryDensityRows,
  media: SnapshotMedia,
  signal: AbortSignal,
): Promise<void> {
  for await (const row of source) {
    signal.throwIfAborted();
    for (const reference of collectMediaReferences([row])) {
      if (media.references.has(reference.contentId)) continue;
      if (media.store === undefined)
        throw new Error('Chat mutation media store is unavailable');
      media.references.set(reference);
      await media.store.reserve(reference, media.owner);
    }
    rows.append(row);
  }
}

async function* prefix(
  rows: HistoryDensityRows,
  count: number,
  signal?: AbortSignal,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < count; index++) {
    signal?.throwIfAborted();
    yield rows.readRow(index);
  }
}

function displayRow(content: IContent): HistoryItemWithoutId {
  const text = content.blocks
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
  const thinkingBlocks = content.blocks.filter(
    (block) => block.type === 'thinking',
  );
  return {
    type: content.speaker === 'human' ? MessageType.USER : MessageType.AI,
    text,
    ...(content.speaker === 'ai' && thinkingBlocks.length > 0
      ? { thinkingBlocks }
      : {}),
  };
}

async function displayPrefix(
  ui: CommandContext['ui'],
  emojiSettings: EmojiFilterSettingsSource | null,
  rows: HistoryDensityRows,
  cut: number,
  restoring: boolean,
): Promise<void> {
  ui.clear();
  if (!restoring) {
    ui.updateHistoryTokenCount(0);
    return;
  }
  const emojiFilter = createEmojiFilter(resolveEmojiFilterMode(emojiSettings));
  let index = 0;
  for await (const row of prefix(rows, cut)) {
    for (const item of filterHistoryItems([displayRow(row)], emojiFilter))
      ui.addItem(item, index++);
  }
}

/**
 * The publication that follows writes the single cut rewind through the
 * journal attached to this recording, so the cut is not recorded here. This
 * only proves the recorder is healthy before live history is touched.
 */
async function assertRecordingWritable(
  recording: SessionRecordingPort,
): Promise<void> {
  if (!recording.isActive()) throw new Error('Recording is not active');
  await recording.flush();
  if (!recording.isActive()) throw new Error('Recording failed before the cut');
}

async function preflightPrefix(
  rows: HistoryDensityRows,
  count: number,
  store: LocalMediaStore | undefined,
  signal: AbortSignal,
): Promise<void> {
  const context = {
    turnId: 'chat-mutation-preflight',
    source: `chat-mutation-preflight:${randomUUID()}`,
  };
  for (let index = 0; index < count; index++) {
    signal.throwIfAborted();
    const row = rows.readRow(index);
    validateHistoryEntry(row, index);
    if (
      !row.blocks.some(
        (block) =>
          block.type === 'media' &&
          (block.encoding === 'base64' || block.encoding === 'reference'),
      )
    )
      continue;
    if (store === undefined)
      throw new Error('Chat mutation media store is unavailable');
    const admission = new MediaAdmissionService(store);
    const admitted = await admission.admitContents([row], context);
    await admission.releaseContents(admitted, context);
  }
}

async function publishPrefix(
  client: AgentClientContract,
  rows: HistoryDensityRows,
  cut: number,
): Promise<void> {
  try {
    await client.setHistoryFromSource(prefix(rows, cut));
    await client.getHistoryService()?.settleMediaOwnership();
  } catch (error) {
    try {
      await client.setHistoryFromSource(rows.streamRows());
      await client.getHistoryService()?.settleMediaOwnership();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Chat mutation and rollback failed',
      );
    }
    throw error;
  }
}

async function releaseMedia(media: SnapshotMedia): Promise<void> {
  try {
    for (const reference of media.references.values())
      await media.store?.release(reference.contentId, media.owner);
  } finally {
    media.references.close();
  }
}

export async function mutateChatHistory(
  client: AgentClientContract,
  ui: CommandContext['ui'],
  emojiSettings: EmojiFilterSettingsSource | null,
  signal: AbortSignal,
  recording: SessionRecordingPort,
  turns?: number,
): Promise<MessageActionReturn | void> {
  const media: SnapshotMedia = {
    references: new HistoryMediaIndex(),
    store: clientMediaStore(client),
    owner: `chat-mutation:${randomUUID()}`,
  };
  const rows = new HistoryDensityRows();
  const operation = turns === undefined ? 'clear' : 'restore';
  try {
    await captureRows(
      client.getChat().getHistory(false, signal),
      rows,
      media,
      signal,
    );
    const cut = cutIndex(rows, turns);
    if (cut === rows.length)
      return {
        type: 'message',
        messageType: 'info',
        content:
          turns === undefined
            ? 'No conversation to clear.'
            : 'Not enough history to restore the requested number of turns.',
      };
    await preflightPrefix(rows, cut, media.store, signal);
    signal.throwIfAborted();
    await assertRecordingWritable(recording);
    await publishPrefix(client, rows, cut);
    client.getHistoryService()?.resetCacheAnchorSeq();
    await displayPrefix(ui, emojiSettings, rows, cut, turns !== undefined);
    return undefined;
  } catch (error) {
    signal.throwIfAborted();
    const detail = error instanceof Error ? error.message : String(error);
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to ${operation} history: ${detail}`,
    };
  } finally {
    try {
      await releaseMedia(media);
    } finally {
      rows.close();
    }
  }
}
