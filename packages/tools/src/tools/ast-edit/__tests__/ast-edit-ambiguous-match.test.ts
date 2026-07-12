/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ast_edit ambiguous match handling (issue #1758).
 *
 * When old_string appears in multiple locations, the tool MUST reject
 * the edit with EDIT_EXPECTED_OCCURRENCE_MISMATCH and tell the caller
 * to include more surrounding context. Silently replacing only the
 * first occurrence is unsafe — the caller may not realize a second
 * location was left unchanged.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  useTempDir,
  createFakeToolHost,
  executeApply,
  executePreview,
} from './test-helpers.js';
import { ASTEditTool } from '../../ast-edit.js';
import { ToolErrorType } from '../../../types/tool-error.js';

describe('ast_edit ambiguous match: exactly 2 occurrences', () => {
  const ctx = useTempDir();

  it('rejects with occurrence mismatch when old_string appears twice', async () => {
    const filePath = join(ctx.tempDir, 'two-matches.ts');
    const content = [
      'const DUPLICATE = 1;',
      'const OTHER = 2;',
      'const DUPLICATE = 3;',
    ].join('\n');
    writeFileSync(filePath, content, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'DUPLICATE',
      new_string: 'RENAMED',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(
      ToolErrorType.EDIT_EXPECTED_OCCURRENCE_MISMATCH,
    );
    expect(readFileSync(filePath, 'utf-8')).toBe(content);
  });

  it('reports the actual occurrence count in the mismatch error', async () => {
    const filePath = join(ctx.tempDir, 'two-count.ts');
    const content = 'const TOKEN = 1;\nconst OTHER = 2;\nconst TOKEN = 3;\n';
    writeFileSync(filePath, content, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'TOKEN',
      new_string: 'ID',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(
      ToolErrorType.EDIT_EXPECTED_OCCURRENCE_MISMATCH,
    );
    expect(String(result.llmContent)).toContain('2 times');
    expect(readFileSync(filePath, 'utf-8')).toBe(content);
  });
});

describe('ast_edit ambiguous match: 3+ occurrences', () => {
  const ctx = useTempDir();

  it('rejects with occurrence mismatch when old_string appears 3 times', async () => {
    const filePath = join(ctx.tempDir, 'three-matches.ts');
    const content = [
      'let value = placeholder;',
      'let value2 = placeholder;',
      'let value3 = placeholder;',
    ].join('\n');
    writeFileSync(filePath, content, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'placeholder',
      new_string: 'real',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(
      ToolErrorType.EDIT_EXPECTED_OCCURRENCE_MISMATCH,
    );
    expect(String(result.llmContent)).toContain('3 times');
    expect(readFileSync(filePath, 'utf-8')).toBe(content);
  });
});

describe('ast_edit ambiguous match: disambiguated match succeeds', () => {
  const ctx = useTempDir();

  it('succeeds when caller provides enough surrounding context to match exactly once', async () => {
    const filePath = join(ctx.tempDir, 'specific-target.ts');
    const content = [
      'export const VERSION = "1.0.0";',
      'export function getVersion() {',
      '  return VERSION;',
      '}',
    ].join('\n');
    writeFileSync(filePath, content, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'return VERSION;',
      new_string: 'return VERSION + "-debug";',
    });

    expect(result.error).toBeUndefined();
    const fileContent = readFileSync(filePath, 'utf-8');
    expect(fileContent).toContain('return VERSION + "-debug";');
    expect(fileContent).toContain('const VERSION = "1.0.0";');
  });

  it('succeeds when there is exactly one occurrence of old_string', async () => {
    const filePath = join(ctx.tempDir, 'single-match.ts');
    writeFileSync(filePath, 'const UNIQUE = 1;\nconst OTHER = 2;\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'UNIQUE',
      new_string: 'RENAMED',
    });

    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toContain('RENAMED');
  });
});

describe('ast_edit ambiguous match: preview rejects same as apply', () => {
  const ctx = useTempDir();

  it('preview also rejects ambiguous matches with occurrence mismatch', async () => {
    const filePath = join(ctx.tempDir, 'preview-ambiguous.ts');
    const content = 'const X = dup;\nconst Y = dup;\n';
    writeFileSync(filePath, content, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'dup',
      new_string: 'unique',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(
      ToolErrorType.EDIT_EXPECTED_OCCURRENCE_MISMATCH,
    );
    expect(result.llmContent).toBeDefined();
    expect(String(result.llmContent)).not.toContain('LLXPRT EDIT PREVIEW');
    expect(readFileSync(filePath, 'utf-8')).toBe(content);
  });
});
