import { Storage } from '@vybestack/llxprt-code-settings';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTool } from '@vybestack/llxprt-code-tools';
import { CoreStorageServiceAdapter } from '../tools-adapters/CoreStorageServiceAdapter.js';
import { readFile } from 'node:fs/promises';
import { WorkspaceFilesystemOwner } from './workspace-filesystem-owner.js';
import {
  WorkspaceMemoryOwner,
  type InstructionReadOperations,
} from './workspace-memory-owner.js';
import type { WorkspaceScanOperations } from './workspace-filesystem-owner.js';

let directory = '';
let previousHome: string | undefined;
const releases: Array<() => Promise<void>> = [];

function owners(
  jitEnabled: boolean,
  scans?: WorkspaceScanOperations,
  filenames?: readonly string[],
) {
  let trusted = true;
  const filesystem = new WorkspaceFilesystemOwner({
    targetDir: directory,
    isTrusted: () => trusted,
  });
  const memory = new WorkspaceMemoryOwner({
    globalMemoryDir: Storage.getGlobalMemoryDir(),
    workingDirectory: directory,
    jitEnabled,
    debugMode: false,
    loadIncludes: true,
    filtering: { respectGitIgnore: false, respectLlxprtIgnore: true },
    maxDirectories: 200,
    importFormat: 'tree',
    filenames,
    paths: filesystem.paths,
    ignore: filesystem.ignore,
    scans: scans ?? filesystem.scans,
    isTrusted: () => trusted,
    extensions: () => [],
  });
  releases.push(async () => {
    await memory.dispose();
    await filesystem.dispose();
  });
  return {
    filesystem,
    memory,
    revoke: () => {
      trusted = false;
      filesystem.notifyTrustChanged();
    },
  };
}

function heldScan(real: WorkspaceScanOperations) {
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scans: WorkspaceScanOperations = {
    run: (directories, operation) =>
      real.run(directories, async () => {
        started();
        await gate;
        return operation();
      }),
  };
  return { scans, entered, release };
}

describe('physical workspace instruction discovery', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'instruction-scans-'));
    await mkdir(join(directory, '.git'));
    await mkdir(join(directory, 'global'));
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = join(directory, 'global');
  });
  afterEach(async () => {
    for (const release of releases.splice(0)) await release();
    if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousHome;
    await rm(directory, { recursive: true, force: true });
  });

  it('loads global, project, subdirectory and core files into separate channels', async () => {
    await writeFile(
      join(directory, 'global', 'LLXPRT.md'),
      'Global user instruction.',
    );
    await writeFile(join(directory, 'LLXPRT.md'), 'Project user instruction.');
    await mkdir(join(directory, 'child'));
    await writeFile(
      join(directory, 'child', 'LLXPRT.md'),
      'Nested user instruction.',
    );
    await mkdir(join(directory, '.llxprt'));
    await writeFile(
      join(directory, '.llxprt', '.LLXPRT_SYSTEM'),
      'Project system instruction.',
    );
    const { memory } = owners(false);
    const snapshot = await memory.operations.refresh();
    expect(snapshot.memoryContent).toContain('Global user instruction.');
    expect(snapshot.memoryContent).toContain('Project user instruction.');
    expect(snapshot.memoryContent).toContain('Nested user instruction.');
    expect(snapshot.coreMemory).toContain('Project system instruction.');
    expect(snapshot.memoryContent).not.toContain('Project system instruction.');
    expect(snapshot.coreMemoryFileCount).toBe(1);
  });

  it('withdraws external cached instructions immediately on trust revocation', async () => {
    const external = await mkdtemp(join(tmpdir(), 'external-memory-'));
    try {
      await mkdir(join(external, '.git'));
      await writeFile(
        join(external, 'LLXPRT.md'),
        'Privileged external instructions.',
      );
      const { memory, filesystem, revoke } = owners(true);
      filesystem.addDirectory(external);
      await memory.operations.refresh();
      expect(memory.operations.snapshot().environmentMemory).toContain(
        'Privileged external instructions.',
      );
      revoke();
      expect(memory.operations.snapshot().environmentMemory).not.toContain(
        'Privileged external instructions.',
      );
      expect(await memory.operations.jit(external)).toBe('');
    } finally {
      await rm(external, { recursive: true, force: true });
    }
  });

  it('expires publication reads after settlement without stopping admitted nested scans', async () => {
    await mkdir(join(directory, 'child'));
    await writeFile(
      join(directory, 'child', 'LLXPRT.md'),
      'Accepted nested publication.',
    );
    const { memory } = owners(true);
    let retained: InstructionReadOperations | undefined;
    let observed = '';
    memory.operations.subscribe(async (reads) => {
      retained = reads;
      memory.closeAdmission();
      observed = await reads.jit(join(directory, 'child'));
    });
    await memory.operations.refresh();
    expect(observed).toContain('Accepted nested publication.');
    if (retained === undefined)
      throw new Error('Publication reads were not delivered');
    const settledReads = retained;
    expect(() => settledReads.snapshot()).toThrow('settled');
    expect(() => settledReads.jit(join(directory, 'child'))).toThrow('settled');
  });

  it('uses live ignores for JIT files without re-admitting root instruction content', async () => {
    await writeFile(join(directory, 'LLXPRT.md'), 'Root already loaded.');
    await mkdir(join(directory, 'child'));
    await writeFile(
      join(directory, 'child', 'LLXPRT.md'),
      'Nested JIT instructions.',
    );
    const { memory } = owners(true);
    await memory.operations.refresh();
    const jit = await memory.operations.jit(join(directory, 'child'));
    expect(jit).toContain('Nested JIT instructions.');
    expect(jit).not.toContain('Root already loaded.');
    await writeFile(join(directory, '.llxprtignore'), 'child/');
    expect(await memory.operations.jit(join(directory, 'child'))).toBe('');
  });

  it('rejects a scan whose external authority is revoked while physical discovery is held', async () => {
    const external = await mkdtemp(join(tmpdir(), 'held-memory-'));
    const real = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => true,
    });
    real.addDirectory(external);
    const held = heldScan(real.scans);
    const { memory, filesystem, revoke } = owners(true, held.scans);
    filesystem.addDirectory(external);
    await writeFile(
      join(external, 'LLXPRT.md'),
      'Held privileged instructions.',
    );
    const refreshing = memory.operations.refresh();
    await held.entered;
    revoke();
    held.release();
    try {
      await refreshing;
      expect(memory.operations.snapshot().environmentMemory).not.toContain(
        'Held privileged instructions.',
      );
    } finally {
      await real.dispose();
      await rm(external, { recursive: true, force: true });
    }
  });

  it('keeps independently configured instruction filenames for roots sharing physical files', async () => {
    await writeFile(
      join(directory, 'ALPHA.md'),
      'Alpha-specific instructions.',
    );
    await writeFile(join(directory, 'BETA.md'), 'Beta-specific instructions.');
    const alpha = owners(true, undefined, ['ALPHA.md']);
    const beta = owners(true, undefined, ['BETA.md']);
    await alpha.memory.operations.refresh();
    await beta.memory.operations.refresh();
    expect(alpha.memory.operations.snapshot().environmentMemory).toContain(
      'Alpha-specific instructions.',
    );
    expect(alpha.memory.operations.snapshot().environmentMemory).not.toContain(
      'Beta-specific instructions.',
    );
    expect(beta.memory.operations.snapshot().environmentMemory).toContain(
      'Beta-specific instructions.',
    );
    expect(beta.memory.operations.snapshot().environmentMemory).not.toContain(
      'Alpha-specific instructions.',
    );
  });

  it('loads the root-specific filename for nested JIT paths including not-yet-created targets', async () => {
    await mkdir(join(directory, 'child'));
    await writeFile(
      join(directory, 'child', 'ALPHA.md'),
      'Nested alpha instruction.',
    );
    await writeFile(
      join(directory, 'child', 'LLXPRT.md'),
      'Default filename must not leak.',
    );
    const { memory } = owners(true, undefined, ['ALPHA.md']);
    await memory.operations.refresh();
    const instructions = await memory.operations.jit(
      join(directory, 'child', 'new-file.ts'),
    );
    expect(instructions).toContain('Nested alpha instruction.');
    expect(instructions).not.toContain('Default filename must not leak.');
  });

  it('writes the configured project and global filename independently of other roots', async () => {
    const alpha = new MemoryTool({
      storageService: new CoreStorageServiceAdapter(),
      getWorkingDir: () => directory,
      contextFilename: 'ALPHA.md',
    });
    const beta = new MemoryTool({
      storageService: new CoreStorageServiceAdapter(),
      getWorkingDir: () => directory,
      contextFilename: 'BETA.md',
    });
    await alpha.execute({
      fact: 'Remember the alpha project.',
      scope: 'project',
    });
    await beta.execute({ fact: 'Remember the beta global.', scope: 'global' });
    expect(
      await readFile(join(directory, '.llxprt', 'ALPHA.md'), 'utf8'),
    ).toContain('Remember the alpha project.');
    expect(
      await readFile(join(directory, 'global', 'BETA.md'), 'utf8'),
    ).toContain('Remember the beta global.');
  });

  it('closes new reload admission synchronously and joins accepted scan and publication', async () => {
    await writeFile(
      join(directory, 'LLXPRT.md'),
      'Accepted instruction reload.',
    );
    const real = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => true,
    });
    const held = heldScan(real.scans);
    const { memory } = owners(false, held.scans);
    let observed = '';
    memory.operations.subscribe(() => {
      observed = memory.operations.snapshot().memoryContent;
    });
    const refreshing = memory.operations.refresh();
    await held.entered;
    const closing = memory.dispose();
    expect(() => memory.operations.refresh()).toThrow('disposed');
    held.release();
    await refreshing;
    await closing;
    await real.dispose();
    expect(observed).toContain('Accepted instruction reload.');
    expect(() => memory.operations.snapshot()).toThrow('disposed');
  });
  it('withdraws cached instruction paths after their directory symlink escapes the admitted root', async () => {
    const external = await mkdtemp(join(tmpdir(), 'instruction-escape-'));
    await mkdir(join(directory, 'physical'));
    await writeFile(
      join(directory, 'physical', 'LLXPRT.md'),
      'Initially admitted instructions.',
    );
    await writeFile(join(external, 'LLXPRT.md'), 'External instructions.');
    await symlink(
      join(directory, 'physical', 'LLXPRT.md'),
      join(directory, 'LLXPRT.md'),
    );
    const { memory } = owners(true);
    try {
      await memory.operations.refresh();
      expect(memory.operations.snapshot().environmentMemory).toContain(
        'Initially admitted instructions.',
      );
      await rm(join(directory, 'LLXPRT.md'));
      await symlink(join(external, 'LLXPRT.md'), join(directory, 'LLXPRT.md'));
      expect(memory.operations.snapshot().environmentMemory).not.toContain(
        'Initially admitted instructions.',
      );
    } finally {
      await rm(external, { recursive: true, force: true });
    }
  });
  it('withdraws cached project instructions immediately when live ignore rules exclude them', async () => {
    await writeFile(
      join(directory, 'LLXPRT.md'),
      'Initially admitted project instructions.',
    );
    const { memory } = owners(true);
    await memory.operations.refresh();
    expect(memory.operations.snapshot().fileCount).toBe(1);
    await writeFile(join(directory, '.llxprtignore'), 'LLXPRT.md\n');
    expect(memory.operations.snapshot().fileCount).toBe(0);
  });
});
