/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the shared pre-read file-size gate (issue #3205).
 *
 * Creates real exact-20-MiB and 20-MiB-plus-one fixture files and exercises
 * every accepted public read/modification path. Asserts the gate rejects
 * one-byte-over targets with FILE_TOO_LARGE before any content read/parse/
 * diff/backup, that the file is left unchanged, and that exactly-20-MiB
 * targets are accepted. Also proves read_file/read_line_range retain their
 * existing behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  statSync,
  existsSync,
  chmodSync,
  promises as fsPromises,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IToolHost } from '../interfaces/index.js';
import {
  ReadFileTool,
  ReadLineRangeTool,
  WriteFileTool,
  EditTool,
  ApplyPatchTool,
  InsertAtLineTool,
  DeleteLineRangeTool,
  ASTEditTool,
  ASTReadFileTool,
  ReadManyFilesTool,
  ToolErrorType,
} from '../index.js';
import type { ToolResult } from '../index.js';
import { statFileSizeGate } from '../utils/fileUtils.js';

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

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

/**
 * Writes a file of exactly `sizeBytes` bytes. `lead` is written first (UTF-8)
 * and the remainder is filled with 'x' so the total is exactly `sizeBytes`.
 */
function makeExactFile(p: string, sizeBytes: number, lead = 'TARGET\n'): void {
  const leadBytes = Buffer.byteLength(lead, 'utf-8');
  const buf = Buffer.alloc(sizeBytes);
  buf.write(lead, 0, 'utf-8');
  buf.fill(0x78, leadBytes); // 'x'
  writeFileSync(p, buf);
}

/** Writes a valid-TypeScript file of exactly `sizeBytes` bytes. */
function makeExactTsFile(p: string, sizeBytes: number): void {
  const lead = 'const _placeholder = 1;\n// ';
  const leadBytes = Buffer.byteLength(lead, 'utf-8');
  const buf = Buffer.alloc(sizeBytes);
  buf.write(lead, 0, 'utf-8');
  buf.fill(0x78, leadBytes); // 'x' — comment body
  writeFileSync(p, buf);
}

function isFileTooLarge(result: ToolResult): boolean {
  return result.error?.type === ToolErrorType.FILE_TOO_LARGE;
}

async function runTool(
  tool: { build(p: unknown): { execute(s: AbortSignal): Promise<ToolResult> } },
  params: unknown,
): Promise<ToolResult> {
  return tool.build(params).execute(new AbortController().signal);
}

describe('shared pre-read file-size gate (issue #3205)', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `llxprt-gate-3205-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // --- read_file / read_line_range regression (existing behavior) -----------

  describe('read_file (regression)', () => {
    it('rejects a 20-MiB-plus-one file with FILE_TOO_LARGE', async () => {
      const p = join(tempDir, 'over.txt');
      makeExactFile(p, MAX_FILE_SIZE_BYTES + 1);
      const result = await runTool(new ReadFileTool(createHost(tempDir)), {
        file_path: p,
      });
      expect(isFileTooLarge(result)).toBe(true);
    });

    it('accepts an exactly-20-MiB file', async () => {
      const p = join(tempDir, 'exact.txt');
      makeExactFile(p, MAX_FILE_SIZE_BYTES, 'hello\n');
      const result = await runTool(new ReadFileTool(createHost(tempDir)), {
        file_path: p,
      });
      expect(isFileTooLarge(result)).toBe(false);
    });
  });

  describe('read_line_range (regression)', () => {
    it('rejects a 20-MiB-plus-one file with FILE_TOO_LARGE', async () => {
      const p = join(tempDir, 'over.txt');
      makeExactFile(p, MAX_FILE_SIZE_BYTES + 1);
      const result = await runTool(new ReadLineRangeTool(createHost(tempDir)), {
        file_path: p,
        start_line: 1,
        end_line: 5,
      });
      expect(isFileTooLarge(result)).toBe(true);
    });
  });

  // --- AST read / edit paths -----------------------------------------------

  describe('ast_read_file', () => {
    it('rejects a 20-MiB-plus-one .ts file before reading', async () => {
      const p = join(tempDir, 'over.ts');
      makeExactTsFile(p, MAX_FILE_SIZE_BYTES + 1);
      const sizeBefore = statSync(p).size;
      const result = await runTool(new ASTReadFileTool(createHost(tempDir)), {
        file_path: p,
      });
      expect(isFileTooLarge(result)).toBe(true);
      expect(statSync(p).size).toBe(sizeBefore);
    });

    it('accepts an exactly-20-MiB .ts file', async () => {
      const p = join(tempDir, 'exact.ts');
      makeExactTsFile(p, MAX_FILE_SIZE_BYTES);
      const result = await runTool(new ASTReadFileTool(createHost(tempDir)), {
        file_path: p,
      });
      expect(isFileTooLarge(result)).toBe(false);
    });
  });

  describe('ast_edit', () => {
    it('rejects a 20-MiB-plus-one .ts file before parsing', async () => {
      const p = join(tempDir, 'over.ts');
      makeExactTsFile(p, MAX_FILE_SIZE_BYTES + 1);
      const sizeBefore = statSync(p).size;
      const result = await runTool(new ASTEditTool(createHost(tempDir)), {
        file_path: p,
        old_string: 'const _placeholder = 1;',
        new_string: 'const _placeholder = 2;',
        force: true,
      });
      expect(isFileTooLarge(result)).toBe(true);
      expect(statSync(p).size).toBe(sizeBefore);
    });

    it('accepts an exactly-20-MiB .ts file', async () => {
      const p = join(tempDir, 'exact.ts');
      makeExactTsFile(p, MAX_FILE_SIZE_BYTES);
      const result = await runTool(new ASTEditTool(createHost(tempDir)), {
        file_path: p,
        old_string: 'const _placeholder = 1;',
        new_string: 'const _placeholder = 2;',
        force: true,
      });
      expect(isFileTooLarge(result)).toBe(false);
    });
  });

  // --- edit / patch / insert / delete / write paths ------------------------

  describe('edit', () => {
    it('rejects a 20-MiB-plus-one file before reading', async () => {
      const p = join(tempDir, 'over.txt');
      makeExactFile(p, MAX_FILE_SIZE_BYTES + 1, 'TARGET\n');
      const sizeBefore = statSync(p).size;
      const result = await runTool(new EditTool(createHost(tempDir)), {
        file_path: p,
        old_string: 'TARGET',
        new_string: 'REPLACED',
      });
      expect(isFileTooLarge(result)).toBe(true);
      expect(statSync(p).size).toBe(sizeBefore);
    });

    it('accepts an exactly-20-MiB file', async () => {
      const p = join(tempDir, 'exact.txt');
      makeExactFile(p, MAX_FILE_SIZE_BYTES, 'TARGET\n');
      const result = await runTool(new EditTool(createHost(tempDir)), {
        file_path: p,
        old_string: 'TARGET',
        new_string: 'REPLACED',
      });
      expect(isFileTooLarge(result)).toBe(false);
    });
  });

  describe('apply_patch', () => {
    it('rejects a 20-MiB-plus-one file before reading', async () => {
      const p = join(tempDir, 'over.txt');
      makeExactFile(p, MAX_FILE_SIZE_BYTES + 1, 'TARGET\n');
      const sizeBefore = statSync(p).size;
      const patch =
        '--- a/over.txt\n+++ b/over.txt\n@@ -1,1 +1,1 @@\n-TARGET\n+REPLACED\n';
      const result = await runTool(new ApplyPatchTool(createHost(tempDir)), {
        absolute_path: p,
        patch_content: patch,
      });
      expect(isFileTooLarge(result)).toBe(true);
      expect(statSync(p).size).toBe(sizeBefore);
    });

    it('accepts an exactly-20-MiB file', async () => {
      const p = join(tempDir, 'exact.txt');
      makeExactFile(p, MAX_FILE_SIZE_BYTES, 'TARGET\n');
      const patch =
        '--- a/exact.txt\n+++ b/exact.txt\n@@ -1,1 +1,1 @@\n-TARGET\n+REPLACED\n';
      const result = await runTool(new ApplyPatchTool(createHost(tempDir)), {
        absolute_path: p,
        patch_content: patch,
      });
      expect(isFileTooLarge(result)).toBe(false);
    });
  });

  describe('insert_at_line', () => {
    it('rejects a 20-MiB-plus-one file before reading', async () => {
      const p = join(tempDir, 'over.txt');
      makeExactFile(p, MAX_FILE_SIZE_BYTES + 1, 'TARGET\n');
      const sizeBefore = statSync(p).size;
      const result = await runTool(new InsertAtLineTool(createHost(tempDir)), {
        file_path: p,
        line_number: 1,
        content: 'INSERTED\n',
      });
      expect(isFileTooLarge(result)).toBe(true);
      expect(statSync(p).size).toBe(sizeBefore);
    });

    it('accepts an exactly-20-MiB file', async () => {
      const p = join(tempDir, 'exact.txt');
      makeExactFile(p, MAX_FILE_SIZE_BYTES, 'TARGET\n');
      const result = await runTool(new InsertAtLineTool(createHost(tempDir)), {
        file_path: p,
        line_number: 1,
        content: 'INSERTED\n',
      });
      expect(isFileTooLarge(result)).toBe(false);
    });
  });

  describe('delete_line_range', () => {
    it('rejects a 20-MiB-plus-one file before reading', async () => {
      const p = join(tempDir, 'over.txt');
      makeExactFile(p, MAX_FILE_SIZE_BYTES + 1, 'TARGET\n');
      const sizeBefore = statSync(p).size;
      const result = await runTool(
        new DeleteLineRangeTool(createHost(tempDir)),
        { file_path: p, start_line: 1, end_line: 1 },
      );
      expect(isFileTooLarge(result)).toBe(true);
      // The shared authoritative message carries the path/size (finding 1):
      // the generic 'File size exceeds the 20MB limit.' must not be duplicated.
      expect(String(result.llmContent)).toContain('over.txt');
      expect(statSync(p).size).toBe(sizeBefore);
    });

    it('accepts an exactly-20-MiB file', async () => {
      const p = join(tempDir, 'exact.txt');
      makeExactFile(p, MAX_FILE_SIZE_BYTES, 'TARGET\n');
      const result = await runTool(
        new DeleteLineRangeTool(createHost(tempDir)),
        { file_path: p, start_line: 1, end_line: 1 },
      );
      expect(isFileTooLarge(result)).toBe(false);
    });
  });

  describe('write_file (existing-target read-before-write)', () => {
    it('rejects a 20-MiB-plus-one existing file before reading', async () => {
      const p = join(tempDir, 'over.txt');
      makeExactFile(p, MAX_FILE_SIZE_BYTES + 1, 'TARGET\n');
      const sizeBefore = statSync(p).size;
      const result = await runTool(new WriteFileTool(createHost(tempDir)), {
        file_path: p,
        content: 'REPLACED\n',
      });
      expect(isFileTooLarge(result)).toBe(true);
      expect(statSync(p).size).toBe(sizeBefore);
    });

    it('preserves new-file creation (no existing target to gate)', async () => {
      const p = join(tempDir, 'new.txt');
      const result = await runTool(new WriteFileTool(createHost(tempDir)), {
        file_path: p,
        content: 'brand new file\n',
      });
      expect(isFileTooLarge(result)).toBe(false);
      expect(result.error).toBeUndefined();
    });
  });
});

/**
 * Host filesystem-service path coverage (issue #3205).
 *
 * The existing suites above exercise the native-fs fallback (no
 * `getFileSystemService`). These tests wire a host whose `readTextFile`/
 * `writeTextFile` are backed by the REAL filesystem, so the gate is exercised
 * over the host read path too. A canary marker file proves behaviorally
 * (filesystem state, not call counts) whether the host read was invoked.
 */
describe('host filesystem-service paths (issue #3205)', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `llxprt-host-3205-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Host whose `readTextFile`/`writeTextFile` are real fs operations. When
   * `readTextFile` runs it writes a canary marker file — an observable
   * filesystem side-effect that proves (without call counts) whether the host
   * read path was actually reached.
   */
  function createHostWithFileService(
    targetDir: string,
    canaryPath: string,
  ): IToolHost {
    return {
      ...createHost(targetDir),
      getFileSystemService: () => ({
        readTextFile: (filePath: string) => {
          writeFileSync(canaryPath, 'host-read-invoked');
          return fsPromises.readFile(filePath, 'utf-8');
        },
        writeTextFile: (filePath: string, content: string) =>
          fsPromises.writeFile(filePath, content),
      }),
    };
  }

  describe('ast_read_file over the host read path', () => {
    it('rejects a 20-MiB-plus-one file before the host read is needed', async () => {
      const p = join(tempDir, 'over.ts');
      makeExactTsFile(p, MAX_FILE_SIZE_BYTES + 1);
      const canary = join(tempDir, 'read-canary');
      const sizeBefore = statSync(p).size;
      const result = await runTool(
        new ASTReadFileTool(createHostWithFileService(tempDir, canary)),
        { file_path: p },
      );
      expect(isFileTooLarge(result)).toBe(true);
      expect(statSync(p).size).toBe(sizeBefore);
      // The host read was never needed: the gate fired first, so the canary
      // marker (written only when readTextFile runs) must not exist.
      expect(existsSync(canary)).toBe(false);
    });

    it('exercises the host read path for a within-limit file', async () => {
      const p = join(tempDir, 'ok.ts');
      writeFileSync(p, 'const value = 42;\n');
      const canary = join(tempDir, 'read-canary');
      const result = await runTool(
        new ASTReadFileTool(createHostWithFileService(tempDir, canary)),
        { file_path: p },
      );
      expect(isFileTooLarge(result)).toBe(false);
      // The host read path was actually used (canary written), proving the
      // service is wired up and the over-limit test above is meaningful.
      expect(existsSync(canary)).toBe(true);
    });
  });

  describe('ast_edit over the host read path', () => {
    it('rejects a 20-MiB-plus-one file before reading and leaves it unchanged', async () => {
      const p = join(tempDir, 'over.ts');
      makeExactTsFile(p, MAX_FILE_SIZE_BYTES + 1);
      const canary = join(tempDir, 'edit-canary');
      const sizeBefore = statSync(p).size;
      const result = await runTool(
        new ASTEditTool(createHostWithFileService(tempDir, canary)),
        {
          file_path: p,
          old_string: 'const _placeholder = 1;',
          new_string: 'const _placeholder = 2;',
          force: true,
        },
      );
      expect(isFileTooLarge(result)).toBe(true);
      expect(statSync(p).size).toBe(sizeBefore);
      // The host read was never needed: the gate fired before any parse/read.
      expect(existsSync(canary)).toBe(false);
    });
  });
});

/**
 * Preview / confirmation / modify paths must reject oversized targets before
 * materializing content (issue #3205 item A).
 *
 * In non-auto approval the tools build a diff preview by reading the existing
 * target. The shared pre-read gate must fire in that path too, returning false
 * (defer to execute) for a one-byte-over file instead of reading/diffing it.
 * A within-limit counterpart proves the preview is still built normally.
 */
describe('preview/confirmation paths reject oversized targets (item A)', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `llxprt-preview-3205-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createNonAutoHost(targetDir: string): IToolHost {
    return { ...createHost(targetDir), getApprovalMode: () => 'default' };
  }

  async function runShouldConfirm(
    tool: {
      build(p: unknown): {
        shouldConfirmExecute?(s: AbortSignal): Promise<unknown>;
      };
    },
    params: unknown,
  ): Promise<unknown> {
    const invocation = tool.build(params);
    const fn = invocation.shouldConfirmExecute;
    if (typeof fn !== 'function') {
      throw new Error('invocation has no shouldConfirmExecute');
    }
    return fn.call(invocation, new AbortController().signal);
  }

  it('insert_at_line preview returns false for an oversized file and leaves it unchanged', async () => {
    const p = join(tempDir, 'over.txt');
    makeExactFile(p, MAX_FILE_SIZE_BYTES + 1, 'TARGET\n');
    const sizeBefore = statSync(p).size;
    const result = await runShouldConfirm(
      new InsertAtLineTool(createNonAutoHost(tempDir)),
      { file_path: p, line_number: 1, content: 'INSERTED\n' },
    );
    expect(result).toBe(false);
    expect(statSync(p).size).toBe(sizeBefore);
  });

  it('insert_at_line preview is built for a within-limit file', async () => {
    const p = join(tempDir, 'ok.txt');
    writeFileSync(p, 'TARGET\n');
    const result = await runShouldConfirm(
      new InsertAtLineTool(createNonAutoHost(tempDir)),
      { file_path: p, line_number: 1, content: 'INSERTED\n' },
    );
    expect(result).not.toBe(false);
  });

  it('delete_line_range preview returns false for an oversized file', async () => {
    const p = join(tempDir, 'over.txt');
    makeExactFile(p, MAX_FILE_SIZE_BYTES + 1, 'TARGET\n');
    const result = await runShouldConfirm(
      new DeleteLineRangeTool(createNonAutoHost(tempDir)),
      { file_path: p, start_line: 1, end_line: 1 },
    );
    expect(result).toBe(false);
  });

  it('delete_line_range preview is built for a within-limit file', async () => {
    const p = join(tempDir, 'ok.txt');
    writeFileSync(p, 'line1\nline2\n');
    const result = await runShouldConfirm(
      new DeleteLineRangeTool(createNonAutoHost(tempDir)),
      { file_path: p, start_line: 1, end_line: 1 },
    );
    expect(result).not.toBe(false);
  });

  it('apply_patch preview returns false for an oversized file', async () => {
    const p = join(tempDir, 'over.txt');
    makeExactFile(p, MAX_FILE_SIZE_BYTES + 1, 'TARGET\n');
    const patch =
      '--- a/over.txt\n+++ b/over.txt\n@@ -1,1 +1,1 @@\n-TARGET\n+REPLACED\n';
    const result = await runShouldConfirm(
      new ApplyPatchTool(createNonAutoHost(tempDir)),
      { absolute_path: p, patch_content: patch },
    );
    expect(result).toBe(false);
  });

  it('apply_patch preview is built for a within-limit file', async () => {
    const p = join(tempDir, 'ok.txt');
    writeFileSync(p, 'TARGET\n');
    const patch =
      '--- a/ok.txt\n+++ b/ok.txt\n@@ -1,1 +1,1 @@\n-TARGET\n+REPLACED\n';
    const result = await runShouldConfirm(
      new ApplyPatchTool(createNonAutoHost(tempDir)),
      { absolute_path: p, patch_content: patch },
    );
    expect(result).not.toBe(false);
  });

  it('write_file preview returns false for an oversized existing file', async () => {
    const p = join(tempDir, 'over.txt');
    makeExactFile(p, MAX_FILE_SIZE_BYTES + 1, 'TARGET\n');
    const result = await runShouldConfirm(
      new WriteFileTool(createNonAutoHost(tempDir)),
      { file_path: p, content: 'REPLACED\n' },
    );
    expect(result).toBe(false);
  });

  it('write_file preview is built for a within-limit existing file', async () => {
    const p = join(tempDir, 'ok.txt');
    writeFileSync(p, 'TARGET\n');
    const result = await runShouldConfirm(
      new WriteFileTool(createNonAutoHost(tempDir)),
      { file_path: p, content: 'REPLACED\n' },
    );
    expect(result).not.toBe(false);
  });
});

/**
 * Modify-context seams (getModifyContext) must reject oversized targets before
 * reading them into temp editor files (issue #3205 item A).
 */
describe('modify-context paths reject oversized targets (item A)', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `llxprt-modify-3205-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('write_file getModifyContext rejects an oversized existing target', async () => {
    const p = join(tempDir, 'over.txt');
    makeExactFile(p, MAX_FILE_SIZE_BYTES + 1, 'TARGET\n');
    const tool = new WriteFileTool(createHost(tempDir));
    const ctx = tool.getModifyContext(new AbortController().signal);
    await expect(
      ctx.getCurrentContent({ file_path: p, content: 'X\n' }),
    ).rejects.toThrow(/20MB|exceeds/i);
  });

  it('write_file getModifyContext accepts a within-limit existing target', async () => {
    const p = join(tempDir, 'ok.txt');
    writeFileSync(p, 'TARGET\n');
    const tool = new WriteFileTool(createHost(tempDir));
    const ctx = tool.getModifyContext(new AbortController().signal);
    const content = await ctx.getCurrentContent({
      file_path: p,
      content: 'X\n',
    });
    expect(content).toBe('TARGET\n');
  });

  it('edit getModifyContext rejects an oversized existing target', async () => {
    const p = join(tempDir, 'over.txt');
    makeExactFile(p, MAX_FILE_SIZE_BYTES + 1, 'TARGET\n');
    const tool = new EditTool(createHost(tempDir));
    const ctx = tool.getModifyContext(new AbortController().signal);
    await expect(
      ctx.getCurrentContent({
        file_path: p,
        old_string: 'TARGET',
        new_string: 'REPLACED',
      }),
    ).rejects.toThrow(/20MB|exceeds/i);
  });
});

/**
 * The pre-read gate must apply FILE_TOO_LARGE only to regular files; a
 * directory target falls through to established directory/error handling
 * (issue #3205 item I).
 */
describe('statFileSizeGate only gates regular files (item I)', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `llxprt-isfile-3205-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null for a directory (no FILE_TOO_LARGE classification)', async () => {
    const dir = join(tempDir, 'subdir');
    mkdirSync(dir, { recursive: true });
    const gate = await statFileSizeGate(dir);
    expect(gate).toBeNull();
  });

  it('returns null for a missing file (caller handles ENOENT)', async () => {
    const gate = await statFileSizeGate(join(tempDir, 'nope.txt'));
    expect(gate).toBeNull();
  });

  it('rejects a one-byte-over regular file', async () => {
    const p = join(tempDir, 'over.txt');
    makeExactFile(p, MAX_FILE_SIZE_BYTES + 1);
    const gate = await statFileSizeGate(p);
    expect(gate).not.toBeNull();
    expect(gate?.type).toBe(ToolErrorType.FILE_TOO_LARGE);
  });
});

/**
 * statFileSizeGate must narrow its catch to ENOENT only. An unexpected stat
 * failure (EACCES, EIO, ...) must fail fast (throw) rather than be masked as a
 * missing file, which would let a real error silently bypass the gate
 * (issue #3205 item M).
 */
describe('statFileSizeGate fails fast on unexpected stat errors (item M)', () => {
  // chmod 000 on a parent directory denies search (execute) permission, so
  // stat of a child file fails with EACCES on POSIX non-root. This produces a
  // real non-ENOENT stat failure without a test-only production hook.
  const supportsEaccesFixture =
    process.platform !== 'win32' && process.getuid?.() !== 0;
  let tempDir = '';
  let lockedDir = '';

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `llxprt-eacces-3205-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
    lockedDir = join(tempDir, 'locked');
    mkdirSync(lockedDir, { recursive: true });
    writeFileSync(join(lockedDir, 'inner.txt'), 'hello\n');
  });

  afterEach(() => {
    if (supportsEaccesFixture && lockedDir !== '') {
      try {
        chmodSync(lockedDir, 0o755);
      } catch {
        // best effort: restore so cleanup can remove it
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe.skipIf(!supportsEaccesFixture)('EACCES stat failures', () => {
    it('throws (does not return null) for a stat EACCES failure', async () => {
      // Deny traversal into the directory -> stat of the child fails EACCES.
      chmodSync(lockedDir, 0o000);
      // A masked-as-missing return would be `null`; fail-fast must throw so the
      // caller's invocation error handling can surface the real permission
      // problem instead of silently bypassing the gate.
      await expect(
        statFileSizeGate(join(lockedDir, 'inner.txt')),
      ).rejects.toThrow(/EACCES|permission/i);
    });
  });
});

/**
 * Host filesystem-service content must not bypass the size policy. A host may
 * return content divergent from native stat, so acquired host content is
 * validated immediately after acquisition (issue #3205 item E).
 */
describe('host divergent-content size policy (item E)', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `llxprt-divergent-3205-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createDivergentHost(
    targetDir: string,
    hostContent: string,
  ): IToolHost {
    return {
      ...createHost(targetDir),
      getFileSystemService: () => ({
        readTextFile: async () => hostContent,
        writeTextFile: async (filePath: string, content: string) =>
          fsPromises.writeFile(filePath, content),
      }),
    };
  }

  it('ast_read_file rejects >20MiB host content for a small native target', async () => {
    const p = join(tempDir, 'small.ts');
    writeFileSync(p, 'const value = 1;\n');
    const huge = 'x'.repeat(MAX_FILE_SIZE_BYTES + 1);
    const result = await runTool(
      new ASTReadFileTool(createDivergentHost(tempDir, huge)),
      { file_path: p },
    );
    expect(isFileTooLarge(result)).toBe(true);
  });

  it('ast_read_file rejects >20MiB host content for a nonexistent native target', async () => {
    const p = join(tempDir, 'missing.ts');
    const huge = 'x'.repeat(MAX_FILE_SIZE_BYTES + 1);
    const result = await runTool(
      new ASTReadFileTool(createDivergentHost(tempDir, huge)),
      { file_path: p },
    );
    expect(isFileTooLarge(result)).toBe(true);
  });

  it('ast_read_file accepts exactly-20MiB host content', async () => {
    const p = join(tempDir, 'exact.ts');
    writeFileSync(p, 'const value = 1;\n');
    const exact = 'x'.repeat(MAX_FILE_SIZE_BYTES);
    const result = await runTool(
      new ASTReadFileTool(createDivergentHost(tempDir, exact)),
      { file_path: p },
    );
    expect(isFileTooLarge(result)).toBe(false);
  });

  it('apply_patch rejects >20MiB host content for a small native target', async () => {
    const p = join(tempDir, 'small.txt');
    writeFileSync(p, 'TARGET\n');
    const huge = 'x'.repeat(MAX_FILE_SIZE_BYTES + 1) + '\n';
    const patch =
      '--- a/small.txt\n+++ b/small.txt\n@@ -1,1 +1,1 @@\n-TARGET\n+NEW\n';
    const result = await runTool(
      new ApplyPatchTool(createDivergentHost(tempDir, huge)),
      { absolute_path: p, patch_content: patch },
    );
    expect(isFileTooLarge(result)).toBe(true);
  });

  it('edit rejects >20MiB host content for a small native target', async () => {
    const p = join(tempDir, 'small.txt');
    writeFileSync(p, 'TARGET\n');
    const huge = 'x'.repeat(MAX_FILE_SIZE_BYTES + 1);
    const result = await runTool(
      new EditTool(createDivergentHost(tempDir, huge)),
      { file_path: p, old_string: 'TARGET', new_string: 'REPLACED' },
    );
    expect(isFileTooLarge(result)).toBe(true);
  });

  it('ast_edit rejects >20MiB host content for a small native target', async () => {
    const p = join(tempDir, 'small.ts');
    writeFileSync(p, 'const value = 1;\n');
    const huge = 'x'.repeat(MAX_FILE_SIZE_BYTES + 1);
    const result = await runTool(
      new ASTEditTool(createDivergentHost(tempDir, huge)),
      {
        file_path: p,
        old_string: 'const value = 1;',
        new_string: 'const value = 2;',
        force: true,
      },
    );
    expect(isFileTooLarge(result)).toBe(true);
    // The authoritative host content is rejected before materialization, so
    // the (small) native target is left unchanged.
    expect(statSync(p).size).toBe(Buffer.byteLength('const value = 1;\n'));
  });
});

/**
 * read_many_files must apply the shared gate to each file (issue #3205 item J).
 * processSingleFileContent already enforces it; this proves the behavior holds
 * through the public read_many_files entry point.
 */
describe('read_many_files applies the size gate (item J)', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `llxptr-rmf-3205-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('skips an oversized file without crashing the batch', async () => {
    const over = join(tempDir, 'over.txt');
    makeExactFile(over, MAX_FILE_SIZE_BYTES + 1, 'TARGET\n');
    const ok = join(tempDir, 'ok.txt');
    writeFileSync(ok, 'hello\n');
    const tool = new ReadManyFilesTool(createHost(tempDir));
    const result = await tool.execute(
      { paths: [join(tempDir, '*.txt')] },
      new AbortController().signal,
    );
    expect(result.error).toBeUndefined();
    // The within-limit file is read; the oversized one is skipped/errored per
    // file but does not fail the whole batch.
    expect(String(result.llmContent)).toContain('ok.txt');
  });
});
