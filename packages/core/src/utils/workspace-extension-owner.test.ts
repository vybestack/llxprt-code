import { WorkspaceTrustLifecycle } from '../services/workspace-trust-lifecycle.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceFilesystemOwner } from '../services/workspace-filesystem-owner.js';
import { assembleWorkspaceMemory } from '../config/workspace-memory-assembly.js';
import { Config, type LlxprtExtension } from '../config/config.js';
import { WorkspaceExtensionOwner } from './workspace-extension-owner.js';

function extension(name: string): LlxprtExtension {
  return {
    name,
    version: '1',
    path: process.cwd(),
    contextFiles: [],
    isActive: true,
  };
}

function configuration(
  extensions: LlxprtExtension[],
  reloading: boolean,
): Config {
  return new Config({
    sessionId: 'extension-owner',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'test',
    extensions,
    enableExtensionReloading: reloading,
  });
}

function gate(): { promise: Promise<void>; release(): void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('workspace extension owner lifetime', () => {
  it('stops root-owned startup extensions even when dynamic reloading is disabled', async () => {
    const config = configuration([extension('alpha')], false);
    const active = new Set<string>();
    const root = new WorkspaceExtensionOwner(config, undefined, async () => {});
    try {
      await root.initialize(
        async (item) => {
          active.add(item.name);
        },
        async (item) => {
          active.delete(item.name);
        },
        async () => {},
        async () => {},
      );
      expect(active.size).toBe(1);
      await root.dispose();
      expect([...active]).toStrictEqual([]);
      expect(config.getExtensions()).toStrictEqual([]);
    } finally {
      await root.dispose();
      await config.dispose();
    }
  });

  it('settles all startup transitions before failure and disposal, then aggregates stop failures', async () => {
    const config = configuration([extension('alpha'), extension('beta')], true);
    const pending = gate();
    const entered = gate();
    const active = new Set<string>();
    const failure = new Error('alpha startup rejected');
    const stopFailure = new Error('alpha stop rejected');
    const root = new WorkspaceExtensionOwner(config, undefined, async () => {});
    const starting = root.initialize(
      async (item) => {
        if (item.name === 'alpha') throw failure;
        entered.release();
        await pending.promise;
        active.add(item.name);
      },
      async (item) => {
        if (item.name === 'alpha') throw stopFailure;
        active.delete(item.name);
      },
      async () => {},
      async () => {},
    );
    const observed = starting.catch((error: unknown) => error);
    try {
      await entered.promise;
      const closing = root.dispose().catch((error: unknown) => error);
      await expect(root.operations.restart(extension('beta'))).rejects.toThrow(
        'closed',
      );
      pending.release();
      const startupError = await observed;
      if (!(startupError instanceof AggregateError))
        throw new Error('Missing startup aggregate');
      expect(startupError.errors).toStrictEqual([failure]);
      const cleanupError = await closing;
      if (!(cleanupError instanceof AggregateError))
        throw new Error('Missing cleanup aggregate');
      expect(cleanupError.errors).toStrictEqual([startupError, stopFailure]);
      expect([...active]).toStrictEqual([]);
    } finally {
      pending.release();
      await config.dispose();
    }
  });

  it('emits progress from the composed default loader and isolates list arrays', async () => {
    const config = configuration([], true);
    const progress: number[] = [];
    const root = new WorkspaceExtensionOwner(config, undefined, async () => {});
    root.operations.subscribeProgress('extensionsStarting', (event) => {
      progress.push(event.completed);
    });
    try {
      await root.initialize(
        async () => {},
        async () => {},
        async () => {},
        async () => {},
      );
      await root.operations.load(extension('alpha'));
      root.operations.list().splice(0);
      config.getExtensions().splice(0);
      expect(progress).toStrictEqual([0, 1]);
      expect(root.operations.list().map((item) => item.name)).toStrictEqual([
        'alpha',
      ]);
      expect(config.getExtensions().map((item) => item.name)).toStrictEqual([
        'alpha',
      ]);
    } finally {
      await root.dispose();
      await config.dispose();
    }
  });
  it('publishes physical instructions from an accepted extension before joining shutdown', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'extension-instructions-'));
    await mkdir(join(directory, '.git'));
    const filename = join(directory, 'EXTENSION.md');
    await writeFile(filename, 'Use the accepted extension instructions.');
    const config = new Config({
      sessionId: 'extension-memory',
      targetDir: directory,
      cwd: directory,
      debugMode: false,
      model: 'test',
      jitContextEnabled: true,
      folderTrust: true,
      enableExtensionReloading: true,
    });
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => trust.isTrustedFolder(),
    });
    const memory = assembleWorkspaceMemory(config, filesystem, trust);
    const entered = gate();
    const held = gate();
    const root = new WorkspaceExtensionOwner(
      config,
      undefined,
      async () => {
        await memory.operations.refresh();
      },
      (operation) => memory.withReload(operation),
    );
    let observed = '';
    memory.operations.subscribe(() => {
      observed = memory.operations.snapshot().environmentMemory;
    });
    try {
      await root.initialize(
        async () => {
          entered.release();
          await held.promise;
        },
        async () => {},
        async () => {},
        async () => {},
      );
      const loading = root.operations.load({
        ...extension('physical'),
        path: directory,
        contextFiles: [filename],
      });
      await entered.promise;
      memory.closeAdmission();
      const closing = root.dispose();
      await expect(root.operations.load(extension('later'))).rejects.toThrow(
        'closed',
      );
      held.release();
      await loading;
      await closing;
      expect(observed).toContain('Use the accepted extension instructions.');
    } finally {
      held.release();
      const results = await Promise.allSettled([
        root.dispose(),
        memory.dispose(),
      ]);
      await filesystem.dispose();
      await trust.dispose();
      await config.dispose();
      await rm(directory, { recursive: true, force: true });
      const failures = results.flatMap((r) =>
        r.status === 'rejected' ? [r.reason] : [],
      );
      expect(failures).toStrictEqual([]);
    }
  });
  it('settles a rejected progress subscriber and permits a later complete transition', async () => {
    const config = configuration([], true);
    const root = new WorkspaceExtensionOwner(config, undefined, async () => {});
    await root.initialize(
      async () => {},
      async () => {},
      async () => {},
      async () => {},
    );
    const completed: number[] = [];
    const release = root.operations.subscribeProgress(
      'extensionsStarting',
      () => {
        throw new Error('subscriber rejected');
      },
    );
    root.operations.subscribeProgress('extensionsStarting', (event) =>
      completed.push(event.completed),
    );
    try {
      await expect(root.operations.load(extension('rejected'))).rejects.toThrow(
        'progress',
      );
      release();
      await root.operations.load(extension('accepted'));
      expect(completed).toStrictEqual([0, 1, 0, 1]);
      expect(root.operations.list().map((entry) => entry.name)).toStrictEqual([
        'accepted',
      ]);
    } finally {
      await root.dispose();
      await config.dispose();
    }
  });
});
