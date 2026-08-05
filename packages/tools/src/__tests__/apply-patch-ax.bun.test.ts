/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #3033 (apply_patch agent-experience fixes).
 *
 * Drives the real `ApplyPatchTool` through `validateBuildAndExecute` against a
 * real on-disk temp directory, asserting on filesystem state and `ToolResult`
 * content only. No mocking of the tool under test, no private-method access.
 *
 * @issue 3033
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
import type { IToolHost, ILspService, ToolResult, FileDiff } from '../index.js';
import { ApplyPatchTool, ToolErrorType } from '../index.js';
import { describeHunkCountMismatch } from '../tools/apply-patch-analysis.js';

function createTempDir(prefix = 'llxprt-apply-patch-ax-'): {
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

/**
 * Shared temp-directory lifecycle: registers the hooks once and returns a
 * lazy accessor so every describe block wires setup in a single line.
 */
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

async function runPatch(
  targetDir: string,
  params: Record<string, unknown>,
  options?: { lsp?: ILspService },
): Promise<ToolResult> {
  const tool = new ApplyPatchTool(
    createFakeToolHost(targetDir),
    undefined,
    options?.lsp,
  );
  return tool.validateBuildAndExecute(
    params as never,
    new AbortController().signal,
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isFileDisplay(rd: unknown): rd is FileDiff {
  return (
    isRecord(rd) && 'newContent' in rd && 'fileDiff' in rd && 'fileName' in rd
  );
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

describe('issue #3033 AC1 — delete patches delete', () => {
  const tempDir = useTempDir();

  it('removes the file from disk when a whole-file delete patch is applied', async () => {
    const filePath = join(tempDir(), 'target.txt');
    writeFileSync(filePath, 'a\nb\nc\n', 'utf-8');

    const patch = `--- a/target.txt
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
    expect(result.llmContent.toLowerCase()).toContain('deleted');
    expect(result.llmContent).toContain('target.txt');
    // returnDisplay is a FileDiff showing removal (new content empty).
    expect(isFileDisplay(result.returnDisplay)).toBe(true);
    if (isFileDisplay(result.returnDisplay)) {
      expect(result.returnDisplay.newContent).toBe('');
    }
  });

  it('rejects a delete patch that does not remove the whole file and leaves it untouched', async () => {
    const filePath = join(tempDir(), 'target.txt');
    writeFileSync(filePath, 'a\nb\nc\nd\n', 'utf-8');

    const patch = `--- a/target.txt
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

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.PATCH_APPLY_FAILURE);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('a\nb\nc\nd\n');
  });

  it('still rejects a delete patch whose --- header basename does not match the target', async () => {
    const filePath = join(tempDir(), 'target.txt');
    writeFileSync(filePath, 'a\n', 'utf-8');

    const patch = `--- a/other.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-a
`;

    const result = await runPatch(tempDir(), {
      absolute_path: filePath,
      patch_content: patch,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
    expect(readFileSync(filePath, 'utf-8')).toBe('a\n');
  });
});

describe('issue #3033 AC2 — success message is evidence', () => {
  const tempDir = useTempDir();

  it('reports hunk count and landing lines for a successful modify', async () => {
    const filePath = join(tempDir(), 'target.txt');
    writeFileSync(filePath, 'a\nb\nc\n', 'utf-8');

    const patch = `--- a/target.txt
+++ b/target.txt
@@ -1,3 +1,3 @@
 a
-b
+B
 c
`;

    const result = await runPatch(tempDir(), {
      absolute_path: filePath,
      patch_content: patch,
    });

    expect(result.error).toBeUndefined();
    // Evidence must name the declared hunk count and the landing line.
    expect(result.llmContent).toContain(
      'Patch declared 1 hunk(s). The applied change landed at line 2.',
    );
  });

  it('announces when a hunk context block occurs more than once in the file', async () => {
    const filePath = join(tempDir(), 'target.txt');
    writeFileSync(filePath, 'repeat\nx\nrepeat\ny\n', 'utf-8');

    const patch = `--- a/target.txt
+++ b/target.txt
@@ -1,1 +1,1 @@
-repeat
+REPLACED
`;

    const result = await runPatch(tempDir(), {
      absolute_path: filePath,
      patch_content: patch,
    });

    expect(result.error).toBeUndefined();
    // Ambiguity announcement must name the hunk, the declared line, the
    // occurrence count, and every line where the context block appears.
    expect(result.llmContent).toContain(
      'Hunk 1 context (declared at line 1) occurs 2 times in the file (lines 1, 3); check the reported landing lines.',
    );
  });

  it('notes when a hunk declared line differs from where it actually matched', async () => {
    const filePath = join(tempDir(), 'target.txt');
    writeFileSync(filePath, 'unique\nb\nc\n', 'utf-8');

    // Declared at line 5, but "unique" only exists at line 1.
    const patch = `--- a/target.txt
+++ b/target.txt
@@ -5,1 +5,1 @@
-unique
+CHANGED
`;

    const result = await runPatch(tempDir(), {
      absolute_path: filePath,
      patch_content: patch,
    });

    expect(result.error).toBeUndefined();
    // Drift note must name the hunk, the declared line, and the matched line.
    expect(result.llmContent).toContain(
      'Hunk 1 declared line 5 but its context matches line 1.',
    );
  });

  it('gives proportionate evidence (lines written) for a creation', async () => {
    const filePath = join(tempDir(), 'new.txt');

    const patch = `--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
`;

    const result = await runPatch(tempDir(), {
      absolute_path: filePath,
      patch_content: patch,
    });

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully created file from patch');
    expect(result.llmContent).toContain('Created file with 2 line(s).');
  });
});

describe('issue #3033 AC3 — path mismatch names both accepted forms', () => {
  const tempDir = useTempDir();

  it('names the workspace-relative path and basename as accepted header forms', async () => {
    const subDir = join(tempDir(), 'sub');
    mkdirSync(subDir, { recursive: true });
    const target = join(subDir, 'target.txt');
    writeFileSync(target, 'keep\n', 'utf-8');

    const patch = `--- a/other.txt
+++ b/other.txt
@@ -1,1 +1,1 @@
-keep
+changed
`;

    const result = await runPatch(tempDir(), {
      absolute_path: target,
      patch_content: patch,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
    // Header value supplied.
    expect(result.llmContent).toContain('other.txt');
    // Workspace-relative accepted form.
    expect(result.llmContent).toContain('sub/target.txt');
    // Bare basename accepted form.
    expect(result.llmContent).toContain('target.txt');
    // Partial path explicitly not accepted.
    expect(result.llmContent.toLowerCase()).toContain('partial path');
    expect(readFileSync(target, 'utf-8')).toBe('keep\n');
  });
});

describe('issue #3033 AC4 — missing or unrecognized header is named', () => {
  const tempDir = useTempDir();

  it('rejects a Codex *** Begin Patch envelope as unsupported', async () => {
    const filePath = join(tempDir(), 'target.txt');
    writeFileSync(filePath, 'keep\n', 'utf-8');

    const patch = `*** Begin Patch
*** Update File: target.txt
+new
`;

    const result = await runPatch(tempDir(), {
      absolute_path: filePath,
      patch_content: patch,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
    expect(result.llmContent).toContain('*** Begin Patch');
    expect(result.llmContent).toContain('unified diff');
    expect(readFileSync(filePath, 'utf-8')).toBe('keep\n');
  });

  it('rejects a patch with --- /+++ headers but no @@ hunks', async () => {
    const filePath = join(tempDir(), 'target.txt');
    writeFileSync(filePath, 'keep\n', 'utf-8');

    const patch = `--- a/target.txt
+++ b/target.txt
`;

    const result = await runPatch(tempDir(), {
      absolute_path: filePath,
      patch_content: patch,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
    expect(result.llmContent).toContain('@@');
    expect(readFileSync(filePath, 'utf-8')).toBe('keep\n');
  });

  it('rejects a headerless patch and names both accepted header forms', async () => {
    const filePath = join(tempDir(), 'target.txt');
    writeFileSync(filePath, 'a\n', 'utf-8');

    const patch = `@@ -1,1 +1,1 @@
-a
+A
`;

    const result = await runPatch(tempDir(), {
      absolute_path: filePath,
      patch_content: patch,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
    expect(result.llmContent).toContain('---');
    expect(result.llmContent).toContain('+++');
    expect(result.llmContent).toContain('target.txt');
    expect(readFileSync(filePath, 'utf-8')).toBe('a\n');
  });
});

describe('issue #3033 AC5 — hunk count mismatch is translated', () => {
  const tempDir = useTempDir();

  it('translates a too-small declared old count into header/declared/actual', async () => {
    const filePath = join(tempDir(), 'target.txt');
    writeFileSync(filePath, 'a\nb\n', 'utf-8');

    // Declared old count 1 but body removes 2 lines.
    const patch = `--- a/target.txt
+++ b/target.txt
@@ -1,1 +1,1 @@
-a
-b
+c
`;

    const result = await runPatch(tempDir(), {
      absolute_path: filePath,
      patch_content: patch,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
    expect(result.llmContent).toContain('@@ -1,1 +1,1 @@');
    expect(result.llmContent.toLowerCase()).toContain('declared');
    expect(result.llmContent.toLowerCase()).toContain('actual');
  });

  it('translates a too-small declared new count into header/declared/actual', async () => {
    const filePath = join(tempDir(), 'target.txt');
    writeFileSync(filePath, 'a\n', 'utf-8');

    // Declared new count 1 but body adds 2 lines.
    const patch = `--- a/target.txt
+++ b/target.txt
@@ -1,1 +1,1 @@
-a
+b
+c
`;

    const result = await runPatch(tempDir(), {
      absolute_path: filePath,
      patch_content: patch,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
    expect(result.llmContent).toContain('@@ -1,1 +1,1 @@');
    expect(result.llmContent.toLowerCase()).toContain('actual');
  });

  it('does not misread a removed line that renders as "--- " as a file header', () => {
    // A real, applicable diff: the removed line "-- some dashed line"
    // serializes to "--- some dashed line" in the body, and the declared
    // counts (2 old / 2 new) are correct. The body scanner must NOT terminate
    // the walk on that line and fabricate a count mismatch. Only the
    // `--- X` / `+++ Y` header PAIR (or `@@` / `diff --git`) ends a hunk body.
    const patch = `--- a/target.txt
+++ b/target.txt
@@ -1,2 +1,2 @@
--- some dashed line
+-- replaced line
 keep
`;

    expect(describeHunkCountMismatch(patch)).toBeNull();
  });
});

describe('issue #3033 AC6 — missing file is not a context mismatch', () => {
  const tempDir = useTempDir();

  it('reports FILE_NOT_FOUND for a non-creation patch on a missing file', async () => {
    const filePath = join(tempDir(), 'missing.txt');

    const patch = `--- a/missing.txt
+++ b/missing.txt
@@ -1,1 +1,1 @@
-old
+new
`;

    const result = await runPatch(tempDir(), {
      absolute_path: filePath,
      patch_content: patch,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.FILE_NOT_FOUND);
    expect(result.llmContent).toContain('does not exist');
    expect(result.llmContent).toContain('/dev/null');
    expect(existsSync(filePath)).toBe(false);
  });

  it('still creates the file for a creation patch on a missing target', async () => {
    const filePath = join(tempDir(), 'created.txt');

    const patch = `--- /dev/null
+++ b/created.txt
@@ -0,0 +1,1 @@
+hello
`;

    const result = await runPatch(tempDir(), {
      absolute_path: filePath,
      patch_content: patch,
    });

    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toContain('hello');
  });
});

describe('issue #3033 AC7 — single error prefix', () => {
  const tempDir = useTempDir();

  it('reports a context mismatch with exactly one Failed to apply patch prefix', async () => {
    const filePath = join(tempDir(), 'mismatch.txt');
    writeFileSync(filePath, 'actual content\n', 'utf-8');

    const patch = `--- a/mismatch.txt
+++ b/mismatch.txt
@@ -1,1 +1,1 @@
-expected content
+patched content
`;

    const result = await runPatch(tempDir(), {
      absolute_path: filePath,
      patch_content: patch,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.PATCH_APPLY_FAILURE);
    const occurrences = countOccurrences(
      result.llmContent,
      'Failed to apply patch:',
    );
    expect(occurrences).toBe(1);
    // The message must state the cause and a remedy.
    expect(result.llmContent.toLowerCase()).toContain('context');
    expect(result.llmContent.toLowerCase()).toContain('re-read');
    expect(readFileSync(filePath, 'utf-8')).toBe('actual content\n');
  });
});

describe('issue #3033 AC8 — schema states the path requirement', () => {
  const tempDir = useTempDir();

  function declaresOwn(
    container: object,
    name: string,
  ): container is Record<string, unknown> {
    return Object.prototype.hasOwnProperty.call(container, name);
  }

  it('parameter schema declares anyOf requiring one of the two path params', () => {
    const tool = new ApplyPatchTool(createFakeToolHost(tempDir()));
    const schema: unknown = tool.parameterSchema;
    expect(typeof schema).toBe('object');
    expect(schema).not.toBeNull();
    if (typeof schema !== 'object' || schema === null) return;
    expect(declaresOwn(schema, 'anyOf')).toBe(true);
    const anyOf = (schema as Record<string, unknown>).anyOf;
    expect(Array.isArray(anyOf)).toBe(true);
  });

  it('rejects a call omitting both paths with a message naming both parameters', async () => {
    const result = await runPatch(tempDir(), {
      patch_content: '--- a/x\n+++ b/x\n',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
    expect(result.llmContent).toContain('absolute_path');
    expect(result.llmContent).toContain('file_path');
  });
});

describe('issue #3033 AC9 — tool description states the rules', () => {
  const tempDir = useTempDir();

  it('description documents the patch header and count rules', () => {
    const tool = new ApplyPatchTool(createFakeToolHost(tempDir()));
    const d = tool.description.replace(/\s+/g, ' ');
    // One target file per call.
    expect(d).toContain('one');
    // --- /+++ header required.
    expect(d).toContain('---');
    expect(d).toContain('+++');
    // /dev/null create/delete.
    expect(d).toContain('/dev/null');
    // Codex envelope not accepted.
    expect(d).toContain('*** Begin Patch');
    // Counts are strict.
    expect(d.toLowerCase()).toContain('count');
  });
});
