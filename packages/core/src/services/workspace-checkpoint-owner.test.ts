/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { WorkspaceCheckpointOwner } from './workspace-checkpoint-owner.js';

describe('workspace checkpoint owner physical operations', () => {
  function useWorkspace(): () => string {
    let root = '';
    let dataHome: string | undefined;
    let sandbox: string | undefined;
    beforeEach(async () => {
      root = await mkdtemp(
        join(import.meta.dirname, '../../../../tmp/checkpoint-owner-'),
      );
      dataHome = process.env.LLXPRT_DATA_HOME;
      sandbox = process.env.SANDBOX;
      process.env.LLXPRT_DATA_HOME = join(root, 'data');
      delete process.env.SANDBOX;
    });
    afterEach(async () => {
      if (dataHome === undefined) delete process.env.LLXPRT_DATA_HOME;
      else process.env.LLXPRT_DATA_HOME = dataHome;
      if (sandbox === undefined) delete process.env.SANDBOX;
      else process.env.SANDBOX = sandbox;
      await rm(root, { recursive: true, force: true });
    });
    return () => root;
  }

  const root = useWorkspace();

  async function holdCommit(
    storage: Storage,
  ): Promise<{ waitUntilStarted(): Promise<void>; release(): Promise<void> }> {
    const directory = storage.getHistoryDir();
    const started = join(directory, 'commit-started');
    const released = join(directory, 'commit-released');
    const hook = join(directory, '.git/hooks/prepare-commit-msg');
    const quote = (value: string): string =>
      `'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(
      hook,
      `#!/bin/sh
printf started > ${quote(started)}
while ! test -f ${quote(released)}; do /bin/sleep 0.01; done
`,
    );
    await chmod(hook, 0o700);
    return {
      async waitUntilStarted(): Promise<void> {
        const deadline = Date.now() + 10000;
        while (!existsSync(started)) {
          if (Date.now() >= deadline)
            throw new Error('Physical Git commit did not start');
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
      },
      release: () => writeFile(released, 'release'),
    };
  }

  it('restores checkpoint bytes through its finite operations', async () => {
    const project = join(root(), 'project');
    await mkdir(project);
    execFileSync('git', ['init', '--initial-branch=main', project]);
    const file = join(project, 'source.txt');
    const initial = 'first line\nsecond line\n';
    await writeFile(file, initial);
    const owner = new WorkspaceCheckpointOwner(
      project,
      new Storage(project).getHistoryDir(),
      true,
    );
    try {
      await owner.initialize();
      const hash = await owner.operations.createFileSnapshot('before edit');
      await writeFile(file, 'replacement');
      await owner.operations.restoreProjectFromSnapshot(hash);
      expect(await readFile(file, 'utf8')).toBe(initial);
      expect(await owner.operations.getCurrentCommitHash()).toBe(hash);
    } finally {
      await owner.dispose();
    }
  });

  it('closes new admission synchronously while completing an admitted physical snapshot', async () => {
    const project = join(root(), 'project');
    await mkdir(project);
    execFileSync('git', ['init', '--initial-branch=main', project]);
    await writeFile(join(project, 'accepted.txt'), 'accepted work\n');
    const storage = new Storage(project);
    const owner = new WorkspaceCheckpointOwner(
      project,
      storage.getHistoryDir(),
      true,
    );
    await owner.initialize();
    const held = await holdCommit(storage);
    const admitted = owner.operations.createFileSnapshot(
      'accepted before close',
    );
    let settled = false;
    try {
      await held.waitUntilStarted();
      const closing = owner.dispose().then(() => {
        settled = true;
      });
      expect(() => owner.operations.createFileSnapshot('late work')).toThrow(
        'closed',
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      expect(settled).toBe(false);
      await held.release();
      const hash = await admitted;
      await closing;
      const verifier = new WorkspaceCheckpointOwner(
        project,
        storage.getHistoryDir(),
        true,
      );
      try {
        await verifier.initialize();
        expect(await verifier.operations.getCurrentCommitHash()).toBe(hash);
      } finally {
        await verifier.dispose();
      }
    } finally {
      await held.release();
      await owner.dispose();
    }
  }, 30000);

  it('keeps same-label workspaces physically independent', async () => {
    const projects = [
      join(root(), 'left/project'),
      join(root(), 'right/project'),
    ];
    const owners = projects.map(
      (project) =>
        new WorkspaceCheckpointOwner(
          project,
          new Storage(project).getHistoryDir(),
          true,
        ),
    );
    try {
      await Promise.all(
        projects.map((project) => mkdir(project, { recursive: true })),
      );
      for (const project of projects)
        execFileSync('git', ['init', '--initial-branch=main', project]);
      await Promise.all(
        projects.map((project, index) =>
          writeFile(join(project, 'content.txt'), String(index)),
        ),
      );
      const hashes = await Promise.all(
        owners.map((owner) =>
          owner.operations.createFileSnapshot('same label'),
        ),
      );
      await owners[0].dispose();
      await writeFile(join(projects[1], 'content.txt'), 'edited');
      await owners[1].operations.restoreProjectFromSnapshot(hashes[1]);
      expect(await readFile(join(projects[1], 'content.txt'), 'utf8')).toBe(
        '1',
      );
      expect(new Storage(projects[0]).getHistoryDir()).not.toBe(
        new Storage(projects[1]).getHistoryDir(),
      );
    } finally {
      await Promise.all(owners.map((owner) => owner.dispose()));
    }
  });

  it('does not initialize a physical repository when checkpointing is disabled', async () => {
    const project = join(root(), 'disabled');
    await mkdir(project);
    execFileSync('git', ['init', '--initial-branch=main', project]);
    const storage = new Storage(project);
    const owner = new WorkspaceCheckpointOwner(
      project,
      storage.getHistoryDir(),
      false,
    );
    await owner.initialize();
    expect(() => owner.operations.getCurrentCommitHash()).toThrow('disabled');
    expect(existsSync(join(storage.getHistoryDir(), '.git/HEAD'))).toBe(false);
    await owner.dispose();
  });
});
