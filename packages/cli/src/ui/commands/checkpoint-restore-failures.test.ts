/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { writeFile, readdir, truncate } from 'node:fs/promises';
import { GitService } from '@vybestack/llxprt-code-core/services/gitService.js';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import {
  withCheckpoint,
  checkpointUiHistory,
  checkpointTool,
} from '../hooks/agentStream/checkpoint-disk-test-helpers.js';
import { restoreCommand } from './restoreCommand.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { expectedCleanupDigest } from '../../utils/cleanup-history-test-helpers.js';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const candidate: IContent = {
  speaker: 'human',
  blocks: [
    { type: 'text', text: 'checkpoint-candidate' },
    { type: 'media', encoding: 'base64', mimeType: 'image/png', data: png },
  ],
};
async function digest(rows: AsyncIterable<IContent>): Promise<string> {
  const hash = createHash('sha256');
  for await (const row of rows) hash.update(JSON.stringify(row));
  return hash.digest('hex');
}

type Fault =
  | 'snapshot'
  | 'abort'
  | 'write'
  | 'corrupt'
  | 'missing-ui'
  | 'truncated';
function failDurableWrite(): void {
  // Durable acknowledgement is awaited by sequence, so remember the sequence
  // of the enqueued candidate row and refuse only that row's commit ack.
  const enqueue = SessionRecordingService.prototype.enqueue;
  const waitForSequence =
    SessionRecordingService.prototype.waitForCommitSequence;
  let candidateSeq: number | null = null;
  vi.spyOn(SessionRecordingService.prototype, 'enqueue').mockImplementation(
    function (this: SessionRecordingService, ...args) {
      const line = enqueue.call(this, ...args);
      if (
        line !== null &&
        candidateSeq === null &&
        JSON.stringify(args[1]).includes('checkpoint-candidate')
      )
        candidateSeq = line.seq;
      return line;
    },
  );
  vi.spyOn(
    SessionRecordingService.prototype,
    'waitForCommitSequence',
  ).mockImplementation(async function (this: SessionRecordingService, seq) {
    if (candidateSeq !== null && seq === candidateSeq)
      throw new Error('checkpoint durable write failure');
    return waitForSequence.call(this, seq);
  });
}

async function failure(fault: Fault, active: boolean): Promise<boolean> {
  return withCheckpoint(2, active, async (fixture, dir) => {
    const client = fixture.config.getAgentClient();
    const before = expectedCleanupDigest(2, 2048, fixture.reference);
    const contentId =
      'sha256:' +
      createHash('sha256').update(Buffer.from(png, 'base64')).digest('hex');
    const store = fixture.config.getLocalMediaStore();
    expect(await store.hasReservations(contentId)).toBe(false);
    const encoded = JSON.stringify({
      history: checkpointUiHistory,
      clientHistory: [candidate],
      commitHash: 'snapshot-before-tool',
      toolCall: checkpointTool.request,
    });
    await writeFile(
      join(dir, 'restore.json'),
      fault === 'corrupt' ? encoded.slice(0, -2) : encoded,
    );
    vi.spyOn(
      fixture.config.storage,
      'getProjectTempCheckpointsDir',
    ).mockReturnValue(dir);
    vi.spyOn(fixture.config, 'getCheckpointingEnabled').mockReturnValue(true);
    const abort = new AbortController();
    if (fault === 'truncated') {
      const admit = client.setHistoryFromSource.bind(client);
      vi.spyOn(client, 'setHistoryFromSource').mockImplementation(
        async (source, options) => {
          await truncate(join(dir, 'restore.json'), 10);
          await admit(source, options);
        },
      );
    }
    const context = createMockCommandContext();
    context.signal = abort.signal;
    context.services.config = fixture.config;
    let uiPublished = false;
    context.ui.loadHistory = () => {
      uiPublished = true;
    };
    if (fault === 'missing-ui')
      Reflect.deleteProperty(context.ui, 'loadHistory');
    context.ui.addItem = () => {
      uiPublished = true;
      return 1;
    };
    if (fault === 'snapshot' || fault === 'abort') {
      const git = new GitService(fixture.root, fixture.config.storage);
      vi.spyOn(git, 'restoreProjectFromSnapshot').mockImplementation(
        async () => {
          if (fault === 'abort') abort.abort(new Error('checkpoint abort'));
          else throw new Error('snapshot recovery failure');
        },
      );
      context.services.git = git;
    }
    if (fault === 'write') failDurableWrite();
    try {
      const outcome = await restoreCommand(fixture.config)?.action?.(
        context,
        'restore',
      );
      expect(outcome).toMatchObject({ type: 'message', messageType: 'error' });
      expect(await digest(client.streamHistory())).toBe(before);
      expect(await store.hasReservations(contentId)).toBe(false);
      expect(
        await readdir(join(store.rootDirectory, 'temporary')),
      ).toStrictEqual([]);
      return uiPublished;
    } finally {
      vi.restoreAllMocks();
    }
  });
}

describe('CLI checkpoint restoration atomic recovery', () => {
  for (const active of [false, true]) {
    for (const fault of [
      'snapshot',
      'abort',
      'write',
      'corrupt',
      'missing-ui',
      'truncated',
    ] as const) {
      it(`keeps prior history and UI with no media reservations after ${fault}, active=${active}`, async () => {
        expect(await failure(fault, active)).toBe(false);
      }, 180000);
    }
  }
  it('does not allow traversal outside the enumerated checkpoint directory', async () => {
    await withCheckpoint(1, false, async (fixture, dir) => {
      vi.spyOn(
        fixture.config.storage,
        'getProjectTempCheckpointsDir',
      ).mockReturnValue(dir);
      vi.spyOn(fixture.config, 'getCheckpointingEnabled').mockReturnValue(true);
      await writeFile(join(dir, 'restore.json'), '{}');
      const context = createMockCommandContext();
      context.services.config = fixture.config;
      try {
        const result = await restoreCommand(fixture.config)?.action?.(
          context,
          '../restore',
        );
        expect(result).toMatchObject({
          type: 'message',
          messageType: 'error',
          content: 'File not found: ../restore.json',
        });
      } finally {
        vi.restoreAllMocks();
      }
    });
  });
});
