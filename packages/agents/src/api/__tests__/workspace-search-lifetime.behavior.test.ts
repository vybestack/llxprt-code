import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceControl } from '../control/workspaceControl.js';
import type { WorkspaceSearchOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { randomUUID } from 'node:crypto';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { gate } from './helpers/recording-finalizer-join-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('workspace search facade lifetime', () => {
  let directory: string;
  let extra: string;
  let config: Config;
  let operations: McpRuntimeOwner;
  let cleanup: () => Promise<void>;
  async function setup(): Promise<void> {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'llxprt-workspace-search-')),
    );
    await writeFile(join(directory, 'owned-search.txt'), 'search fixture');
    extra = join(directory, 'extra');
    await mkdir(extra);
    config = new Config({
      sessionId: randomUUID(),
      targetDir: directory,
      cwd: directory,
      model: 'fake-model',
      debugMode: false,
    });
    const policy = new RuntimePolicyOwner(config);
    operations = await buildTestMcpRuntime(
      config,
      policy.session.messageBus,
      {},
      undefined,
      policy,
    );
    await operations.initialize();
    cleanup = () =>
      runCleanupSteps([
        () => operations.dispose(),
        () => policy.dispose(),
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
  }

  function createControl(
    search: WorkspaceSearchOperations = operations.workspaceSearch,
  ): WorkspaceControl {
    return new WorkspaceControl(
      operations.profileDefinitions,
      operations.profileWrites,
      operations.subagentDefinitions,
      operations.subagentWrites,
      operations.checkpointOperations,
      operations.workspaceIgnore,
      search,
      operations.workspaceFiles,
      operations.workspacePaths.contains,
      operations.workspacePaths.directories,
      operations.addWorkspaceDirectory,
      directory,
      directory,
    );
  }

  it('joins an admitted filesystem search and rejects new search and directory writes', async () => {
    await setup();
    const entered = gate();
    const release = gate();
    const owner = createControl({
      initializeSearch: operations.workspaceSearch.initializeSearch,
      search: async (...args) => {
        entered.release();
        await release.promise;
        return operations.workspaceSearch.search(...args);
      },
    });
    const peer = createControl();
    const accepted = owner.search(directory, 'owned-search.txt', {
      respectGitIgnore: false,
      respectLlxprtIgnore: false,
    });
    await entered.promise;
    const closing = owner.dispose();
    let finished = false;
    void closing.then(() => {
      finished = true;
    });
    try {
      expect(() => owner.search(directory, 'late')).toThrow(/closed/);
      expect(() => owner.initializeSearch(directory)).toThrow(/closed/);
      expect(() => owner.addDirectory(extra)).toThrow(/closed/);
      await Promise.resolve();
      expect(finished).toBe(false);
      release.release();
      expect(
        (await accepted).some((path) => path.endsWith('owned-search.txt')),
      ).toBe(true);
      await closing;
      peer.addDirectory(extra);
      expect(peer.getDirectories()).toContain(extra);
      expect(
        (
          await peer.search(directory, 'owned-search.txt', {
            respectGitIgnore: false,
            respectLlxprtIgnore: false,
          })
        ).length,
      ).toBeGreaterThan(0);
      expect(owner.dispose()).toBe(closing);
    } finally {
      release.release();
      await accepted;
      await closing;
      await peer.dispose();
      await cleanup();
    }
  }, 30000);

  it('joins held search and initialization failures without reporting them and without closing borrowed services', async () => {
    await setup();
    const release = gate();
    const searchFailure = new Error('Search failed');
    const initFailure = new Error('Search initialization failed');
    const owner = createControl({
      initializeSearch: async () => {
        await release.promise;
        throw initFailure;
      },
      search: async () => {
        await release.promise;
        throw searchFailure;
      },
    });
    const accepted = [
      owner.search(directory, 'held'),
      owner.initializeSearch(directory),
    ];
    const work = Promise.allSettled(accepted);
    const closing = owner.dispose();
    const outcome = closing.then(
      () => undefined,
      (error: unknown) => error,
    );
    try {
      release.release();
      const callerOutcomes = await work;
      expect(callerOutcomes.map((result) => result.status)).toStrictEqual([
        'rejected',
        'rejected',
      ]);
      expect(
        callerOutcomes.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        ),
      ).toStrictEqual([searchFailure, initFailure]);
      expect(await outcome).toBeUndefined();
      expect(
        (
          await operations.workspaceSearch.search(
            directory,
            'owned-search.txt',
            {
              respectGitIgnore: false,
              respectLlxprtIgnore: false,
            },
          )
        ).length,
      ).toBeGreaterThan(0);
    } finally {
      release.release();
      await work;
      await outcome;
      await cleanup();
    }
  }, 30000);
});
