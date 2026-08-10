/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ast_edit empty and edge-case inputs (issue #1758).
 */

import { describe, it, expect } from 'bun:test';
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

describe('ast_edit edge cases: empty old_string on existing file', () => {
  const ctx = useTempDir();

  it('returns edit_no_occurrence_found when old_string is empty and file already exists', async () => {
    const filePath = join(ctx.tempDir, 'empty-old-existing.ts');
    const originalContent = 'const x = 1;\n';
    writeFileSync(filePath, originalContent, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: '',
      new_string: 'const y = 2;\n',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.EDIT_NO_OCCURRENCE_FOUND);
    expect(readFileSync(filePath, 'utf-8')).toBe(originalContent);
  });
});

describe('ast_edit edge cases: old_string equals new_string', () => {
  const ctx = useTempDir();

  it('returns edit_no_change error when old_string and new_string are identical', async () => {
    const filePath = join(ctx.tempDir, 'no-op.ts');
    const originalContent = 'const greeting = "hello";\n';
    writeFileSync(filePath, originalContent, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: originalContent,
      new_string: originalContent,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.EDIT_NO_CHANGE);
    expect(readFileSync(filePath, 'utf-8')).toBe(originalContent);
  });

  it('returns edit_no_change error in preview mode when old_string equals new_string', async () => {
    const filePath = join(ctx.tempDir, 'no-op-preview.ts');
    const originalContent = 'const greeting = "hello";\n';
    writeFileSync(filePath, originalContent, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: originalContent,
      new_string: originalContent,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.EDIT_NO_CHANGE);
    expect(result.llmContent).toBeDefined();
    expect(String(result.llmContent)).not.toContain('LLXPRT EDIT PREVIEW');
  });
});
describe('ast_edit edge cases: empty new_string deletes matched content', () => {
  const ctx = useTempDir();
  const NL = '\n';

  it('removes the old_string when new_string is empty', async () => {
    const filePath = join(ctx.tempDir, 'deletion.ts');
    const original =
      ['const keep = 1;', 'const remove = 2;', 'const also = 3;'].join(NL) + NL;
    writeFileSync(filePath, original, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const remove = 2;' + NL,
      new_string: '',
    });

    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toBe(
      ['const keep = 1;', 'const also = 3;'].join(NL) + NL,
    );
  });
});

describe('ast_edit edge cases: very large old_string spanning entire file', () => {
  const ctx = useTempDir();

  it('replaces entire file content when old_string matches the whole file', async () => {
    const filePath = join(ctx.tempDir, 'full-replace.ts');
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`export const VALUE_${i} = ${i};`);
    }
    const fullContent = lines.join('\n') + '\n';
    writeFileSync(filePath, fullContent, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: fullContent,
      new_string: 'export const REPLACED = true;\n',
    });

    expect(result.error).toBeUndefined();
    expect(readFileSync(filePath, 'utf-8')).toBe(
      'export const REPLACED = true;\n',
    );
  });
});

describe('ast_edit edge cases: whitespace-only differences from file content', () => {
  const ctx = useTempDir();

  it('fails to match when old_string has trailing whitespace that the file does not', async () => {
    const filePath = join(ctx.tempDir, 'trailing-ws.ts');
    const originalContent = 'const x = 1;\n';
    writeFileSync(filePath, originalContent, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const x = 1;   \n',
      new_string: 'const x = 2;\n',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.EDIT_NO_OCCURRENCE_FOUND);
    expect(readFileSync(filePath, 'utf-8')).toBe(originalContent);
  });

  it('fails to match when old_string has different indentation than file content', async () => {
    const filePath = join(ctx.tempDir, 'indentation.ts');
    const originalContent = 'function f() {\n  return 1;\n}\n';
    writeFileSync(filePath, originalContent, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'function f() {\n    return 1;\n}\n',
      new_string: 'function f() {\n    return 2;\n}\n',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(ToolErrorType.EDIT_NO_OCCURRENCE_FOUND);
    expect(readFileSync(filePath, 'utf-8')).toBe(originalContent);
  });
});
