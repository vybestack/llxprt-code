/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ZedPathResolver focusing on recursive glob search:
 * glob entries returned relative to cwd must not be passed through
 * path.relative again.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { ZedPathResolver } from './zed-path-resolver.js';
import type { Config, ContentBlock } from '@vybestack/llxprt-code-core';

describe('ZedPathResolver - recursive glob search', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'zed-path-resolver-test-'),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function buildConfig(targetDir: string): Config {
    return {
      getTargetDir: () => targetDir,
      getFileService: () => ({
        shouldIgnoreFile: (filePath: string) =>
          filePath.includes('ignored-target-file.ts'),
      }),
      getFileFilteringOptions: () => ({
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
      getEnableRecursiveFileSearch: () => true,
      getFileExclusions: () => ({
        getCoreIgnorePatterns: () => ['node_modules/**'],
      }),
      getFileSystemService: () => ({
        readTextFile: async (filePath: string) => fs.readFile(filePath, 'utf8'),
      }),
    } as unknown as Config;
  }

  it('returns a valid relative path for a deeply nested glob match', async () => {
    // Create a nested file that does not exist at the root.
    const nestedDir = path.join(tmpDir, 'src', 'deep');
    await fs.mkdir(nestedDir, { recursive: true });
    const fileName = 'target-file.ts';
    await fs.writeFile(path.join(nestedDir, fileName), 'export const x = 1;');

    const resolver = new ZedPathResolver(buildConfig(tmpDir), () => {});

    const parts = await resolver.resolvePrompt(
      [
        {
          type: 'resource_link',
          uri: `file://${fileName}`,
          name: fileName,
          mimeType: 'text/plain',
        },
      ],
      new AbortController().signal,
    );

    // The resolved @path should be the correct relative path
    // (src/deep/target-file.ts), NOT a malformed double-relative.
    const text = parts
      .filter((p): p is ContentBlock & { type: 'text' } => p.type === 'text')
      .map((p) => p.text)
      .join('');
    expect(text).toContain('@src/deep/target-file.ts');
    // The resolved path must NOT contain the absolute tmpDir (which would
    // indicate path.relative was applied to an already-relative entry).
    expect(text).not.toContain(tmpDir);
  });
  it('skips ignored files discovered by directory glob expansion', async () => {
    const visibleDir = path.join(tmpDir, 'src');
    await fs.mkdir(visibleDir, { recursive: true });
    await fs.writeFile(path.join(visibleDir, 'visible.ts'), 'visible');
    await fs.writeFile(
      path.join(visibleDir, 'ignored-target-file.ts'),
      'ignored',
    );

    const resolver = new ZedPathResolver(buildConfig(tmpDir), () => {});

    const parts = await resolver.resolvePrompt(
      [
        {
          type: 'resource_link',
          uri: 'file://src',
          name: 'src',
          mimeType: 'text/plain',
        },
      ],
      new AbortController().signal,
    );

    const text = parts
      .filter((p): p is ContentBlock & { type: 'text' } => p.type === 'text')
      .map((p) => p.text)
      .join('');
    expect(text).toContain('visible');
    expect(text).not.toContain('ignored');
  });

  it('skips ignored files discovered by recursive missing-path fallback', async () => {
    const ignoredDir = path.join(tmpDir, 'aaa');
    const visibleDir = path.join(tmpDir, 'zzz');
    await fs.mkdir(ignoredDir, { recursive: true });
    await fs.mkdir(visibleDir, { recursive: true });
    const fileName = 'fallback-target-file.ts';
    await fs.writeFile(path.join(ignoredDir, fileName), 'ignored');
    await fs.writeFile(path.join(visibleDir, fileName), 'visible');
    const config = {
      ...buildConfig(tmpDir),
      getFileService: () => ({
        shouldIgnoreFile: (filePath: string) =>
          filePath.replace(/\\/g, '/').startsWith('aaa/'),
      }),
    } as unknown as Config;
    const resolver = new ZedPathResolver(config, () => {});

    const parts = await resolver.resolvePrompt(
      [
        {
          type: 'resource_link',
          uri: `file://${fileName}`,
          name: fileName,
          mimeType: 'text/plain',
        },
      ],
      new AbortController().signal,
    );

    const text = parts
      .filter((p): p is ContentBlock & { type: 'text' } => p.type === 'text')
      .map((p) => p.text)
      .join('');
    expect(text).toContain('@zzz/fallback-target-file.ts');
    expect(text).toContain('visible');
    expect(text).not.toContain('@aaa/fallback-target-file.ts');
    expect(text).not.toContain('ignored');
  });

  it('expands explicit glob resource links to all non-ignored matches', async () => {
    const sourceDir = path.join(tmpDir, 'src');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'a.ts'), 'first');
    await fs.writeFile(path.join(sourceDir, 'b.ts'), 'second');
    await fs.writeFile(
      path.join(sourceDir, 'ignored-target-file.ts'),
      'ignored',
    );

    const resolver = new ZedPathResolver(buildConfig(tmpDir), () => {});

    const parts = await resolver.resolvePrompt(
      [
        {
          type: 'resource_link',
          uri: 'file://src/*.ts',
          name: 'src/*.ts',
          mimeType: 'text/plain',
        },
      ],
      new AbortController().signal,
    );

    const text = parts
      .filter((p): p is ContentBlock & { type: 'text' } => p.type === 'text')
      .map((p) => p.text)
      .join('');
    expect(text).toContain('@src/*.ts');
    expect(text).toContain('Content from @src/a.ts');
    expect(text).toContain('Content from @src/b.ts');
    expect(text).toContain('first');
    expect(text).toContain('second');
    expect(text).not.toContain('ignored');
  });

  it('expands non-star glob resource links with the same glob detection predicate', async () => {
    const sourceDir = path.join(tmpDir, 'src');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'file1.ts'), 'question');
    await fs.writeFile(path.join(sourceDir, 'file2.ts'), 'brace-a');
    await fs.writeFile(path.join(sourceDir, 'file3.ts'), 'brace-b');

    const resolver = new ZedPathResolver(buildConfig(tmpDir), () => {});

    const parts = await resolver.resolvePrompt(
      [
        {
          type: 'resource_link',
          uri: 'file://src/file?.ts',
          name: 'src/file?.ts',
          mimeType: 'text/plain',
        },
        { type: 'text', text: ' and ' },
        {
          type: 'resource_link',
          uri: 'file://src/file{2,3}.ts',
          name: 'src/file{2,3}.ts',
          mimeType: 'text/plain',
        },
      ],
      new AbortController().signal,
    );

    const text = parts
      .filter((p): p is ContentBlock & { type: 'text' } => p.type === 'text')
      .map((p) => p.text)
      .join('');
    expect(text).toContain('@src/file?.ts');
    expect(text).toContain('@src/file{2,3}.ts');
    expect(text).toContain('Content from @src/file1.ts');
    expect(text).toContain('Content from @src/file2.ts');
    expect(text).toContain('Content from @src/file3.ts');
    expect(text).toContain('question');
    expect(text).toContain('brace-a');
    expect(text).toContain('brace-b');
  });
});
