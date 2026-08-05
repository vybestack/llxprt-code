/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3063 — ReadFileTool.execute() must stop destroying its own error.
 * The legacy normalizer (now removed) overwrote llmContent with the terse
 * error.message and cast the structured error down to a bare string. These
 * tests drive the public execute() directly against a real temp directory and
 * assert the returned ToolResult keeps both halves of the invocation result.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IToolHost } from '../../interfaces/index.js';
import { ReadFileTool } from '../read-file.js';
import { ToolErrorType } from '../../types/tool-error.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'llxprt-readfile-3063-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  // No try/catch: `force` already tolerates an already-removed directory, so a
  // failure here is a real problem (a locked or undeletable temp dir) and must
  // surface rather than accumulate silently.
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

/** Minimal structural IToolHost over a real temp directory. */
function createHost(targetDir: string): IToolHost {
  return {
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
      filterFiles: (paths) => paths,
    }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getFileExclusions: () => [],
    getReadManyFilesExclusions: () => [],
    getFileFilteringRespectLlxprtIgnore: () => true,
    getLlxprtIgnoreFilePath: () => null,
    recordFileRead: () => {},
    getFileSystemService: () => undefined,
    getLlxprtIgnorePatterns: () => [],
    getEphemeralSettings: () => ({}),
    getDebugMode: () => false,
  };
}

describe('ReadFileTool.execute() — direct API fidelity (issue #3063)', () => {
  it('keeps the model-facing llmContent and a structured error for a missing file (AC10 + AC11)', async () => {
    const dir = createTempDir();
    const tool = new ReadFileTool(createHost(dir));
    const missing = join(dir, 'no-such-file.txt');

    const result = await tool.execute({ absolute_path: missing });

    // AC10: llmContent is the invocation's model-facing content, not the terse
    // error.message ("File not found: ...").
    expect(typeof result.llmContent).toBe('string');
    expect(result.llmContent).toBe(
      'Could not read file because no file was found at the specified path.',
    );

    // AC11: error is a well-formed object with a string message and a defined
    // machine-readable type (not the bare string the old cast produced).
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('object');
    expect(typeof result.error!.message).toBe('string');
    expect(result.error!.message).toContain(missing);
    expect(result.error!.type).toBe(ToolErrorType.FILE_NOT_FOUND);
  });

  it('agrees with build().execute() for a successful read (AC12)', async () => {
    const dir = createTempDir();
    const filePath = join(dir, 'hello.txt');
    writeFileSync(filePath, 'line one\nline two\n', 'utf-8');
    const tool = new ReadFileTool(createHost(dir));
    const params = { absolute_path: filePath };

    const direct = await tool.execute(params);
    const built = await tool
      .build(params)
      .execute(new AbortController().signal);

    expect(direct).toEqual(built);
    expect(direct.error).toBeUndefined();
  });

  it('agrees with build().execute() for a failing read (AC12)', async () => {
    const dir = createTempDir();
    const tool = new ReadFileTool(createHost(dir));
    const params = { absolute_path: join(dir, 'missing.txt') };

    const direct = await tool.execute(params);
    const built = await tool
      .build(params)
      .execute(new AbortController().signal);

    expect(direct).toEqual(built);
    // Both paths keep the structured error (AC13 functionally: no string cast).
    expect(typeof direct.error).toBe('object');
    expect(typeof direct.error!.message).toBe('string');
    expect(direct.error!.type).toBe(ToolErrorType.FILE_NOT_FOUND);
  });
});
