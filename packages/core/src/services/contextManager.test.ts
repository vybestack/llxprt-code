import { Storage } from '@vybestack/llxprt-code-settings';
/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceFilesystemOwner } from './workspace-filesystem-owner.js';
import { ContextManager } from './contextManager.js';

describe('workspace instruction discovery and publication', () => {
  let directory: string;
  let globalDirectory: string;
  let previousHome: string | undefined;
  let filesystem: WorkspaceFilesystemOwner;
  let memory: ContextManager;

  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'memory-context-')),
    );
    globalDirectory = join(directory, 'global');
    await mkdir(globalDirectory);
    await mkdir(join(directory, '.git'));
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = globalDirectory;
    filesystem = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => true,
    });
    memory = new ContextManager({
      globalMemoryDir: Storage.getGlobalMemoryDir(),
      workingDirectory: directory,
      jitEnabled: true,
      debugMode: false,
      loadIncludes: true,
      importFormat: 'tree',
      maxDirectories: 200,
      filenames: ['LLXPRT.md'],
      filtering: { respectGitIgnore: false, respectLlxprtIgnore: true },
      paths: filesystem.paths,
      ignore: filesystem.ignore,
      scans: filesystem.scans,
      isTrusted: () => true,
      extensions: () => [],
    });
  });

  afterEach(async () => {
    await memory.dispose();
    await filesystem.dispose();
    await rm(directory, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousHome;
  });

  it('refreshes the selected global memory directory after another owner changes the environment root', async () => {
    await writeFile(
      join(globalDirectory, 'LLXPRT.md'),
      'Selected global instructions',
    );
    const peerDirectory = join(directory, 'peer-global');
    await mkdir(peerDirectory);
    await writeFile(
      join(peerDirectory, 'LLXPRT.md'),
      'Peer global instructions',
    );
    process.env.LLXPRT_CONFIG_HOME = peerDirectory;
    const snapshot = await memory.operations.refresh();
    expect(snapshot.globalMemory).toContain('Selected global instructions');
    expect(snapshot.globalMemory).not.toContain('Peer global instructions');
    expect(snapshot.environmentMemory).not.toContain(
      'Peer global instructions',
    );
  });

  it('loads and formats global and environment memory through separate channels', async () => {
    await writeFile(join(globalDirectory, 'LLXPRT.md'), 'Global Content');
    await writeFile(join(directory, 'LLXPRT.md'), 'Env Content');
    const snapshot = await memory.operations.refresh();
    expect(snapshot.globalMemory).toContain('Global Content');
    expect(snapshot.globalMemory).not.toContain('Env Content');
    expect(snapshot.environmentMemory).toContain('Env Content');
    expect(snapshot.environmentMemory).not.toContain('Global Content');
  });

  it('publishes the newly loaded file count to root-local subscribers', async () => {
    await writeFile(join(directory, 'LLXPRT.md'), 'Instructions');
    const observed: number[] = [];
    const release = memory.operations.subscribe(() => {
      observed.push(memory.operations.snapshot().fileCount);
    });
    try {
      await memory.operations.refresh();
      expect(observed).toStrictEqual([1]);
      expect(memory.operations.snapshot().filePaths).toStrictEqual([
        join(directory, 'LLXPRT.md'),
      ]);
    } finally {
      release();
    }
  });

  it('loads core memory independently of ordinary context instructions', async () => {
    await mkdir(join(directory, '.llxprt'));
    await writeFile(
      join(directory, '.llxprt', '.LLXPRT_SYSTEM'),
      'Core content',
    );
    const snapshot = await memory.operations.refresh();
    expect(snapshot.coreMemory).toContain('Core content');
    expect(snapshot.coreMemoryFileCount).toBe(1);
    expect(snapshot.memoryContent).not.toContain('Core content');
  });

  it('publishes separate core and context counts from actual discovered files', async () => {
    await mkdir(join(directory, '.llxprt'));
    await writeFile(join(directory, '.llxprt', '.LLXPRT_SYSTEM'), 'Core');
    await writeFile(join(directory, 'LLXPRT.md'), 'Context');
    const observed: Array<{ core: number; context: number }> = [];
    memory.operations.subscribe(() => {
      const snapshot = memory.operations.snapshot();
      observed.push({
        core: snapshot.coreMemoryFileCount,
        context: snapshot.fileCount,
      });
    });
    await memory.operations.refresh();
    expect(observed).toStrictEqual([{ core: 1, context: 1 }]);
  });

  it('loads nested JIT instructions without repeating the loaded root file', async () => {
    await writeFile(join(directory, 'LLXPRT.md'), 'Root instructions');
    await mkdir(join(directory, 'nested'));
    await writeFile(
      join(directory, 'nested', 'LLXPRT.md'),
      'Nested instructions',
    );
    await memory.operations.refresh();
    const jit = await memory.operations.jit(
      join(directory, 'nested', 'absent.ts'),
    );
    expect(jit).toContain('Nested instructions');
    expect(jit).not.toContain('Root instructions');
  });

  it('returns no JIT text when the available instruction files are already loaded', async () => {
    await writeFile(join(directory, 'LLXPRT.md'), 'Root instructions');
    await memory.operations.refresh();
    expect(await memory.operations.jit(join(directory, 'absent.ts'))).toBe('');
  });
  it('disables JIT without reading a nested instruction file', async () => {
    const disabled = new ContextManager({
      globalMemoryDir: Storage.getGlobalMemoryDir(),
      workingDirectory: directory,
      jitEnabled: false,
      debugMode: false,
      loadIncludes: false,
      importFormat: 'tree',
      maxDirectories: 200,
      filenames: ['LLXPRT.md'],
      filtering: { respectGitIgnore: false, respectLlxprtIgnore: true },
      paths: filesystem.paths,
      ignore: filesystem.ignore,
      scans: filesystem.scans,
      isTrusted: () => true,
      extensions: () => [],
    });
    try {
      await mkdir(join(directory, 'nested'));
      await writeFile(
        join(directory, 'nested', 'LLXPRT.md'),
        'Do not load this disabled file',
      );
      expect(
        await disabled.operations.jit(join(directory, 'nested', 'absent.ts')),
      ).toBe('');
    } finally {
      await disabled.dispose();
    }
  });
  it('returns no JIT text when no instruction files exist', async () => {
    await memory.operations.refresh();
    expect(await memory.operations.jit(join(directory, 'absent.ts'))).toBe('');
  });
});
