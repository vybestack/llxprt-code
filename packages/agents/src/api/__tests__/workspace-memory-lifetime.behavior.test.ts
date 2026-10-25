import { Storage } from '@vybestack/llxprt-code-settings';
import { mkdtemp, realpath, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'bun:test';
import { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import { Agent } from '../agent.js';
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

  for (const reverse of [false, true]) {
    it(`keeps the caller and peer refreshing physical memory after facade disposal order ${reverse}`, async () => {
      const { directory, file, memory } = await physicalMemory();
      const facades: Agent[] = [];
      for (const index of [0, 1]) {
        const built = await buildAgent('plain-text.jsonl', {
          workingDir: directory,
          sessionId: 'same-memory-label',
          memoryOwner: { owner: memory },
          folderTrust: true,
          skillsSupport: false,
          mcpEnabled: false,
          recording: { enabled: false },
          telemetry: { enabled: false },
          settings: { jitContextEnabled: false },
          harness: { includeProcessCwd: false },
        });
        cleanups.push(built.cleanup);
        const facade = built.agent;
        facade.memory.setMemory(`Private facade ${index}`);
        facades.push(facade);
      }
      const first = facades[reverse ? 1 : 0];
      const second = facades[reverse ? 0 : 1];
      expect(facades[1]?.memory.getMemory()).not.toContain('Private facade 0');
      await first.dispose();
      await writeFile(file, 'Caller file after first facade.');
      await memory.operations.refresh();
      expect(memory.operations.snapshot().filePaths).toContain(file);
      await second.memory.refresh();
      expect(second.memory.getMemory()).toContain(
        'Caller file after first facade.',
      );
      await second.dispose();
      await writeFile(file, 'Caller file after both facades.');
      expect((await memory.operations.refresh()).memoryContent).toContain(
        'Caller file after both facades.',
      );
    });
  }
});
