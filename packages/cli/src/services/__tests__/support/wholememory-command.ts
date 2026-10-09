/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { join } from 'node:path';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { SessionPersistenceService } from '@vybestack/llxprt-code-core/storage/SessionPersistenceService.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import {
  withRecordingFailureReport,
  type IContent,
  type RecordingIntegration,
  type SessionRecordingService,
  type LockHandle,
} from '@vybestack/llxprt-code-core';
import { performResume } from '../../performResume.js';
import { resumeHistoryWindow } from '../../../ui/utils/streamHistoryItems.js';
import type { HistoryItem } from '../../../ui/types.js';
import {
  createScrollbackPagerStore,
  type ScrollbackPagerStore,
} from '../../../ui/stores/turn/scrollbackPager.js';
import {
  MEMORY_PROJECT,
  MEMORY_PAGE,
  fixtureText,
} from './wholememory-fixture.js';

function verifyWindow(
  items: readonly HistoryItem[],
  limit: number,
  count: number,
  prefix = '',
): void {
  if (items.length !== Math.min(limit, count))
    throw new Error('Incorrect UI residency');
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (
      !('text' in item) ||
      item.text !== prefix + fixtureText(count - items.length + index)
    ) {
      throw new Error(`Incorrect UI projection at ${index}`);
    }
  }
}

export class MemoryCommand {
  mediaStore: LocalMediaStore | undefined;
  readonly history = new HistoryService();
  readonly counters = createRowCounters();
  recording: SessionRecordingService | null = null;
  integration: RecordingIntegration | null = null;
  lock: LockHandle | null = null;
  pager: ScrollbackPagerStore | undefined;
  pagerDecoded = 0;
  uiHistory: HistoryItem[] = [];
  metadataDirectories = 0;
  metadataDirectoryCharacters = 0;

  constructor(private readonly ownership?: RowOwnership) {
    this.counters = {
      ...this.counters,
      counters: { ...this.counters.counters, ownership },
    };
  }

  async run(
    directory: string,
    count: number,
    workload: string,
    target: string,
  ): Promise<void> {
    if (workload === 'media' || workload === 'media-dense') {
      this.mediaStore = new LocalMediaStore({
        rootDirectory: join(directory, 'media'),
        quotaBytes: 1024 * 1024,
      });
      this.history.registerMediaOwner(
        new HistoryMediaOwnership(this.mediaStore),
      );
    }
    const result = await performResume(target, {
      chatsDir: directory,
      mediaStore: this.mediaStore,
      projectHash: MEMORY_PROJECT,
      currentSessionId: 'prior',
      currentProvider: 'test',
      currentModel: 'test',
      workspaceDirs: [],
      historyService: this.history,
      counters: this.counters.counters,
      persistenceFactory: (sessionId) =>
        new SessionPersistenceService(new Storage(directory), sessionId),
      recordingCallbacks: {
        getCurrentRecording: () => this.recording,
        getCurrentIntegration: () => this.integration,
        getCurrentLockHandle: () => this.lock,
        setRecording: (next, bridge, handle, metadata) => {
          this.metadataDirectories = metadata.workspaceDirs.length;
          this.metadataDirectoryCharacters = metadata.workspaceDirs.reduce(
            (sum, directory) => sum + directory.length,
            0,
          );
          this.recording = next;
          this.integration = bridge;
          this.lock = handle;
        },
      },
    });
    if (!result.ok) throw new Error(result.error);
    this.uiHistory = await resumeHistoryWindow(
      verifyRows(result.history, count, workload),
      undefined,
      this.ownership,
    );
    await this.history.waitForCommit();
    await this.history.waitForTokenUpdates();
    await this.history.waitForOwnershipSettlement();
    await withRecordingFailureReport(this.integration?.flushAtTurnBoundary());
    const beforePager = this.counters.snapshot().recordsDecoded;
    const filePath = this.history.journalPath();
    if (filePath === null) throw new Error('Adoption did not bind a journal');
    this.pager = createScrollbackPagerStore({
      filePath,
      pageRows: MEMORY_PAGE,
      counters: this.counters.counters,
      viewport: { visibleKeys: [], viewportLines: 8, rowHeightLines: () => 1 },
      settings: {
        marginViewports: 1,
        byteFloorBytes: 65536,
        purgeDebounceMs: 0,
      },
    });
    await this.pager.resumeFromJournal();
    verifyWindow(
      this.pager.getState().rows.map((row) => row.item),
      MEMORY_PAGE,
      count,
      workload === 'compressed' ? '[compressed] ' : '',
    );
    verifyWindow(this.uiHistory, workload === 'compressed' ? 1 : 400, count);
    this.pagerDecoded = this.counters.snapshot().recordsDecoded - beforePager;
  }

  async close(): Promise<void> {
    for (const item of this.uiHistory) this.ownership?.release(item);
    this.uiHistory = [];
    await this.pager?.close();
    await this.integration?.dispose();
    this.history.dispose();
    await this.history.waitForOwnershipSettlement();
    await this.recording?.dispose();
    await this.lock?.release();
    await this.mediaStore?.close();
  }
}

async function* verifyRows(
  rows: AsyncIterable<IContent>,
  count: number,
  workload: string,
): AsyncIterable<IContent> {
  let seen = 0;
  // Fixture formula, not the resolver/replay implementation, is the oracle.
  for await (const row of rows) {
    const expectedIndex = workload === 'compressed' ? count - 1 : seen;
    if (
      row.blocks[0]?.type !== 'text' ||
      row.blocks[0].text !== fixtureText(expectedIndex)
    ) {
      throw new Error(`Incorrect restored row ${seen}`);
    }
    seen += 1;
    yield row;
  }
  if (seen !== (workload === 'compressed' ? 1 : count))
    throw new Error(`Wrong restored length ${seen}`);
}
