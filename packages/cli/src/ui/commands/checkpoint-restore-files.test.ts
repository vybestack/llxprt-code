/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
const composeFixtureRuntime = installWorkspaceRuntimeFixture();

import { describe, expect, it, vi } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { GitService } from '@vybestack/llxprt-code-core/services/gitService.js';
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

const candidate: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'checkpoint-candidate' }],
};

type Fault = 'none' | 'history-commit' | 'file-restore';

interface Outcome {
  readonly result: unknown;
  readonly files: { readonly tracked: string; readonly created: boolean };
  readonly historyDigest: string;
  readonly priorHistoryDigest: string;
  readonly uiPublished: boolean;
}

async function digest(rows: AsyncIterable<IContent>): Promise<string> {
  const hash = createHash('sha256');
  for await (const row of rows) hash.update(JSON.stringify(row));
  return hash.digest('hex');
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * A real shadow-git project: `tracked.txt` is "before tool" at the checkpoint
 * snapshot, then (when `toolEdits`) the tool rewrites it and creates
 * `created.txt`.
 */
async function withProject<T>(
  toolEdits: boolean,
  action: (project: string, git: GitService, snapshot: string) => Promise<T>,
): Promise<T> {
  const base = await mkdtemp(join(tmpdir(), 'restore-files-'));
  try {
    const project = join(base, 'project');
    await mkdir(project);
    const git = new GitService(project, join(base, 'history'));
    await writeFile(join(project, 'tracked.txt'), 'before tool');
    await git.initialize();
    const snapshot = await git.createFileSnapshot('before tool');
    if (toolEdits) {
      await writeFile(join(project, 'tracked.txt'), 'after tool');
      await writeFile(join(project, 'created.txt'), 'created by tool');
    }
    return await action(project, git, snapshot);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

function injectFileRestoreFault(git: GitService, snapshot: string): void {
  const restore = git.restoreProjectFromSnapshot.bind(git);
  // The target restore really rewrites the tree and then fails, so only a
  // rollback can leave the files as they were.
  vi.spyOn(git, 'restoreProjectFromSnapshot').mockImplementation(
    async (hash) => {
      await restore(hash);
      if (hash === snapshot) throw new Error('file restore failure');
    },
  );
}

async function runRestore(fault: Fault, toolEdits = true): Promise<Outcome> {
  return withProject(toolEdits, (project, git, snapshot) =>
    withCheckpoint(2, false, async (fixture, dir) => {
      const client = fixture.client;
      await writeFile(
        join(dir, 'restore.json'),
        JSON.stringify({
          history: checkpointUiHistory,
          clientHistory: [candidate],
          commitHash: snapshot,
          toolCall: checkpointTool.request,
        }),
      );
      vi.spyOn(fixture.config, 'getCheckpointingEnabled').mockReturnValue(true);
      const runtime = {
        ...composeFixtureRuntime(fixture.config),
        projectCheckpointsDir: dir,
      };
      const context = createMockCommandContext({
        services: { config: runtime, agent: { agentClient: client } },
      });
      let uiPublished = false;
      context.ui.clear = () => {
        uiPublished = true;
      };
      context.ui.addItem = () => {
        uiPublished = true;
        return 1;
      };
      context.services.git = git;
      if (fault === 'history-commit') failDurableWrite();
      if (fault === 'file-restore') injectFileRestoreFault(git, snapshot);
      const priorHistoryDigest = expectedCleanupDigest(
        2,
        2048,
        fixture.reference,
      );
      try {
        const result = await restoreCommand(runtime)?.action?.(
          context,
          'restore',
        );
        return {
          result,
          files: {
            tracked: await readFile(join(project, 'tracked.txt'), 'utf8'),
            created: await exists(join(project, 'created.txt')),
          },
          historyDigest: await digest(client.streamHistory()),
          priorHistoryDigest,
          uiPublished,
        };
      } finally {
        vi.restoreAllMocks();
      }
    }),
  );
}

describe('CLI checkpoint restoration keeps project files and history together', () => {
  it('restores files and replaces history when nothing fails', async () => {
    const outcome = await runRestore('none');
    expect(outcome.result).toMatchObject({ type: 'tool' });
    expect(outcome.files).toStrictEqual({
      tracked: 'before tool',
      created: false,
    });
    expect(outcome.historyDigest).not.toBe(outcome.priorHistoryDigest);
  }, 180000);

  it('leaves files and history unchanged and reports the error when the history commit fails', async () => {
    const outcome = await runRestore('history-commit');
    expect(outcome.result).toMatchObject({
      type: 'message',
      messageType: 'error',
      content: expect.stringContaining('checkpoint durable write failure'),
    });
    expect(outcome.files).toStrictEqual({
      tracked: 'after tool',
      created: true,
    });
    expect(outcome.historyDigest).toBe(outcome.priorHistoryDigest);
    expect(outcome.uiPublished).toBe(false);
  }, 180000);

  it('leaves files and history unchanged and reports the error when the file restore fails', async () => {
    const outcome = await runRestore('file-restore');
    expect(outcome.result).toMatchObject({
      type: 'message',
      messageType: 'error',
      content: expect.stringContaining('file restore failure'),
    });
    expect(outcome.files).toStrictEqual({
      tracked: 'after tool',
      created: true,
    });
    expect(outcome.historyDigest).toBe(outcome.priorHistoryDigest);
    expect(outcome.uiPublished).toBe(false);
  }, 180000);

  it('rolls back to the unchanged tree when the history commit fails and the restore changed no files', async () => {
    const outcome = await runRestore('history-commit', false);
    expect(outcome.result).toMatchObject({
      type: 'message',
      messageType: 'error',
      content: expect.stringContaining('checkpoint durable write failure'),
    });
    expect(outcome.result).not.toMatchObject({
      content: expect.stringContaining('could not be rolled back'),
    });
    expect(outcome.files).toStrictEqual({
      tracked: 'before tool',
      created: false,
    });
    expect(outcome.historyDigest).toBe(outcome.priorHistoryDigest);
  }, 180000);
});
