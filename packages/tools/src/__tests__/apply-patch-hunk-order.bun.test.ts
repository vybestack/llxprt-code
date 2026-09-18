/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #3597 (apply_patch must reject hunks that arrive
 * out of original-file line order instead of duplicating file content).
 * Drives the real `ApplyPatchTool` through `validateBuildAndExecute` against a
 * real on-disk temp directory, asserting on filesystem state and `ToolResult`
 * content only. No mocking of the tool under test, no private-method access.
 * @issue 3597
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  ApprovalMode,
  IToolHost,
  ToolCallConfirmationDetails,
  ToolResult,
} from '../index.js';
import { ApplyPatchTool, ToolErrorType } from '../index.js';
import type { ApplyPatchToolParams } from '../index.js';

function createTempDir(prefix = 'llxprt-apply-patch-order-'): {
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

describe('ApplyPatchTool hunk ordering (issue #3597)', () => {
  /** Shared temp-directory lifecycle: registers hooks once, lazy accessor. */
  function useTempDir(): () => string {
    let dir = '';
    let cleanup = (): void => {};
    beforeEach(() => {
      const tmp = createTempDir();
      dir = tmp.dir;
      cleanup = tmp.cleanup;
    });
    afterEach(() => cleanup());
    return () => dir;
  }

  function createFakeToolHost(
    targetDir: string,
    approvalMode: ApprovalMode = 'auto',
  ): IToolHost {
    return {
      getTargetDir: () => targetDir,
      getWorkspaceRoots: () => [targetDir],
      getApprovalMode: () => approvalMode,
      setApprovalMode: () => {},
      isInteractive: () => false,
      hasFeatureFlag: () => false,
      getFileService: () => ({
        shouldGitIgnoreFile: () => false,
        shouldLlxprtIgnoreFile: () => false,
        shouldIgnoreFile: () => false,
        filterFiles: (paths: string[]) => paths,
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
      getLlxprtIgnorePatterns: () => [],
      getEphemeralSettings: () => ({}),
      getDebugMode: () => false,
    };
  }

  async function runPatch(
    targetDir: string,
    params: ApplyPatchToolParams,
  ): Promise<ToolResult> {
    const tool = new ApplyPatchTool(createFakeToolHost(targetDir), undefined);
    return tool.validateBuildAndExecute(params, new AbortController().signal);
  }

  /** Drives `shouldConfirmExecute` through a real invocation in ASK mode. */
  async function runConfirmation(
    targetDir: string,
    params: ApplyPatchToolParams,
  ): Promise<ToolCallConfirmationDetails | false> {
    const tool = new ApplyPatchTool(createFakeToolHost(targetDir, 'default'));
    const invocation = tool.build(params);
    return invocation.shouldConfirmExecute(new AbortController().signal);
  }

  function countOccurrences(haystack: string, needle: string): number {
    if (needle === '') return 0;
    let count = 0;
    let idx = haystack.indexOf(needle);
    while (idx !== -1) {
      count++;
      idx = haystack.indexOf(needle, idx + needle.length);
    }
    return count;
  }

  /** A 320-line Rust-like target mirroring the issue's http.rs shape. */
  function rustLikeContent(): string {
    const lines: string[] = [];
    for (let i = 1; i <= 320; i++) {
      lines.push(`    let step${i} = ${i};`);
    }
    // 1-based line 208: the line the issue's out-of-order hunk targeted.
    lines[207] = '    let _ = tx.try_send(Err(error));';
    return lines.join('\n');
  }

  /** The issue's hunk old-start order: 268, 278, 308, then 208. */
  const NON_MONOTONIC_PATCH = `--- a/http.rs
+++ b/http.rs
@@ -268,2 +268,1 @@
     let step268 = 268;
-    let step269 = 269;
@@ -278,5 +277,4 @@
     let step278 = 278;
-    let step279 = 279;
-    let step280 = 280;
-    let step281 = 281;
+    let step279new = 279;
+    let step280new = 280;
     let step282 = 282;
@@ -308,7 +306,8 @@
     let step308 = 308;
-    let step309 = 309;
-    let step310 = 310;
-    let step311 = 311;
-    let step312 = 312;
-    let step313 = 313;
+    let step309new = 309;
+    let step310new = 310;
+    let step311new = 311;
+    let step312new = 312;
+    let step313new = 313;
+    let step314new = 314;
     let step314 = 314;
@@ -208,1 +208,1 @@
-    let _ = tx.try_send(Err(error));
+    let _ = tx.send(Err(error)).await;
`;

  /** The same four hunks in ascending original-file order: 208, 268, 278, 308. */
  const ASCENDING_PATCH = `--- a/http.rs
+++ b/http.rs
@@ -208,1 +208,1 @@
-    let _ = tx.try_send(Err(error));
+    let _ = tx.send(Err(error)).await;
@@ -268,2 +268,1 @@
     let step268 = 268;
-    let step269 = 269;
@@ -278,5 +277,4 @@
     let step278 = 278;
-    let step279 = 279;
-    let step280 = 280;
-    let step281 = 281;
+    let step279new = 279;
+    let step280new = 280;
     let step282 = 282;
@@ -308,7 +306,8 @@
     let step308 = 308;
-    let step309 = 309;
-    let step310 = 310;
-    let step311 = 311;
-    let step312 = 312;
-    let step313 = 313;
+    let step309new = 309;
+    let step310new = 310;
+    let step311new = 311;
+    let step312new = 312;
+    let step313new = 313;
+    let step314new = 314;
     let step314 = 314;
`;

  describe('non-monotonic hunks are rejected before any write', () => {
    const tempDir = useTempDir();

    it('rejects hunks in the issue #3597 order (268, 278, 308, 208) and leaves the file byte-identical', async () => {
      const filePath = join(tempDir(), 'http.rs');
      const original = rustLikeContent();
      writeFileSync(filePath, original, 'utf-8');

      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: NON_MONOTONIC_PATCH,
      });

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      // The message names the offending hunks and both line numbers.
      expect(result.llmContent).toContain('Hunk 4');
      expect(result.llmContent).toContain('line 208');
      expect(result.llmContent).toContain('line 308');
      // The message states the remedy.
      expect(result.llmContent).toContain('ascending order');
      expect(result.llmContent).toContain('separate apply_patch calls');
      // Atomic: nothing was applied, nothing duplicated.
      expect(readFileSync(filePath, 'utf-8')).toBe(original);
    });

    it('produces no confirmation preview for the non-monotonic patch in default approval mode', async () => {
      const filePath = join(tempDir(), 'http.rs');
      writeFileSync(filePath, rustLikeContent(), 'utf-8');

      const confirmation = await runConfirmation(tempDir(), {
        absolute_path: filePath,
        patch_content: NON_MONOTONIC_PATCH,
      });

      // false defers to execute, which emits the actionable rejection.
      expect(confirmation).toBe(false);
    });
  });

  describe('strictly increasing means equal anchors are rejected too', () => {
    const tempDir = useTempDir();

    it('rejects two pure-insert hunks anchored at the same original line', async () => {
      const filePath = join(tempDir(), 'inserts.txt');
      writeFileSync(filePath, 'a\nb\nc\n', 'utf-8');

      const patch = `--- a/inserts.txt
+++ b/inserts.txt
@@ -1,0 +2,1 @@
+first
@@ -1,0 +3,1 @@
+second
`;

      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(result.llmContent).toContain('Hunk 2');
      expect(readFileSync(filePath, 'utf-8')).toBe('a\nb\nc\n');
    });
  });

  describe('well-formed patches are unchanged by the check', () => {
    const tempDir = useTempDir();

    it('applies the same four hunks reordered into ascending original-file order without duplication', async () => {
      const filePath = join(tempDir(), 'http.rs');
      writeFileSync(filePath, rustLikeContent(), 'utf-8');

      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: ASCENDING_PATCH,
      });

      expect(result.error).toBeUndefined();
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('tx.send(Err(error)).await');
      expect(content).not.toContain('tx.try_send(Err(error))');
      // Net line delta is -1 (two deletions net, one net addition): 319 lines,
      // and no marker may appear twice — the corruption from issue #3597.
      expect(content.split('\n')).toHaveLength(319);
      expect(countOccurrences(content, 'let step300 =')).toBe(1);
      expect(countOccurrences(content, 'let step250 =')).toBe(1);
      expect(countOccurrences(content, 'let step314 =')).toBe(1);
    });

    it('still applies a single-hunk patch to a multi-hunk-scale file', async () => {
      const filePath = join(tempDir(), 'http.rs');
      writeFileSync(filePath, rustLikeContent(), 'utf-8');

      const patch = `--- a/http.rs
+++ b/http.rs
@@ -208,1 +208,1 @@
-    let _ = tx.try_send(Err(error));
+    let _ = tx.send(Err(error)).await;
`;

      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });

      expect(result.error).toBeUndefined();
      expect(readFileSync(filePath, 'utf-8')).toContain(
        'tx.send(Err(error)).await',
      );
    });

    it('still creates a file from a /dev/null creation patch', async () => {
      const filePath = join(tempDir(), 'made.txt');
      const patch = `--- /dev/null
+++ b/made.txt
@@ -0,0 +1,2 @@
+hello
+world
`;

      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });

      expect(result.error).toBeUndefined();
      expect(readFileSync(filePath, 'utf-8')).toBe('hello\nworld\n');
    });

    it('still deletes a file via a /dev/null delete patch', async () => {
      const filePath = join(tempDir(), 'gone.txt');
      writeFileSync(filePath, 'a\nb\nc\n', 'utf-8');
      const patch = `--- a/gone.txt
+++ /dev/null
@@ -1,3 +0,0 @@
-a
-b
-c
`;

      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });

      expect(result.error).toBeUndefined();
      expect(existsSync(filePath)).toBe(false);
    });
  });
});
