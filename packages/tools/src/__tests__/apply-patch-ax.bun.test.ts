/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #3033 (apply_patch agent-experience fixes).
 * Drives the real `ApplyPatchTool` through `validateBuildAndExecute` against a
 * real on-disk temp directory, asserting on filesystem state and `ToolResult`
 * content only. No mocking of the tool under test, no private-method access.
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
import type {
  ApprovalMode,
  IToolHost,
  IToolHostFileSystemService,
  ILspService,
  ToolCallConfirmationDetails,
  ToolEditConfirmationDetails,
  ToolResult,
  FileDiff,
} from '../index.js';
import {
  ApplyPatchTool,
  ToolConfirmationOutcome,
  ToolErrorType,
} from '../index.js';
import type { ApplyPatchToolParams } from '../index.js';

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

describe('ApplyPatchTool temporary workspace lifecycle', () => {
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

  interface FakeHostOptions {
    approvalMode?: ApprovalMode;
    fileSystemService?: IToolHostFileSystemService;
  }

  /** Exposes the most recent mode passed to the fake host's setApprovalMode. */
  interface FakeToolHostRecorder {
    /** undefined until setApprovalMode is called. */
    recordedApprovalMode: ApprovalMode | undefined;
  }

  function createFakeToolHost(
    targetDir: string,
    options?: FakeHostOptions,
  ): IToolHost & FakeToolHostRecorder {
    const fileSystemService = options?.fileSystemService;
    let recordedApprovalMode: ApprovalMode | undefined = undefined;
    const host: IToolHost & FakeToolHostRecorder = {
      get recordedApprovalMode(): ApprovalMode | undefined {
        return recordedApprovalMode;
      },
      getTargetDir: () => targetDir,
      getWorkspaceRoots: () => [targetDir],
      getApprovalMode: (): ApprovalMode => options?.approvalMode ?? 'auto',
      setApprovalMode: (mode: ApprovalMode): void => {
        recordedApprovalMode = mode;
      },
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
      getFileSystemService: fileSystemService
        ? (): IToolHostFileSystemService => fileSystemService
        : undefined,
      getLlxprtIgnorePatterns: () => [],
      getEphemeralSettings: () => ({}),
      getDebugMode: () => false,
    };
    return host;
  }

  interface RunOptions {
    approvalMode?: ApprovalMode;
    lsp?: ILspService;
    fileSystemService?: IToolHostFileSystemService;
  }

  async function runPatch(
    targetDir: string,
    params: ApplyPatchToolParams,
    options?: RunOptions,
  ): Promise<ToolResult> {
    const tool = new ApplyPatchTool(
      createFakeToolHost(targetDir, {
        approvalMode: options?.approvalMode,
        fileSystemService: options?.fileSystemService,
      }),
      undefined,
      options?.lsp,
    );
    return tool.validateBuildAndExecute(params, new AbortController().signal);
  }

  /** Drives `shouldConfirmExecute` through a real invocation in ASK mode. */
  async function runConfirmation(
    targetDir: string,
    params: ApplyPatchToolParams,
    options?: { approvalMode?: ApprovalMode },
  ): Promise<ToolCallConfirmationDetails | false> {
    const tool = new ApplyPatchTool(
      createFakeToolHost(targetDir, { approvalMode: options?.approvalMode }),
    );
    const invocation = tool.build(params);
    return invocation.shouldConfirmExecute(new AbortController().signal);
  }

  function isStringRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  function isStringArray(v: unknown): v is string[] {
    return Array.isArray(v) && v.every((x) => typeof x === 'string');
  }

  function isFileDisplay(rd: unknown): rd is FileDiff {
    return (
      isStringRecord(rd) &&
      'newContent' in rd &&
      'fileDiff' in rd &&
      'fileName' in rd
    );
  }

  function isEditConfirmation(
    c: ToolCallConfirmationDetails,
  ): c is ToolEditConfirmationDetails {
    return c.type === 'edit';
  }

  function requireConfirmation(
    confirmation: ToolCallConfirmationDetails | false,
  ): ToolCallConfirmationDetails {
    if (confirmation === false) {
      throw new Error('expected confirmation details');
    }
    return confirmation;
  }

  function requireStringRecord(
    value: unknown,
  ): asserts value is Record<string, unknown> {
    if (!isStringRecord(value)) throw new Error('expected an object schema');
  }

  function requireArray(value: unknown): asserts value is unknown[] {
    if (!Array.isArray(value)) throw new Error('expected an array schema');
  }

  function pathRequiredSets(anyOf: unknown[]): string[][] {
    return anyOf.flatMap((branch): string[][] => {
      if (!isStringRecord(branch)) return [];
      const required: unknown = branch.required;
      return isStringArray(required) ? [required] : [];
    });
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

  /**
   * Narrows a ToolResult's llmContent to a string for assertions that need
   * string semantics (.toLowerCase, indexOf, etc.). llmContent is a
   * ContentPartListUnion (string | ContentPart | arrays thereof); the tool
   * returns a string at runtime, but routing through here turns a future shape
   * change into a clear test failure instead of a confusing TypeError.
   */
  function llmContentAsString(content: ToolResult['llmContent']): string {
    if (typeof content !== 'string') {
      throw new Error(
        `Expected ToolResult.llmContent to be a string, but got ${typeof content}.`,
      );
    }
    return content;
  }

  /** A whole-file delete patch for the given basename. */
  function deletePatch(basename: string, lines: string[]): string {
    const body = lines.map((l) => `-${l}`).join('\n');
    return `--- a/${basename}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n${body}\n`;
  }

  describe('issue #3033 AC1 — delete patches delete', () => {
    const tempDir = useTempDir();

    it('removes the file from disk when a whole-file delete patch is applied', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\nb\nc\n', 'utf-8');
      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: deletePatch('target.txt', ['a', 'b', 'c']),
      });
      expect(result.error).toBeUndefined();
      expect(existsSync(filePath)).toBe(false);
      expect(llmContentAsString(result.llmContent).toLowerCase()).toContain(
        'deleted',
      );
      expect(result.llmContent).toContain('target.txt');
      expect(isFileDisplay(result.returnDisplay)).toBe(true);
      expect(result.returnDisplay).toMatchObject({ newContent: '' });
    });

    it('rejects a delete patch that does not remove the whole file and leaves it untouched', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\nb\nc\nd\n', 'utf-8');
      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: deletePatch('target.txt', ['a', 'b', 'c']),
      });
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.PATCH_APPLY_FAILURE);
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, 'utf-8')).toBe('a\nb\nc\nd\n');
    });

    it('still rejects a delete patch whose --- header basename does not match the target', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\n', 'utf-8');
      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: deletePatch('other.txt', ['a']),
      });
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(readFileSync(filePath, 'utf-8')).toBe('a\n');
    });
  });

  describe('F1 — delete routes through the host filesystem service', () => {
    const tempDir = useTempDir();

    it('asks the host filesystem service to delete instead of unlinking behind its back', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\nb\nc\n', 'utf-8');
      const deletedPaths: string[] = [];
      const fileSystemService: IToolHostFileSystemService = {
        readTextFile: async (p) => readFileSync(p, 'utf8'),
        writeTextFile: async (p, c) => writeFileSync(p, c, 'utf8'),
        deleteFile: (p) => {
          deletedPaths.push(p);
          return Promise.resolve();
        },
      };
      const result = await runPatch(
        tempDir(),
        {
          absolute_path: filePath,
          patch_content: deletePatch('target.txt', ['a', 'b', 'c']),
        },
        { fileSystemService },
      );
      expect(result.error).toBeUndefined();
      // The service was asked to delete exactly the target path.
      expect(deletedPaths).toStrictEqual([filePath]);
      // The real file was NOT unlinked behind the service's back: the fake
      // service intercepted delete and removed nothing, so a bypass would have
      // removed the on-disk file while a routed delete leaves it in place.
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('F2 — deletion failure returns a structured error, not a thrown exception', () => {
    const tempDir = useTempDir();

    it('returns a FILE_WRITE_FAILURE result when the host delete rejects', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\nb\nc\n', 'utf-8');
      const fileSystemService: IToolHostFileSystemService = {
        readTextFile: async (p) => readFileSync(p, 'utf8'),
        writeTextFile: async (p, c) => writeFileSync(p, c, 'utf8'),
        deleteFile: () => Promise.reject(new Error('permission denied')),
      };
      const result = await runPatch(
        tempDir(),
        {
          absolute_path: filePath,
          patch_content: deletePatch('target.txt', ['a', 'b', 'c']),
        },
        { fileSystemService },
      );
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.FILE_WRITE_FAILURE);
      expect(result.llmContent).toContain('Error deleting file');
      expect(result.llmContent).toContain('permission denied');
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('issue #3033 AC2 — success message is evidence', () => {
    const tempDir = useTempDir();

    it('reports hunk count and landing lines for a successful modify', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\nb\nc\n', 'utf-8');
      const patch = `--- a/target.txt\n+++ b/target.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n`;
      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain(
        'Patch declared 1 hunk(s). The applied change landed at line 2.',
      );
      expect(readFileSync(filePath, 'utf-8')).toBe('a\nB\nc\n');
    });

    it('announces when a hunk context block occurs more than once in the file', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'repeat\nx\nrepeat\ny\n', 'utf-8');
      const patch = `--- a/target.txt\n+++ b/target.txt\n@@ -1,1 +1,1 @@\n-repeat\n+REPLACED\n`;
      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain(
        'Hunk 1 context (declared at line 1) occurs 2 times in the file (lines 1, 3); check the reported landing lines.',
      );
      expect(readFileSync(filePath, 'utf-8')).toBe('REPLACED\nx\nrepeat\ny\n');
    });

    it('still announces ambiguity for a patch whose own line endings are CRLF', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'repeat\nx\nrepeat\ny\n', 'utf-8');
      // The patch text itself carries CRLF line endings (model-supplied input).
      // jsdiff's parsePatch retains the carriage returns on hunk.lines, so
      // buildAdvisoryNotes must normalise them or the duplicated-context block
      // never matches and the ambiguity note is silently dropped.
      const patch =
        '--- a/target.txt\r\n+++ b/target.txt\r\n@@ -1,1 +1,1 @@\r\n-repeat\r\n+REPLACED\r\n';
      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain(
        'Hunk 1 context (declared at line 1) occurs 2 times in the file (lines 1, 3); check the reported landing lines.',
      );
    });

    it('notes when a hunk declared line differs from where it actually matched', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'unique\nb\nc\n', 'utf-8');
      // Declared at line 5, but "unique" only exists at line 1.
      const patch = `--- a/target.txt\n+++ b/target.txt\n@@ -5,1 +5,1 @@\n-unique\n+CHANGED\n`;
      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain(
        'Hunk 1 declared line 5 but its context matches line 1.',
      );
      expect(readFileSync(filePath, 'utf-8')).toBe('CHANGED\nb\nc\n');
    });

    it('gives proportionate evidence (lines written) for a creation', async () => {
      const filePath = join(tempDir(), 'new.txt');
      const patch = `--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+hello\n+world\n`;
      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain(
        'Successfully created file from patch',
      );
      expect(result.llmContent).toContain('Created file with 2 line(s).');
      expect(readFileSync(filePath, 'utf-8')).toBe('hello\nworld\n');
    });
  });

  describe('F3 — deletion landing evidence does not name a nonexistent line', () => {
    const tempDir = useTempDir();

    it('reports content removed before the resulting first line for a start deletion', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\nb\nc\n', 'utf-8');
      const patch = `--- a/target.txt\n+++ b/target.txt\n@@ -1,3 +1,2 @@\n-a\n b\n c\n`;
      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('content removed before line 1');
      expect(readFileSync(filePath, 'utf-8')).toBe('b\nc\n');
    });

    it('reports content removed before the resulting line for a middle deletion', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\nb\nc\n', 'utf-8');
      const patch = `--- a/target.txt\n+++ b/target.txt\n@@ -1,3 +1,2 @@\n a\n-b\n c\n`;
      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('content removed before line 2');
      expect(readFileSync(filePath, 'utf-8')).toBe('a\nc\n');
    });

    it('reports content removed at end of file for an end deletion', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\nb\nc\n', 'utf-8');
      const patch = `--- a/target.txt\n+++ b/target.txt\n@@ -1,3 +1,2 @@\n a\n b\n-c\n`;
      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('content removed at end of file');
      expect(readFileSync(filePath, 'utf-8')).toBe('a\nb\n');
    });
  });

  describe('issue #3033 AC3 — path mismatch names both accepted forms', () => {
    const tempDir = useTempDir();

    it('names the workspace-relative path and basename as accepted header forms', async () => {
      const subDir = join(tempDir(), 'sub');
      mkdirSync(subDir, { recursive: true });
      const target = join(subDir, 'target.txt');
      writeFileSync(target, 'keep\n', 'utf-8');
      const patch = `--- a/other.txt\n+++ b/other.txt\n@@ -1,1 +1,1 @@\n-keep\n+changed\n`;
      const result = await runPatch(tempDir(), {
        absolute_path: target,
        patch_content: patch,
      });
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(result.llmContent).toContain('other.txt');
      expect(result.llmContent).toContain('sub/target.txt');
      expect(result.llmContent).toContain('target.txt');
      expect(llmContentAsString(result.llmContent).toLowerCase()).toContain(
        'partial path',
      );
      expect(readFileSync(target, 'utf-8')).toBe('keep\n');
    });
  });

  describe('issue #3033 AC4 — missing or unrecognized header is named', () => {
    const tempDir = useTempDir();

    it('rejects a Codex *** Begin Patch envelope as unsupported', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'keep\n', 'utf-8');
      const patch = `*** Begin Patch\n*** Update File: target.txt\n+new\n`;
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
      const patch = `--- a/target.txt\n+++ b/target.txt\n`;
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
      const patch = `@@ -1,1 +1,1 @@\n-a\n+A\n`;
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

    it('translates a too-small declared old count into header/declared/actual numbers', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\nb\n', 'utf-8');
      // Declared old count 1 but body removes 2 lines.
      const patch = `--- a/target.txt\n+++ b/target.txt\n@@ -1,1 +1,1 @@\n-a\n-b\n+c\n`;
      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(result.llmContent).toContain('@@ -1,1 +1,1 @@');
      expect(result.llmContent).toContain(
        'declared 1 old line(s) and 1 new line(s)',
      );
      expect(result.llmContent).toContain(
        'actually has 2 old line(s) and 1 new line(s)',
      );
    });

    it('translates a too-small declared new count into header/declared/actual numbers', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\n', 'utf-8');
      // Declared new count 1 but body adds 2 lines.
      const patch = `--- a/target.txt\n+++ b/target.txt\n@@ -1,1 +1,1 @@\n-a\n+b\n+c\n`;
      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(result.llmContent).toContain('@@ -1,1 +1,1 @@');
      expect(result.llmContent).toContain(
        'declared 1 old line(s) and 1 new line(s)',
      );
      expect(result.llmContent).toContain(
        'actually has 1 old line(s) and 2 new line(s)',
      );
    });

    it('translates an over-declared count into the correct declared/actual numbers', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\n', 'utf-8');
      // Declared 3 old / 3 new but body has 1 old / 1 new.
      const patch = `--- a/target.txt\n+++ b/target.txt\n@@ -1,3 +1,3 @@\n-a\n+b\n`;
      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(result.llmContent).toContain('@@ -1,3 +1,3 @@');
      expect(result.llmContent).toContain(
        'declared 3 old line(s) and 3 new line(s)',
      );
      expect(result.llmContent).toContain(
        'actually has 1 old line(s) and 1 new line(s)',
      );
    });

    it('surfaces the original jsdiff message for a non-count parser error', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\n', 'utf-8');
      // Declared counts (1/1) are correct for the body; the trailing "QQQ" is
      // what jsdiff cannot parse. The scanner finds no count mismatch, so the
      // original parser message ("Unknown line") surfaces unaltered.
      const patch = `--- a/target.txt\n+++ b/target.txt\n@@ -1,1 +1,1 @@\n-a\n+b\nQQQ\n`;
      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(llmContentAsString(result.llmContent).toLowerCase()).toContain(
        'unknown line',
      );
      expect(llmContentAsString(result.llmContent).toLowerCase()).not.toContain(
        'declared',
      );
      expect(llmContentAsString(result.llmContent).toLowerCase()).not.toContain(
        'actual',
      );
    });

    it('does not misread a "--- "/"+++ " body pair as a file header; surfaces the parser error', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\n', 'utf-8');
      // The removed line "-- old" renders as "--- old" and the added line
      // "++ new" renders as "+++ new": exactly a file-header pair in text. The
      // declared counts (2/2) are correct for that body. The trailing "QQQ"
      // forces a parse throw; the scanner must NOT terminate the body walk on
      // the dashed pair and fabricate a 0/0 count mismatch.
      const patch = `--- a/target.txt\n+++ b/target.txt\n@@ -1,2 +1,2 @@\n--- old\n+++ new\n keep\nQQQ\n`;
      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(llmContentAsString(result.llmContent).toLowerCase()).toContain(
        'unknown line',
      );
      expect(llmContentAsString(result.llmContent).toLowerCase()).not.toContain(
        'declared',
      );
      expect(llmContentAsString(result.llmContent).toLowerCase()).not.toContain(
        'actually has 0 old line',
      );
    });
  });

  describe('issue #3033 AC6 — missing file is not a context mismatch', () => {
    const tempDir = useTempDir();

    it('reports FILE_NOT_FOUND for a non-creation patch on a missing file', async () => {
      const filePath = join(tempDir(), 'missing.txt');
      const patch = `--- a/missing.txt\n+++ b/missing.txt\n@@ -1,1 +1,1 @@\n-old\n+new\n`;
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
      const patch = `--- /dev/null\n+++ b/created.txt\n@@ -0,0 +1,1 @@\n+hello\n`;
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
      const patch = `--- a/mismatch.txt\n+++ b/mismatch.txt\n@@ -1,1 +1,1 @@\n-expected content\n+patched content\n`;
      const result = await runPatch(tempDir(), {
        absolute_path: filePath,
        patch_content: patch,
      });
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.PATCH_APPLY_FAILURE);
      expect(
        countOccurrences(
          llmContentAsString(result.llmContent),
          'Failed to apply patch:',
        ),
      ).toBe(1);
      expect(llmContentAsString(result.llmContent).toLowerCase()).toContain(
        'context',
      );
      expect(llmContentAsString(result.llmContent).toLowerCase()).toContain(
        're-read',
      );
      expect(readFileSync(filePath, 'utf-8')).toBe('actual content\n');
    });
  });

  describe('issue #3033 AC8 — schema states the path requirement', () => {
    const tempDir = useTempDir();

    it('parameter schema declares anyOf branches requiring absolute_path and file_path', () => {
      const tool = new ApplyPatchTool(createFakeToolHost(tempDir()));
      const schema: unknown = tool.parameterSchema;
      expect(isStringRecord(schema)).toBe(true);
      requireStringRecord(schema);
      expect('anyOf' in schema).toBe(true);
      const anyOf: unknown = schema.anyOf;
      expect(Array.isArray(anyOf)).toBe(true);
      requireArray(anyOf);
      const requiredSets = pathRequiredSets(anyOf);
      // The two branches require absolute_path and file_path respectively, so an
      // empty anyOf cannot satisfy this.
      expect(requiredSets).toContainEqual(['absolute_path']);
      expect(requiredSets).toContainEqual(['file_path']);
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

    it('accepts a call supplying only file_path (no absolute_path)', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'keep\n', 'utf-8');
      const patch = `--- a/target.txt\n+++ b/target.txt\n@@ -1,1 +1,1 @@\n-keep\n+kept\n`;
      const result = await runPatch(tempDir(), {
        file_path: filePath,
        patch_content: patch,
      });
      expect(result.error).toBeUndefined();
      expect(readFileSync(filePath, 'utf-8')).toBe('kept\n');
    });
  });

  describe('issue #3033 AC9 — tool description states the rules', () => {
    const tempDir = useTempDir();

    it('description documents the patch header, basename, and count rules truthfully', () => {
      const tool = new ApplyPatchTool(createFakeToolHost(tempDir()));
      const d = tool.description.replace(/\s+/g, ' ');
      expect(d).toContain('exactly one target file per call');
      expect(d).toContain('---');
      expect(d).toContain('+++');
      expect(d).toContain('/dev/null');
      expect(d).toContain('*** Begin Patch');
      expect(d).toContain('partial path is not accepted');
      expect(d).toContain('only the basename is matched');
      expect(d).toContain('line counts are strict');
    });
  });

  describe('F5 — confirmation matches execution', () => {
    const tempDir = useTempDir();

    it('does not throw and produces no confirmation for a malformed-count patch', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\nb\n', 'utf-8');
      const patch = `--- a/target.txt\n+++ b/target.txt\n@@ -1,1 +1,1 @@\n-a\n-b\n+c\n`;
      const confirmation = await runConfirmation(
        tempDir(),
        { absolute_path: filePath, patch_content: patch },
        { approvalMode: 'default' },
      );
      expect(confirmation).toBe(false);
    });

    it('produces no confirmation for a zero-hunk patch', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'keep\n', 'utf-8');
      const patch = `--- a/target.txt\n+++ b/target.txt\n`;
      const confirmation = await runConfirmation(
        tempDir(),
        { absolute_path: filePath, patch_content: patch },
        { approvalMode: 'default' },
      );
      expect(confirmation).toBe(false);
    });

    it('produces no confirmation for a missing-file non-creation patch', async () => {
      const filePath = join(tempDir(), 'missing.txt');
      const patch = `--- a/missing.txt\n+++ b/missing.txt\n@@ -1,1 +1,1 @@\n-old\n+new\n`;
      const confirmation = await runConfirmation(
        tempDir(),
        { absolute_path: filePath, patch_content: patch },
        { approvalMode: 'default' },
      );
      expect(confirmation).toBe(false);
    });

    it('previews the removal (empty new content) for a valid delete patch', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\nb\nc\n', 'utf-8');
      const confirmation = await runConfirmation(
        tempDir(),
        {
          absolute_path: filePath,
          patch_content: deletePatch('target.txt', ['a', 'b', 'c']),
        },
        { approvalMode: 'default' },
      );
      expect(confirmation).not.toBe(false);
      const details = requireConfirmation(confirmation);
      expect(isEditConfirmation(details)).toBe(true);
      expect(details).toMatchObject({
        newContent: '',
        title: expect.stringMatching(/delete/i),
      });
      // The file is untouched — confirmation is a preview only.
      expect(existsSync(filePath)).toBe(true);
    });

    it('switches the host to auto-approval when the user picks ProceedAlways on a delete preview', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\nb\nc\n', 'utf-8');
      // 'default' requires confirmation, so shouldConfirmExecute builds a preview.
      const host = createFakeToolHost(tempDir(), { approvalMode: 'default' });
      const tool = new ApplyPatchTool(host);
      const invocation = tool.build({
        absolute_path: filePath,
        patch_content: deletePatch('target.txt', ['a', 'b', 'c']),
      });
      const confirmation = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );
      expect(confirmation).not.toBe(false);
      const details = requireConfirmation(confirmation);
      expect(host.recordedApprovalMode).toBeUndefined();
      await details.onConfirm(ToolConfirmationOutcome.ProceedAlways);
      expect(host.recordedApprovalMode).toBe('auto');
    });
  });

  describe('F10 — LSP diagnostics are not collected for a deleted file', () => {
    const tempDir = useTempDir();

    function fakeLsp(record: { called: boolean; path: string }): ILspService {
      return {
        waitForDiagnostics: (p: string) => {
          record.called = true;
          record.path = p;
          return Promise.resolve([]);
        },
        getDiagnostics: () => [],
        getLspConfig: () => undefined,
      };
    }

    it('does not wait for diagnostics after a successful delete', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\nb\nc\n', 'utf-8');
      const record = { called: false, path: '' };
      const result = await runPatch(
        tempDir(),
        {
          absolute_path: filePath,
          patch_content: deletePatch('target.txt', ['a', 'b', 'c']),
        },
        { lsp: fakeLsp(record) },
      );
      expect(result.error).toBeUndefined();
      expect(record.called).toBe(false);
      expect(record.path).toBe('');
    });

    it('waits for diagnostics on the target after a normal modify', async () => {
      const filePath = join(tempDir(), 'target.txt');
      writeFileSync(filePath, 'a\nb\n', 'utf-8');
      const record = { called: false, path: '' };
      const patch = `--- a/target.txt\n+++ b/target.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n`;
      const result = await runPatch(
        tempDir(),
        { absolute_path: filePath, patch_content: patch },
        { lsp: fakeLsp(record) },
      );
      expect(result.error).toBeUndefined();
      expect(record.called).toBe(true);
      expect(record.path).toBe(filePath);
    });
  });
});
