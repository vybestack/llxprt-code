/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { join } from 'node:path';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import {
  withRecordingFailureReport,
  type IContent,
  type RecordingIntegration,
  type SessionRecordingPort,
  type LockHandle,
} from '@vybestack/llxprt-code-core';
import { performResume } from '../../performResume.js';
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

type ResumeOptions = Parameters<typeof performResume>[1];

export class MemoryCommand {
  mediaStore: LocalMediaStore | undefined;
  readonly history = new HistoryService();
  readonly counters = createRowCounters();
  recording: SessionRecordingPort | null = null;
  integration: RecordingIntegration | null = null;
  lock: LockHandle | null = null;
  pager: ScrollbackPagerStore | undefined;
  pagerDecoded = 0;
  metadataDirectories = 0;
  metadataDirectoryCharacters = 0;

  constructor(ownership?: RowOwnership) {
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
    await this.registerMediaOwner(directory, workload);
    const result = await performResume(target, this.resumeOptions(directory));
    if (!result.ok) throw new Error(result.error);
    for await (const _row of verifyRows(result.history, count, workload)) {
      // Validate the adopted source without creating a second transcript.
    }
    await this.history.waitForCommit();
    await this.history.waitForTokenUpdates();
    await this.history.waitForOwnershipSettlement();
    await withRecordingFailureReport(this.integration?.flushAtTurnBoundary());
    await this.verifyPager(count, workload);
  }

  private async registerMediaOwner(
    directory: string,
    workload: string,
  ): Promise<void> {
    if (workload === 'media' || workload === 'media-dense') {
      this.mediaStore = new LocalMediaStore({
        rootDirectory: join(directory, 'media'),
        quotaBytes: 1024 * 1024,
      });
      await this.history.registerMediaOwner(
        new HistoryMediaOwnership(this.mediaStore),
      );
    }
  }

  private resumeOptions(directory: string): ResumeOptions {
    return {
      chatsDir: directory,
      mediaStore: this.mediaStore,
      projectHash: MEMORY_PROJECT,
      currentSessionId: 'prior',
      currentProvider: 'test',
      currentModel: 'test',
      workspaceDirs: [],
      history: {
        adoptResumeBoot: this.history.adoptResumeBoot.bind(this.history),
        attachRecording: async (integration) => {
          await integration.subscribeToJournal(this.history);
        },
      },
      counters: this.counters.counters,
      recordingCallbacks: {
        getCurrentRecording: () => this.recording,
        getCurrentIntegration: () => this.integration,
        getCurrentLockHandle: () => this.lock,
        getCurrentMetadata: () => null,
        setRecording: (next, bridge, handle, metadata) => {
          if (metadata === null)
            throw new Error('Resume adoption published no session metadata');
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
    };
  }

  private async verifyPager(count: number, workload: string): Promise<void> {
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
    if (workload === 'compressed') {
      const rows = this.pager.getState().rows;
      if (
        rows.some(
          (row, index) =>
            row.contextState !==
            (index === rows.length - 1 ? 'in-context' : 'purged'),
        )
      ) {
        throw new Error('Incorrect compressed transcript context markers');
      }
    }
    this.pagerDecoded = this.counters.snapshot().recordsDecoded - beforePager;
  }

  async close(): Promise<void> {
    await this.pager?.close();
    await this.integration?.dispose();
    await this.history.dispose();
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
