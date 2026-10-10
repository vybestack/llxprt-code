import { Storage } from '@vybestack/llxprt-code-settings';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  Config,
  WorkspaceFilesystemOwner,
  WorkspaceMemoryOwner,
  assembleWorkspaceMemory,
} from '@vybestack/llxprt-code-core';
import { SessionInstructionOwner } from './session-instruction-owner.js';

function gate(): { promise: Promise<void>; release(): void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('session instruction admission and publication', () => {
  let directory: string;
  let home: string | undefined;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'session-instruction-'));
    await mkdir(join(directory, '.git'));
    await mkdir(join(directory, 'global'));
    home = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = join(directory, 'global');
  });
  afterEach(async () => {
    if (home === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = home;
    await rm(directory, { recursive: true, force: true });
  });
  it('publishes an accepted reload before closing its session subscription', async () => {
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => true,
    });
    const entered = gate();
    const held = gate();
    const memory = new WorkspaceMemoryOwner({
      globalMemoryDir: Storage.getGlobalMemoryDir(),
      workingDirectory: directory,
      jitEnabled: false,
      debugMode: false,
      loadIncludes: false,
      importFormat: 'tree',
      maxDirectories: 200,
      filtering: { respectGitIgnore: false, respectLlxprtIgnore: true },
      filenames: ['LLXPRT.md'],
      paths: filesystem.paths,
      ignore: filesystem.ignore,
      scans: {
        run: (directories, operation) =>
          filesystem.scans.run(directories, async () => {
            entered.release();
            await held.promise;
            return operation();
          }),
      },
      isTrusted: () => true,
      extensions: () => [],
    });
    const completed = gate();
    let published = '';
    const session = new SessionInstructionOwner(
      memory.operations,
      '',
      false,
      async () => {
        published = session.reads.snapshot().memoryContent;
        completed.release();
      },
    );

    let closing: Promise<void> | undefined;
    try {
      await writeFile(
        join(directory, 'LLXPRT.md'),
        'Accepted physical instructions.',
      );
      const refresh = session.memory.refresh();
      await entered.promise;
      closing = session.dispose();
      expect(() => session.memory.refresh()).toThrow(
        'Session instructions are disposed',
      );
      held.release();
      await refresh;
      await closing;
      expect(published).toContain('Accepted physical instructions.');
      await completed.promise;
    } finally {
      held.release();
      await Promise.allSettled([closing, session.dispose()]);
      await memory.dispose();
      await filesystem.dispose();
    }
  });
  it('does not overwrite a later session edit when an earlier reload rolls back', async () => {
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => true,
    });
    const memory = assembleWorkspaceMemory(
      new Config({
        sessionId: 'instruction-edit',
        targetDir: directory,
        cwd: directory,
        model: 'fake',
        debugMode: false,
        jitContextEnabled: false,
      }),
      filesystem,
      { isTrustedFolder: () => true, getIdeTrust: () => undefined },
    );
    const entered = gate();
    const held = gate();
    const session = new SessionInstructionOwner(
      memory.operations,
      '',
      false,
      async () => {},
    );
    const release = memory.operations.subscribe(async () => {
      if (
        memory.operations
          .snapshot()
          .memoryContent.includes('Rejected physical instructions.')
      ) {
        entered.release();
        await held.promise;
        throw new Error('Rejected publication');
      }
    });
    try {
      session.memory.setMemory('Previous session edit.');
      await writeFile(
        join(directory, 'LLXPRT.md'),
        'Rejected physical instructions.',
      );
      const refresh = session.memory.refresh();
      await entered.promise;
      session.memory.setMemory('Later independent session edit.');
      held.release();
      await expect(refresh).rejects.toThrow('Rejected publication');
      expect(session.memory.getMemory()).toBe(
        'Later independent session edit.',
      );
    } finally {
      held.release();
      release();
      await session.dispose();
      await memory.dispose();
      await filesystem.dispose();
    }
  });
});
