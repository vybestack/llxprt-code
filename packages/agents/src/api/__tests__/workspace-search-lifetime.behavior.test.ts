/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkspaceControl,
  type WorkspaceControlDeps,
} from '../control/workspaceControl.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { gate } from './helpers/recording-finalizer-join-fixture.js';

async function setup() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'llxprt-workspace-search-')),
  );
  await writeFile(join(directory, 'owned-search.txt'), 'search fixture');
  const extra = join(directory, 'extra');
  await mkdir(extra);
  const built = await buildCliStyleConfig('plain-text.jsonl', {
    workingDir: directory,
    harness: { includeProcessCwd: false },
  });
  const operations = built.mcpRuntime;
  const deps: WorkspaceControlDeps = {
    checkpoints: operations.checkpointOperations,
    profileDefinitions: operations.profileDefinitions,
    profileWrites: operations.profileWrites,
    subagentDefinitions: operations.subagentDefinitions,
    subagentWrites: operations.subagentWrites,
    directories: operations.workspacePaths.directories,
    ignore: operations.workspaceIgnore,
    search: operations.workspaceSearch,
    containsPath: operations.workspacePaths.contains,
    addDirectory: operations.addWorkspaceDirectory,
    workingDirectory: directory,
    projectRoot: directory,
  };
  return {
    directory,
    extra,
    deps,
    cleanup: async () => {
      await built.cleanup();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe('workspace search facade lifetime', () => {
  it('joins an admitted filesystem search and rejects new search and directory writes', async () => {
    const built = await setup();
    const entered = gate();
    const release = gate();
    const owner = new WorkspaceControl({
      ...built.deps,
      search: {
        initializeSearch: built.deps.search.initializeSearch,
        search: async (...args) => {
          entered.release();
          await release.promise;
          return built.deps.search.search(...args);
        },
      },
    });
    const peer = new WorkspaceControl(built.deps);
    const accepted = owner.search(built.directory, 'owned-search.txt', {
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
      expect(() => owner.search(built.directory, 'late')).toThrow(/closed/);
      expect(() => owner.initializeSearch(built.directory)).toThrow(/closed/);
      expect(() => owner.addDirectory(built.extra)).toThrow(/closed/);
      await Promise.resolve();
      expect(finished).toBe(false);
      release.release();
      expect(
        (await accepted).some((path) => path.endsWith('owned-search.txt')),
      ).toBe(true);
      await closing;
      peer.addDirectory(built.extra);
      expect(peer.getDirectories()).toContain(built.extra);
      expect(
        (
          await peer.search(built.directory, 'owned-search.txt', {
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
      await built.cleanup();
    }
  }, 30000);

  it('collects held search and initialization failures without closing borrowed services', async () => {
    const built = await setup();
    const release = gate();
    const searchFailure = new Error('Search failed');
    const initFailure = new Error('Search initialization failed');
    const owner = new WorkspaceControl({
      ...built.deps,
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
      owner.search(built.directory, 'held'),
      owner.initializeSearch(built.directory),
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
          await built.deps.search.search(built.directory, 'owned-search.txt', {
            respectGitIgnore: false,
            respectLlxprtIgnore: false,
          })
        ).length,
      ).toBeGreaterThan(0);
    } finally {
      release.release();
      await work;
      await outcome;
      await built.cleanup();
    }
  }, 30000);
});
