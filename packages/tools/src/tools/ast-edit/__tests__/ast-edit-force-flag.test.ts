/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ast_edit force flag semantics (issue #1758).
 *
 * force: true triggers the apply/execution phase. These tests verify
 * that force does NOT override hard errors (missing old_string,
 * file not found, stale last_modified) or newly introduced AST
 * syntax errors.
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  useTempDir,
  createFakeToolHost,
  executeApply,
  writeFileWithMtime,
} from './test-helpers.js';
import { ASTEditTool } from '../../ast-edit.js';

describe('ast_edit force flag: refuses a newly-introduced AST syntax error (REQ-3035-2)', () => {
  const ctx = useTempDir();

  it('refuses the apply and leaves the file byte-for-byte unchanged when the edit breaks syntax', async () => {
    const filePath = join(ctx.tempDir, 'force-broken-ast.ts');
    const original = 'const obj = { a: 1 };\n';
    writeFileSync(filePath, original, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const obj = { a: 1 };',
      new_string: 'const obj = { a: 1 ',
    });

    // Typed failure, no success-leading output, file untouched.
    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe('ast_syntax_error');
    const output = String(result.llmContent);
    expect(output).not.toContain('Successfully applied edit');
    expect(output).not.toContain('Successfully created file');
    expect(readFileSync(filePath, 'utf-8')).toBe(original);
  });

  it('does not create a new file whose content has a syntax error', async () => {
    const filePath = join(ctx.tempDir, 'invalid-new-file.ts');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: '',
      new_string: 'const broken = {{{ 2;\n',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe('ast_syntax_error');

    // Assert the stable errno rather than the message text: `code` is Node's
    // documented contract, the wording of the message is not.
    let readError: NodeJS.ErrnoException | undefined;
    try {
      readFileSync(filePath, 'utf-8');
    } catch (error) {
      readError = error as NodeJS.ErrnoException;
    }
    expect(readError).toMatchObject({ code: 'ENOENT' });
  });
});

describe('ast_edit force flag: applies edit with valid AST', () => {
  const ctx = useTempDir();

  it('writes the file and reports AST PASSED when the replacement is valid', async () => {
    const filePath = join(ctx.tempDir, 'force-valid-ast.ts');
    writeFileSync(filePath, 'const greeting = "hello";\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const greeting = "hello";',
      new_string: 'const greeting = "world";',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('Successfully applied edit');
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
    expect(readFileSync(filePath, 'utf-8')).toBe('const greeting = "world";\n');
  });
});

describe('ast_edit force flag: does NOT override missing old_string', () => {
  const ctx = useTempDir();

  it('returns edit_no_occurrence_found error even with force: true when old_string is absent', async () => {
    const filePath = join(ctx.tempDir, 'force-no-occurrence.ts');
    const originalContent = 'const x = 1;\n';
    writeFileSync(filePath, originalContent, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'THIS_DOES_NOT_EXIST',
      new_string: 'const x = 2;',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe('edit_no_occurrence_found');
    expect(String(result.llmContent)).toContain('0 occurrences');
    expect(readFileSync(filePath, 'utf-8')).toBe(originalContent);
  });
});

describe('ast_edit force flag: does NOT override file-not-found', () => {
  const ctx = useTempDir();

  it('returns file_not_found error even with force: true when file does not exist', async () => {
    const filePath = join(ctx.tempDir, 'force-missing-file.ts');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'something',
      new_string: 'something else',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe('file_not_found');
    expect(() => readFileSync(filePath, 'utf-8')).toThrow(
      expect.objectContaining({ code: 'ENOENT' }),
    );
  });
});

describe('ast_edit force flag: does NOT override stale last_modified', () => {
  const ctx = useTempDir();

  it('returns file_modified_conflict even with force: true when last_modified is stale', async () => {
    const filePath = join(ctx.tempDir, 'force-stale-mtime.ts');
    const staleTimestamp = 1000000000000;
    writeFileWithMtime(filePath, 'const x = 1;\n', staleTimestamp + 5000);
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
      last_modified: staleTimestamp,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe('file_modified_conflict');
    expect(readFileSync(filePath, 'utf-8')).toBe('const x = 1;\n');
  });
});

describe('ast_edit force flag: applies new file creation (REQ-3035-8)', () => {
  const ctx = useTempDir();

  it('creates a new file and reports creation (not zero replacements) with force: true', async () => {
    const filePath = join(ctx.tempDir, 'force-new-file.ts');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: '',
      new_string: 'export const NEW = 42;\n',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('Successfully created file:');
    expect(output).toContain('AST validation: PASSED');
    // Creation must not be reported as a replacement count.
    expect(output).not.toContain('0 replacement');
    expect(readFileSync(filePath, 'utf-8')).toBe('export const NEW = 42;\n');
  });

  it('reports replacement counts for edits to an existing file', async () => {
    const filePath = join(ctx.tempDir, 'force-existing-edit.ts');
    writeFileSync(filePath, 'const greeting = "hello";\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const greeting = "hello";',
      new_string: 'const greeting = "world";',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('replacement(s) applied');
  });
});
