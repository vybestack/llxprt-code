/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GlobTool, type GlobToolParams } from '../tools/glob.js';
import type { IToolHost } from '../interfaces/index.js';
import type { ToolResult } from '../index.js';

interface FilterCall {
  paths: string[];
  opts: { respectGitIgnore: boolean; respectLlxprtIgnore: boolean };
}

function createTempDir(prefix = 'llxprt-glob-test-'): {
  dir: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

function createHost(
  targetDir: string,
  defaultFiltering: {
    respectGitIgnore: boolean;
    respectLlxprtIgnore: boolean;
  },
  filterImpl: (
    paths: string[],
    opts: { respectGitIgnore: boolean; respectLlxprtIgnore: boolean },
  ) => string[],
): { host: IToolHost; calls: FilterCall[] } {
  const calls: FilterCall[] = [];
  const host: IToolHost = {
    getTargetDir: () => targetDir,
    getWorkspaceRoots: () => [targetDir],
    getApprovalMode: () => 'auto',
    setApprovalMode: () => {},
    isInteractive: () => false,
    hasFeatureFlag: () => false,
    getFileService: () => ({
      shouldGitIgnoreFile: () => false,
      shouldLlxprtIgnoreFile: () => false,
      shouldIgnoreFile: () => false,
      filterFiles: (paths, opts) => {
        calls.push({ paths, opts: { ...opts } });
        return filterImpl(paths, opts);
      },
    }),
    getFileFilteringOptions: () => ({ ...defaultFiltering }),
    getFileExclusions: () => [],
    getReadManyFilesExclusions: () => [],
    getFileFilteringRespectLlxprtIgnore: () =>
      defaultFiltering.respectLlxprtIgnore,
    getLlxprtIgnoreFilePath: () => null,
    recordFileRead: () => {},
    getFileSystemService: () => undefined,
    getLlxprtIgnorePatterns: () => [],
    getEphemeralSettings: () => ({
      'tool-output-max-items': 50,
      'tool-output-max-tokens': 50000,
      'tool-output-item-size-limit': 524288,
    }),
    getDebugMode: () => false,
  };
  return { host, calls };
}

async function runGlob(
  host: IToolHost,
  params: GlobToolParams,
): Promise<ToolResult> {
  const tool = new GlobTool(host);
  const invocation = tool.build(params);
  const result = await invocation.execute(new AbortController().signal);
  expect(result.error).toBeUndefined();
  return result;
}

describe('GlobTool file filtering', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'keep.js'), 'keep', 'utf-8');
    writeFileSync(join(tempDir, 'src', 'skip.js'), 'skip', 'utf-8');
  });

  afterEach(() => {
    cleanup();
  });

  it('respects .llxprtignore by default (both flags true)', async () => {
    const { host, calls } = createHost(
      tempDir,
      { respectGitIgnore: true, respectLlxprtIgnore: true },
      (paths, opts) => {
        if (opts.respectLlxprtIgnore) {
          return paths.filter((p) => !p.includes('skip.js'));
        }
        return paths;
      },
    );

    const result = await runGlob(host, { pattern: '**/*.js', path: tempDir });

    expect(calls).toHaveLength(1);
    expect(calls[0].opts.respectGitIgnore).toBe(true);
    expect(calls[0].opts.respectLlxprtIgnore).toBe(true);
    expect(result.llmContent).toContain('keep.js');
    expect(result.llmContent).not.toContain('skip.js');
  });

  it('can disable gitignore while keeping llxprtignore', async () => {
    const { host, calls } = createHost(
      tempDir,
      { respectGitIgnore: true, respectLlxprtIgnore: true },
      (paths) => paths,
    );

    const result = await runGlob(host, {
      pattern: '**/*.js',
      path: tempDir,
      file_filtering_options: { respect_git_ignore: false },
    });

    expect(calls[0].opts.respectGitIgnore).toBe(false);
    expect(calls[0].opts.respectLlxprtIgnore).toBe(true);
    expect(result.llmContent).toContain('keep.js');
    expect(result.llmContent).toContain('skip.js');
  });

  it('can disable llxprtignore while keeping gitignore', async () => {
    const { host, calls } = createHost(
      tempDir,
      { respectGitIgnore: true, respectLlxprtIgnore: true },
      (paths) => paths,
    );

    const result = await runGlob(host, {
      pattern: '**/*.js',
      path: tempDir,
      file_filtering_options: { respect_llxprt_ignore: false },
    });

    expect(calls[0].opts.respectGitIgnore).toBe(true);
    expect(calls[0].opts.respectLlxprtIgnore).toBe(false);
    expect(result.llmContent).toContain('keep.js');
    expect(result.llmContent).toContain('skip.js');
  });

  it('can disable both filters', async () => {
    const { host, calls } = createHost(
      tempDir,
      { respectGitIgnore: true, respectLlxprtIgnore: true },
      (paths) => paths,
    );

    const result = await runGlob(host, {
      pattern: '**/*.js',
      path: tempDir,
      file_filtering_options: {
        respect_git_ignore: false,
        respect_llxprt_ignore: false,
      },
    });

    expect(calls).toHaveLength(0);
    expect(result.llmContent).toContain('keep.js');
    expect(result.llmContent).toContain('skip.js');
  });

  it('top-level respect_git_ignore still works for backward compatibility', async () => {
    const { host, calls } = createHost(
      tempDir,
      { respectGitIgnore: true, respectLlxprtIgnore: true },
      (paths, opts) => {
        if (opts.respectGitIgnore || opts.respectLlxprtIgnore) {
          return paths.filter((p) => !p.includes('skip.js'));
        }
        return paths;
      },
    );

    const result = await runGlob(host, {
      pattern: '**/*.js',
      path: tempDir,
      respect_git_ignore: false,
    });

    expect(calls).toHaveLength(0);
    expect(result.llmContent).toContain('keep.js');
    expect(result.llmContent).toContain('skip.js');
  });

  it('actually filters out llxprt-ignored files from results', async () => {
    const { host } = createHost(
      tempDir,
      { respectGitIgnore: true, respectLlxprtIgnore: true },
      (paths, opts) => {
        let result = paths;
        if (opts.respectLlxprtIgnore) {
          result = result.filter((p) => !p.includes('skip.js'));
        }
        return result;
      },
    );

    const result = await runGlob(host, { pattern: '**/*.js', path: tempDir });

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('keep.js');
    expect(result.llmContent).not.toContain('skip.js');
  });

  it('file_filtering_options overrides host defaults for both flags', async () => {
    const { host, calls } = createHost(
      tempDir,
      { respectGitIgnore: false, respectLlxprtIgnore: false },
      (paths) => paths,
    );

    const result = await runGlob(host, {
      pattern: '**/*.js',
      path: tempDir,
      file_filtering_options: {
        respect_git_ignore: true,
        respect_llxprt_ignore: true,
      },
    });

    expect(calls[0].opts.respectGitIgnore).toBe(true);
    expect(calls[0].opts.respectLlxprtIgnore).toBe(true);
    expect(result.llmContent).toContain('keep.js');
    expect(result.llmContent).toContain('skip.js');
  });

  it('file_filtering_options partially overrides host defaults', async () => {
    const { host, calls } = createHost(
      tempDir,
      { respectGitIgnore: false, respectLlxprtIgnore: true },
      (paths) => paths,
    );

    const result = await runGlob(host, {
      pattern: '**/*.js',
      path: tempDir,
      file_filtering_options: { respect_git_ignore: true },
    });

    expect(calls[0].opts.respectGitIgnore).toBe(true);
    expect(calls[0].opts.respectLlxprtIgnore).toBe(true);
    expect(result.llmContent).toContain('keep.js');
    expect(result.llmContent).toContain('skip.js');
  });

  it('empty file_filtering_options falls back to host defaults', async () => {
    const { host, calls } = createHost(
      tempDir,
      { respectGitIgnore: true, respectLlxprtIgnore: true },
      (paths) => paths,
    );

    const result = await runGlob(host, {
      pattern: '**/*.js',
      path: tempDir,
      file_filtering_options: {},
    });

    expect(calls[0].opts.respectGitIgnore).toBe(true);
    expect(calls[0].opts.respectLlxprtIgnore).toBe(true);
    expect(result.llmContent).toContain('keep.js');
    expect(result.llmContent).toContain('skip.js');
  });

  it('file_filtering_options takes precedence over top-level respect_git_ignore', async () => {
    const { host, calls } = createHost(
      tempDir,
      { respectGitIgnore: false, respectLlxprtIgnore: true },
      (paths) => paths,
    );

    const result = await runGlob(host, {
      pattern: '**/*.js',
      path: tempDir,
      respect_git_ignore: false,
      file_filtering_options: { respect_git_ignore: true },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].opts.respectGitIgnore).toBe(true);
    expect(calls[0].opts.respectLlxprtIgnore).toBe(true);
    expect(result.llmContent).toContain('skip.js');
  });
});
