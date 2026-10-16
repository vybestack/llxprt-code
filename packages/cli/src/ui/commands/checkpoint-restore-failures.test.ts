/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
const composeFixtureRuntime = installWorkspaceRuntimeFixture();

import { describe, expect, it, vi } from 'bun:test';
import { writeFile, readdir, truncate } from 'node:fs/promises';
import { GitService } from '@vybestack/llxprt-code-core/services/gitService.js';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  withCheckpoint,
  checkpointUiHistory,
  checkpointTool,
  failDurableWrite,
} from '../hooks/agentStream/checkpoint-disk-test-helpers.js';
import { restoreCommand } from './restoreCommand.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { expectedCleanupDigest } from '../../utils/__tests__/support/cleanup-history-test-helpers.js';

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
async function failure(fault: Fault, active: boolean): Promise<boolean> {
  return withCheckpoint(2, active, async (fixture, dir) => {
    const client = fixture.client;
    const before = expectedCleanupDigest(2, 2048, fixture.reference);
    const contentId =
      'sha256:' +
      createHash('sha256').update(Buffer.from(png, 'base64')).digest('hex');
    const store = client.mediaStore;
    if (store === undefined) throw new Error('Agent client has no media store');
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
    vi.spyOn(fixture.config, 'getCheckpointingEnabled').mockReturnValue(true);
    const runtime = {
      ...composeFixtureRuntime(fixture.config),
      projectCheckpointsDir: dir,
    };
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
    const context = createMockCommandContext({
      services: { config: runtime, agent: { agentClient: client } },
    });
    context.signal = abort.signal;
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
      const git = new GitService(
        fixture.root,
        fixture.config.projectHistoryDir,
      );
      vi.spyOn(git, 'createFileSnapshot').mockResolvedValue(
        'project-before-restore',
      );
      vi.spyOn(git, 'restoreProjectFromSnapshot').mockImplementation(
        async (hash) => {
          if (hash !== 'snapshot-before-tool') return;
          if (fault === 'abort') abort.abort(new Error('checkpoint abort'));
          else throw new Error('snapshot recovery failure');
        },
      );
      context.services.git = git;
    }
    if (fault === 'write') failDurableWrite();
    try {
      const outcome = await restoreCommand(runtime)?.action?.(
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
      vi.spyOn(fixture.config, 'getCheckpointingEnabled').mockReturnValue(true);
      const runtime = {
        ...composeFixtureRuntime(fixture.config),
        projectCheckpointsDir: dir,
      };
      await writeFile(join(dir, 'restore.json'), '{}');
      const context = createMockCommandContext({
        services: { config: runtime },
      });
      try {
        const result = await restoreCommand(runtime)?.action?.(
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
