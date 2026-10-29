/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { useCommandOwners } from '../../../__tests__/command-owner-fixture.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { TrackedToolCall } from '../useReactToolScheduler.js';
import { createToolCheckpoint } from './checkpointPersistence.js';

function checkpointTool(filePath: string): Pick<TrackedToolCall, 'request'> {
  return {
    request: {
      callId: filePath,
      name: 'write_file',
      args: { file_path: filePath },
      isClientInitiated: false,
      prompt_id: 'checkpoint-owner',
    },
  };
}

function historyReader(owner: Agent, decoy: Agent) {
  return Object.assign(() => owner.streamHistory(), {
    getHistory: () => decoy.streamHistory(),
  });
}

describe('checkpoint history owner', () => {
  const makeOwner = useCommandOwners();
  it('persists the captured session history and leaves its sibling independent after retirement', async () => {
    const owner = await makeOwner('checkpoint-owner');
    const sibling = await makeOwner('checkpoint-sibling');
    await owner.addHistory({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'registered checkpoint history' }],
    });
    await sibling.addHistory({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'sibling checkpoint history' }],
    });
    const directory = join(
      owner.workspace.getWorkingDirectory(),
      'checkpoints',
    );
    await mkdir(directory);
    await createToolCheckpoint(
      checkpointTool(join(owner.workspace.getWorkingDirectory(), 'note.txt')),
      directory,
      {
        createFileSnapshot: async () => 'checkpoint-hash',
        getCurrentCommitHash: async () => 'fallback-hash',
      },
      historyReader(owner, sibling),
      () => {},
    );
    const names = await readdir(directory);
    const saved = await readFile(join(directory, names[0]), 'utf8');
    expect(saved).toContain('registered checkpoint history');
    expect(saved).not.toContain('sibling checkpoint history');
    await owner.dispose();
    const siblingDirectory = join(
      sibling.workspace.getWorkingDirectory(),
      'checkpoints',
    );
    await mkdir(siblingDirectory);
    await createToolCheckpoint(
      checkpointTool(
        join(sibling.workspace.getWorkingDirectory(), 'other.txt'),
      ),
      siblingDirectory,
      {
        createFileSnapshot: async () => 'checkpoint-hash',
        getCurrentCommitHash: async () => 'fallback-hash',
      },
      historyReader(sibling, owner),
      () => {},
    );
    const siblingNames = await readdir(siblingDirectory);
    expect(
      await readFile(join(siblingDirectory, siblingNames[0]), 'utf8'),
    ).toContain('sibling checkpoint history');
  });
});
