/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ast_edit CRLF line-ending normalization (issue #1758).
 *
 * The tool normalizes all line endings to LF internally before matching.
 * This means CRLF files, LF old_strings, and mixed-ending files all
 * interoperate. Output is always LF-normalized.
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  useTempDir,
  createFakeToolHost,
  executeApply,
} from './test-helpers.js';
import { ASTEditTool } from '../../ast-edit.js';

describe('ast_edit CRLF normalization: file with CRLF, old_string with LF', () => {
  const ctx = useTempDir();

  it('matches and replaces when file uses CRLF and old_string uses LF', async () => {
    const filePath = join(ctx.tempDir, 'crlf-file.ts');
    const crlfContent =
      'const greeting = "hello";\r\nconst name = "world";\r\n';
    writeFileSync(filePath, crlfContent, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const greeting = "hello";\nconst name = "world";',
      new_string: 'const greeting = "hi";\nconst name = "earth";',
    });

    expect(result.error).toBeUndefined();
    const fileContent = readFileSync(filePath, 'utf-8');
    expect(fileContent).toBe('const greeting = "hi";\nconst name = "earth";\n');
  });
});

describe('ast_edit CRLF normalization: file with LF, old_string with CRLF', () => {
  const ctx = useTempDir();

  it('matches and replaces when file uses LF and old_string uses CRLF', async () => {
    const filePath = join(ctx.tempDir, 'lf-file.ts');
    const lfContent = 'const greeting = "hello";\nconst name = "world";\n';
    writeFileSync(filePath, lfContent, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const greeting = "hello";\r\nconst name = "world";',
      new_string: 'const greeting = "hi";\r\nconst name = "earth";',
    });

    expect(result.error).toBeUndefined();
    const fileContent = readFileSync(filePath, 'utf-8');
    expect(fileContent).toBe('const greeting = "hi";\nconst name = "earth";\n');
    expect(fileContent).not.toContain('\r\n');
  });
});

describe('ast_edit CRLF normalization: mixed line endings', () => {
  const ctx = useTempDir();

  it('matches across mixed CRLF and LF line endings in the file', async () => {
    const filePath = join(ctx.tempDir, 'mixed.ts');
    const mixedContent = 'const a = 1;\r\nconst b = 2;\nconst c = 3;\r\n';
    writeFileSync(filePath, mixedContent, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const a = 1;\nconst b = 2;\nconst c = 3;',
      new_string: 'const a = 10;\nconst b = 20;\nconst c = 30;',
    });

    expect(result.error).toBeUndefined();
    const fileContent = readFileSync(filePath, 'utf-8');
    expect(fileContent).toBe('const a = 10;\nconst b = 20;\nconst c = 30;\n');
  });
});

describe('ast_edit CRLF normalization: output is LF-normalized', () => {
  const ctx = useTempDir();

  it('writes LF-normalized content when original file had CRLF', async () => {
    const filePath = join(ctx.tempDir, 'normalize-output.ts');
    const crlfContent = 'const x = 1;\r\nconst y = 2;\r\n';
    writeFileSync(filePath, crlfContent, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const x = 1;\nconst y = 2;',
      new_string: 'const x = 10;\nconst y = 20;',
    });

    expect(result.error).toBeUndefined();
    const fileContent = readFileSync(filePath, 'utf-8');
    expect(fileContent).not.toContain('\r\n');
    expect(fileContent).toContain('\n');
  });
});
