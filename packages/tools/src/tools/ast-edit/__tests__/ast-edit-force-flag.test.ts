/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ast_edit force flag semantics (issue #1758).
 *
 * force: true triggers the apply/execution phase. These tests verify
 * that force does NOT override hard errors (missing old_string,
 * file not found, stale last_modified) but DOES apply edits even
 * when AST validation fails.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTempDir,
  createFakeToolHost,
  executeApply,
  writeFileWithMtime,
} from './test-helpers.js';
import { ASTEditTool } from '../../ast-edit.js';

describe('ast_edit force flag: applies edit with AST validation failure', () => {
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

  it('writes the file and reports AST FAILED when the replacement produces invalid syntax', async () => {
    const filePath = join(tempDir, 'force-broken-ast.ts');
    writeFileSync(filePath, 'const obj = { a: 1 };\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const obj = { a: 1 };',
      new_string: 'const obj = { a: 1 ',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('Successfully applied edit');
    expect(String(result.llmContent)).toContain('AST validation: FAILED');
    const fileContent = readFileSync(filePath, 'utf-8');
    expect(fileContent).toBe('const obj = { a: 1 \n');
  });
});

describe('ast_edit force flag: applies edit with valid AST', () => {
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

  it('writes the file and reports AST PASSED when the replacement is valid', async () => {
    const filePath = join(tempDir, 'force-valid-ast.ts');
    writeFileSync(filePath, 'const greeting = "hello";\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(tempDir));

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

  it('returns edit_no_occurrence_found error even with force: true when old_string is absent', async () => {
    const filePath = join(tempDir, 'force-no-occurrence.ts');
    const originalContent = 'const x = 1;\n';
    writeFileSync(filePath, originalContent, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(tempDir));

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

  it('returns file_not_found error even with force: true when file does not exist', async () => {
    const filePath = join(tempDir, 'force-missing-file.ts');
    const tool = new ASTEditTool(createFakeToolHost(tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'something',
      new_string: 'something else',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe('file_not_found');
    expect(() => readFileSync(filePath, 'utf-8')).toThrow('ENOENT');
  });
});

describe('ast_edit force flag: does NOT override stale last_modified', () => {
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

  it('returns file_modified_conflict even with force: true when last_modified is stale', async () => {
    const filePath = join(tempDir, 'force-stale-mtime.ts');
    const oldTimestamp = 1000000000000;
    writeFileWithMtime(filePath, 'const x = 1;\n', oldTimestamp + 5000);
    const tool = new ASTEditTool(createFakeToolHost(tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
      last_modified: oldTimestamp,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe('file_modified_conflict');
    expect(readFileSync(filePath, 'utf-8')).toBe('const x = 1;\n');
  });
});

describe('ast_edit force flag: applies new file creation', () => {
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

  it('creates a new file with force: true when old_string is empty and file does not exist', async () => {
    const filePath = join(tempDir, 'force-new-file.ts');
    const tool = new ASTEditTool(createFakeToolHost(tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: '',
      new_string: 'export const NEW = 42;\n',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('Successfully applied edit');
    expect(readFileSync(filePath, 'utf-8')).toBe('export const NEW = 42;\n');
  });
});
