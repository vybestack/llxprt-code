/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ast_edit last_modified concurrency control (issue #1758).
 *
 * last_modified is a timestamp (ms) used for optimistic concurrency.
 * The tool checks: if the file's actual mtime > last_modified, it is stale.
 * These tests verify the four timestamp scenarios: stale, future, exact, omitted.
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  useTempDir,
  createFakeToolHost,
  executeApply,
  writeFileWithMtime,
  getFileMtime,
} from './test-helpers.js';
import { ASTEditTool } from '../../ast-edit.js';
import { ToolErrorType } from '../../../types/tool-error.js';

describe('ast_edit last_modified: stale timestamp triggers conflict', () => {
  const ctx = useTempDir();

  it('returns file_modified_conflict when file mtime is greater than last_modified', async () => {
    const filePath = join(ctx.tempDir, 'stale.ts');
    const actualMtime = 1700000005000;
    writeFileWithMtime(filePath, 'const x = 1;\n', actualMtime);
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
      last_modified: actualMtime - 1000,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.FILE_MODIFIED_CONFLICT);
  });

  it('includes both current and provided timestamps in the conflict error', async () => {
    const filePath = join(ctx.tempDir, 'stale-detail.ts');
    const actualMtime = 1700000005000;
    const providedMtime = actualMtime - 2000;
    writeFileWithMtime(filePath, 'const x = 1;\n', actualMtime);
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
      last_modified: providedMtime,
    });

    const raw = String(result.llmContent);
    expect(raw).toContain(String(actualMtime));
    expect(raw).toContain(String(providedMtime));
  });

  it('does not modify the file when a conflict is detected', async () => {
    const filePath = join(ctx.tempDir, 'stale-no-write.ts');
    const actualMtime = 1700000005000;
    writeFileWithMtime(filePath, 'const x = 1;\n', actualMtime);
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
      last_modified: actualMtime - 1000,
    });

    expect(result.error?.type).toBe(ToolErrorType.FILE_MODIFIED_CONFLICT);
    expect(readFileSync(filePath, 'utf-8')).toBe('const x = 1;\n');
  });
});

describe('ast_edit last_modified: future timestamp proceeds normally', () => {
  const ctx = useTempDir();

  it('applies the edit when last_modified is greater than actual file mtime', async () => {
    const filePath = join(ctx.tempDir, 'future.ts');
    const actualMtime = 1700000000000;
    writeFileWithMtime(filePath, 'const x = 1;\n', actualMtime);
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
      last_modified: actualMtime + 5000,
    });

    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toBe('const x = 2;\n');
  });
});

describe('ast_edit last_modified: exact match timestamp proceeds', () => {
  const ctx = useTempDir();

  it('applies the edit when last_modified equals the actual file mtime', async () => {
    const filePath = join(ctx.tempDir, 'exact.ts');
    const content = 'const x = 1;\n';
    writeFileWithMtime(filePath, content);
    const exactMtime = getFileMtime(filePath);
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
      last_modified: exactMtime,
    });

    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toBe('const x = 2;\n');
  });
});

describe('ast_edit last_modified: omitted timestamp skips check', () => {
  const ctx = useTempDir();

  it('applies the edit when last_modified is not provided', async () => {
    const filePath = join(ctx.tempDir, 'omitted.ts');
    writeFileWithMtime(filePath, 'const x = 1;\n', 1700000000000);
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
    });

    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toBe('const x = 2;\n');
  });
});

describe('ast_edit last_modified: stale error is actionable plain text (REQ-3035-9)', () => {
  const ctx = useTempDir();

  it('emits a plain human-readable message (not JSON) with both timestamps and a retry instruction', async () => {
    const filePath = join(ctx.tempDir, 'stale-plain.ts');
    const actualMtime = 1700000005000;
    const providedMtime = actualMtime - 2000;
    writeFileWithMtime(filePath, 'const x = 1;\n', actualMtime);
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
      last_modified: providedMtime,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.FILE_MODIFIED_CONFLICT);
    const raw = String(result.llmContent);
    // Both timestamps must be present so the caller can diagnose the mismatch.
    expect(raw).toContain(String(actualMtime));
    expect(raw).toContain(String(providedMtime));
    // Must instruct the caller how to recover.
    expect(raw.toLowerCase()).toMatch(/re-read/);
    expect(raw.toLowerCase()).toMatch(/retry/);
    // Must not be encoded JSON.
    expect(raw).not.toMatch(/^\s*{/);
    expect(raw).not.toContain('"current_mtime"');
  });
});
