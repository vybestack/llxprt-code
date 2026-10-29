import { Storage } from '@vybestack/llxprt-code-settings';
import { mkdtemp, realpath, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'bun:test';
import { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { buildAgent } from './helpers/agentHarness.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const cleanups: Array<() => Promise<void>> = [];

async function physicalMemory(): Promise<{
  directory: string;
  file: string;
  memory: WorkspaceMemoryOwner;
}> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'borrowed-memory-')),
  );
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, '.git'));
  const file = join(directory, 'LLXPRT.md');
  await writeFile(file, 'Initial caller instructions.');
  const filesystem = new WorkspaceFilesystemOwner({
    targetDir: directory,
    isTrusted: () => true,
  });
  cleanups.push(() => filesystem.dispose());
  const memory = new WorkspaceMemoryOwner({
    globalMemoryDir: Storage.getGlobalMemoryDir(),
    workingDirectory: directory,
    jitEnabled: false,
    debugMode: false,
    loadIncludes: false,
    filtering: { respectGitIgnore: true, respectLlxprtIgnore: true },
    maxDirectories: 100,
    filenames: ['LLXPRT.md'],
    importFormat: 'tree',
    paths: filesystem.paths,
    ignore: filesystem.ignore,
    scans: filesystem.scans,
    isTrusted: () => true,
    extensions: () => [],
  });
  cleanups.push(() => memory.dispose());
  expect((await memory.operations.refresh()).memoryContent).toContain(
    'Initial caller instructions.',
  );
  return { directory, file, memory };
}

describe('supplied workspace memory lifetime through public adoption', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('transfers supplied memory, closes admission synchronously and joins accepted physical publication', async () => {
    const { directory, file, memory } = await physicalMemory();
    const built = await buildAgent('plain-text.jsonl', {
      workingDir: directory,
      memoryOwner: { owner: memory, ownership: 'agent' },
      folderTrust: true,
      skillsSupport: false,
      mcpEnabled: false,
      recording: { enabled: false },
      telemetry: { enabled: false },
      settings: { jitContextEnabled: false },
      harness: { includeProcessCwd: false },
    });
    const facade = built.agent;
    cleanups.push(built.cleanup);
    let enter: () => void = () => {
      throw new Error('Missing publication entry');
    };
    let release: () => void = () => {
      throw new Error('Missing publication release');
    };
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const unsubscribe = memory.operations.subscribe(async (reads) => {
      if (!reads.snapshot().memoryContent.includes('Accepted physical change.'))
        return;
      enter();
      await held;
    });
    await writeFile(file, 'Accepted physical change.');
    const refresh = memory.operations.refresh();
    await entered;
    let closed = false;
    const closing = facade.dispose().then(() => {
      closed = true;
    });
    try {
      expect(() => memory.operations.refresh()).toThrow('disposed');
      await Promise.resolve();
      expect(closed).toBe(false);
    } finally {
      release();
      unsubscribe();
      expect((await refresh).memoryContent).toContain(
        'Accepted physical change.',
      );
      await closing;
    }
    expect(() => memory.operations.snapshot()).toThrow('disposed');
  });
});
