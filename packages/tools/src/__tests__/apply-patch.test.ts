/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Focused behavioral tests for ApplyPatchTool regressions from issue #2133.
 *
 * Verifies observable behavior through infrastructure fakes: filesystem
 * state, ToolResult content, and error types — NOT internal method calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IToolHost } from '../interfaces/index.js';
import type { ILspService } from '../interfaces/index.js';

import { ApplyPatchTool } from '../index.js';
import { ToolErrorType } from '../index.js';
import type { ToolResult } from '../index.js';

function createTempDir(prefix = 'llxprt-apply-patch-test-'): {
  dir: string;
  cleanup: () => void;
} {
  const dir = join(
    tmpdir(),
    `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
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

describe('ApplyPatchTool issue #2133 regressions', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  function createFakeToolHost(targetDir: string): IToolHost {
    return {
      getTargetDir: () => targetDir,
      getWorkspaceRoots: () => [targetDir],
      getApprovalMode: () => 'auto',
      setApprovalMode: () => {},
      isInteractive: () => false,
      hasFeatureFlag: () => false,
      getEphemeralSettings: () => ({}),
    };
  }

  async function executePatch(
    params: Record<string, unknown>,
    options?: { lsp?: ILspService },
  ): Promise<ToolResult> {
    // Constructor signature: (host, messageBusOrIdeService, ideServiceOrLspService, lspService)
    // When the second argument is not a message bus, the third argument is
    // treated as the LSP service candidate.
    const tool = new ApplyPatchTool(
      createFakeToolHost(tempDir),
      undefined,
      options?.lsp,
    );
    // Use validateBuildAndExecute so validation and execution errors surface
    // with their real ToolErrorType, matching the production call path.
    return tool.validateBuildAndExecute(params, new AbortController().signal);
  }

  describe('single-file patch success', () => {
    it('modifies an existing file and writes expected content with no error', async () => {
      const filePath = join(tempDir, 'target.txt');
      writeFileSync(filePath, 'alpha\nbeta\ngamma', 'utf-8');

      const patch = `--- a/target.txt
+++ b/target.txt
@@ -1,3 +1,3 @@
 alpha
-beta
+beta-modified
 gamma`;

      const result = await executePatch({
        absolute_path: filePath,
        patch_content: patch,
      });

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Successfully applied patch');
      expect(readFileSync(filePath, 'utf-8')).toContain('beta-modified');
      // returnDisplay is a FileDiff object
      expect(JSON.stringify(result.returnDisplay)).toContain('beta-modified');
    });
  });

  describe('multi-hunk single-file patch success', () => {
    it('applies multiple hunks in the same target file', async () => {
      const filePath = join(tempDir, 'multi.txt');
      writeFileSync(
        filePath,
        'line1\nline2\nline3\nline4\nline5\nline6',
        'utf-8',
      );

      const patch = `--- a/multi.txt
+++ b/multi.txt
@@ -1,2 +1,2 @@
-line1
+line1-edited
 line2
@@ -5,2 +5,2 @@
 line5
-line6
+line6-edited`;

      const result = await executePatch({
        absolute_path: filePath,
        patch_content: patch,
      });

      expect(result.error).toBeUndefined();
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('line1-edited');
      expect(content).toContain('line6-edited');
    });
  });

  describe('new-file patch success', () => {
    it('creates a missing target file from a /dev/null to target-file patch', async () => {
      const filePath = join(tempDir, 'new-file.txt');
      expect(existsSync(filePath)).toBe(false);

      const patch = `--- /dev/null
+++ b/new-file.txt
@@ -0,0 +1,2 @@
+hello
+world`;

      const result = await executePatch({
        absolute_path: filePath,
        patch_content: patch,
      });

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain(
        'Successfully created file from patch',
      );
      expect(readFileSync(filePath, 'utf-8')).toContain('hello');
      expect(readFileSync(filePath, 'utf-8')).toContain('world');
    });
  });

  describe('multi-file patch rejection', () => {
    it('rejects a unified diff with two file sections and writes no partial changes', async () => {
      const fileA = join(tempDir, 'a.txt');
      const fileB = join(tempDir, 'b.txt');
      writeFileSync(fileA, 'A-original\n', 'utf-8');
      writeFileSync(fileB, 'B-original\n', 'utf-8');

      const patch = `--- a/a.txt
+++ b/a.txt
@@ -1,1 +1,1 @@
-A-original
+A-patched
--- a/b.txt
+++ b/b.txt
@@ -1,1 +1,1 @@
-B-original
+B-patched
`;

      const result = await executePatch({
        absolute_path: fileA,
        patch_content: patch,
      });

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(result.llmContent).toContain('single target file patch');
      expect(result.llmContent).toContain('2');
      // No partial changes were applied to either file.
      expect(readFileSync(fileA, 'utf-8')).toBe('A-original\n');
      expect(readFileSync(fileB, 'utf-8')).toBe('B-original\n');
    });
  });

  describe('patch target mismatch rejection', () => {
    it('rejects a patch header for another file and leaves the target unchanged', async () => {
      const target = join(tempDir, 'target.txt');
      writeFileSync(target, 'keep-me\n', 'utf-8');

      const patch = `--- a/other.txt
+++ b/other.txt
@@ -1,1 +1,1 @@
-keep-me
+changed
`;

      const result = await executePatch({
        absolute_path: target,
        patch_content: patch,
      });

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(result.llmContent).toContain('other.txt');
      expect(result.llmContent).toContain('target.txt');
      expect(readFileSync(target, 'utf-8')).toBe('keep-me\n');
    });
  });

  describe('directory-qualified header mismatch rejection', () => {
    it('rejects a directory-qualified header pointing at a same-named file in a different directory', async () => {
      const srcDir = join(tempDir, 'src');
      const testDir = join(tempDir, 'test');
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(testDir, { recursive: true });

      const target = join(testDir, 'foo.txt');
      writeFileSync(target, 'keep-me\n', 'utf-8');

      // Header targets src/foo.txt while absolute_path targets test/foo.txt.
      // Basenames match, but the directory-qualified header must not validate.
      const patch = `--- a/src/foo.txt
+++ b/src/foo.txt
@@ -1,1 +1,1 @@
-keep-me
+changed
`;

      const result = await executePatch({
        absolute_path: target,
        patch_content: patch,
      });

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(result.llmContent).toContain('src/foo.txt');
      expect(readFileSync(target, 'utf-8')).toBe('keep-me\n');
    });

    it('accepts a directory-qualified header matching the absolute_path relative path', async () => {
      const srcDir = join(tempDir, 'src');
      mkdirSync(srcDir, { recursive: true });

      const target = join(srcDir, 'foo.txt');
      writeFileSync(target, 'original\n', 'utf-8');

      const patch = `--- a/src/foo.txt
+++ b/src/foo.txt
@@ -1,1 +1,1 @@
-original
+patched
`;

      const result = await executePatch({
        absolute_path: target,
        patch_content: patch,
      });

      expect(result.error).toBeUndefined();
      expect(readFileSync(target, 'utf-8')).toContain('patched');
    });
  });

  describe('empty or malformed patch rejection', () => {
    it('returns an error for an empty patch content and leaves the file unchanged', async () => {
      const target = join(tempDir, 'empty.txt');
      writeFileSync(target, 'unchanged\n', 'utf-8');

      const result = await executePatch({
        absolute_path: target,
        patch_content: '',
      });

      expect(result.error).toBeDefined();
      // Empty patch_content is rejected by parameter validation before parsing.
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(result.error?.message).toContain('patch_content');
      expect(readFileSync(target, 'utf-8')).toBe('unchanged\n');
    });

    it('returns INVALID_TOOL_PARAMS for a patch with no parseable file sections', async () => {
      const target = join(tempDir, 'malformed.txt');
      writeFileSync(target, 'unchanged\n', 'utf-8');

      const result = await executePatch({
        absolute_path: target,
        patch_content: 'this is not a patch at all',
      });

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(readFileSync(target, 'utf-8')).toBe('unchanged\n');
    });
  });

  describe('context mismatch apply failure', () => {
    it('returns PATCH_APPLY_FAILURE and leaves the file unchanged', async () => {
      const target = join(tempDir, 'mismatch.txt');
      writeFileSync(target, 'actual content\n', 'utf-8');

      const patch = `--- a/mismatch.txt
+++ b/mismatch.txt
@@ -1,1 +1,1 @@
-expected content
+patched content
`;

      const result = await executePatch({
        absolute_path: target,
        patch_content: patch,
      });

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.PATCH_APPLY_FAILURE);
      expect(readFileSync(target, 'utf-8')).toBe('actual content\n');
    });
  });

  describe('LSP diagnostics path regression', () => {
    it('waits for diagnostics on the actual absolute_path, not the patch header path', async () => {
      const target = join(tempDir, 'lsp-target.txt');
      writeFileSync(target, 'lsp-original\n', 'utf-8');

      const patch = `--- a/lsp-target.txt
+++ b/lsp-target.txt
@@ -1,1 +1,1 @@
-lsp-original
+lsp-patched
`;

      let observedPath = '';
      const fakeLsp: ILspService = {
        waitForDiagnostics: (filePath: string) => {
          observedPath = filePath;
          return Promise.resolve([]);
        },
        getDiagnostics: () => [],
        getLspConfig: () => undefined,
      };

      const result = await executePatch(
        { absolute_path: target, patch_content: patch },
        { lsp: fakeLsp },
      );

      expect(result.error).toBeUndefined();
      // The diagnostics wait must use the actual absolute_path target.
      expect(observedPath).toBe(target);
    });
  });
});
