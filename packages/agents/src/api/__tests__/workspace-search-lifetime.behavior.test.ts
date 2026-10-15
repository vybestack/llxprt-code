import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkspaceControl,
  type WorkspaceControlDeps,
} from '../control/workspaceControl.js';
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
  let deps: WorkspaceControlDeps;
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
    deps = {
      checkpoints: operations.checkpointOperations,
      profileDefinitions: operations.profileDefinitions,
      profileWrites: operations.profileWrites,
      subagentDefinitions: operations.subagentDefinitions,
      subagentWrites: operations.subagentWrites,
      directories: operations.workspacePaths.directories,
      ignore: operations.workspaceIgnore,
      search: operations.workspaceSearch,
      files: operations.workspaceFiles,
      containsPath: operations.workspacePaths.contains,
      addDirectory: operations.addWorkspaceDirectory,
      workingDirectory: directory,
      projectRoot: directory,
    };
    cleanup = () =>
      runCleanupSteps([
        () => operations.dispose(),
        () => policy.dispose(),
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
  }

  it('joins an admitted filesystem search and rejects new search and directory writes', async () => {
    await setup();
    const entered = gate();
    const release = gate();
    const owner = new WorkspaceControl({
      ...deps,
      search: {
        initializeSearch: deps.search.initializeSearch,
        search: async (...args) => {
          entered.release();
          await release.promise;
          return deps.search.search(...args);
        },
      },
    });
    const peer = new WorkspaceControl(deps);
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

  it('collects held search and initialization failures without closing borrowed services', async () => {
    await setup();
    const release = gate();
    const searchFailure = new Error('Search failed');
    const initFailure = new Error('Search initialization failed');
    const owner = new WorkspaceControl({
      ...deps,
      search: {
        initializeSearch: async () => {
          await release.promise;
          throw initFailure;
        },
        search: async () => {
          await release.promise;
          throw searchFailure;
        },
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
      await work;
      const error = await outcome;
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError))
        throw new Error('Missing search cleanup failures');
      expect(new Set(error.errors)).toStrictEqual(
        new Set([searchFailure, initFailure]),
      );
      expect(
        (
          await deps.search.search(directory, 'owned-search.txt', {
            respectGitIgnore: false,
            respectLlxprtIgnore: false,
          })
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
