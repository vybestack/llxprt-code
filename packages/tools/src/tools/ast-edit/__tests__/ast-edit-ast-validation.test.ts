/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ast_edit AST validation accuracy and
 * multi-language support (issue #1758).
 *
 * AST validation runs on the proposed new content (after replacement).
 * These tests use preview mode to observe the validation status without
 * writing to disk.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  useTempDir,
  createFakeToolHost,
  executePreview,
} from './test-helpers.js';
import { ASTEditTool } from '../../ast-edit.js';

describe('ast_edit AST validation: TypeScript', () => {
  const ctx = useTempDir();

  it('reports AST PASSED for valid TypeScript', async () => {
    const filePath = join(ctx.tempDir, 'valid.ts');
    writeFileSync(filePath, 'const greeting = "hello";\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const greeting = "hello";',
      new_string: 'const greeting = "world";',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });

  it('reports AST FAILED with line/column for missing closing brace in object literal', async () => {
    const filePath = join(ctx.tempDir, 'missing-brace.ts');
    writeFileSync(filePath, 'const obj = { a: 1 };\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const obj = { a: 1 };',
      new_string: 'const obj = { a: 1 ',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('AST validation: FAILED');
    expect(output).toContain('AST errors:');
    expect(output).toMatch(/line \d+/);
    expect(output).toMatch(/column \d+/);
  });

  it('reports AST FAILED for broken TypeScript with unterminated string', async () => {
    const filePath = join(ctx.tempDir, 'unterminated.ts');
    writeFileSync(filePath, 'const msg = "ok";\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const msg = "ok";',
      new_string: 'const msg = "unterminated;\n',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: FAILED');
  });
});

describe('ast_edit AST validation: Python', () => {
  const ctx = useTempDir();

  it('reports AST PASSED for valid Python', async () => {
    const filePath = join(ctx.tempDir, 'valid.py');
    writeFileSync(
      filePath,
      'def greet(name):\n    return f"hello {name}"\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'def greet(name):',
      new_string: 'def say_hello(name):',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });

  it('reports AST FAILED with line/column for missing colon on def line', async () => {
    const filePath = join(ctx.tempDir, 'missing-colon.py');
    writeFileSync(filePath, 'def greet(name):\n    return "hello"\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'def greet(name):',
      new_string: 'def greet(name)',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('AST validation: FAILED');
    expect(output).toMatch(/line \d+/);
  });

  it('reports AST PASSED for indentation change that produces valid code', async () => {
    const filePath = join(ctx.tempDir, 'indent-change.py');
    writeFileSync(
      filePath,
      'def greet(name):\n    return f"hello {name}"\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: '    return f"hello {name}"',
      new_string: '    msg = f"hello {name}"\n    return msg',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });

  it('reports AST FAILED for broken Python with unbalanced parentheses', async () => {
    const filePath = join(ctx.tempDir, 'broken-py.py');
    writeFileSync(filePath, 'def add(a, b):\n    return a + b\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: '    return a + b',
      new_string: '    return add(a, b',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: FAILED');
  });
});

describe('ast_edit AST validation: unknown file extension', () => {
  const ctx = useTempDir();

  it('reports AST PASSED for a .txt file (unknown extension)', async () => {
    const filePath = join(ctx.tempDir, 'readme.txt');
    writeFileSync(filePath, 'Hello World\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'Hello World',
      new_string: 'Goodbye World',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });

  it('reports AST PASSED for a .md file with arbitrary content', async () => {
    const filePath = join(ctx.tempDir, 'doc.md');
    writeFileSync(filePath, '# Title\n\nSome text.\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'Some text.',
      new_string: '} broken { syntax :',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });
});

describe('ast_edit AST validation: multi-language support', () => {
  const ctx = useTempDir();

  it('validates .js: PASSED for valid, FAILED for broken', async () => {
    const filePath = join(ctx.tempDir, 'script.js');
    writeFileSync(filePath, 'const greeting = "hello";\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const validResult = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const greeting = "hello";',
      new_string: 'const greeting = "world";',
    });
    expect(String(validResult.llmContent)).toContain('AST validation: PASSED');

    const brokenResult = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const greeting = "hello";',
      new_string: 'const greeting = "world',
    });
    expect(String(brokenResult.llmContent)).toContain('AST validation: FAILED');
  });

  it('validates .ts: PASSED for valid, FAILED for broken', async () => {
    const filePath = join(ctx.tempDir, 'module.ts');
    writeFileSync(
      filePath,
      'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const validResult = await executePreview(tool, {
      file_path: filePath,
      old_string: 'return a + b;',
      new_string: 'return a + b + 0;',
    });
    expect(String(validResult.llmContent)).toContain('AST validation: PASSED');

    const brokenResult = await executePreview(tool, {
      file_path: filePath,
      old_string: 'return a + b;',
      new_string: 'return a + b {',
    });
    expect(String(brokenResult.llmContent)).toContain('AST validation: FAILED');
  });

  it('validates .py: PASSED for valid, FAILED for broken', async () => {
    const filePath = join(ctx.tempDir, 'script.py');
    writeFileSync(filePath, 'def add(a, b):\n    return a + b\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const validResult = await executePreview(tool, {
      file_path: filePath,
      old_string: 'return a + b',
      new_string: 'return a + b + 0',
    });
    expect(String(validResult.llmContent)).toContain('AST validation: PASSED');

    const brokenResult = await executePreview(tool, {
      file_path: filePath,
      old_string: 'return a + b',
      new_string: 'return a + b(',
    });
    expect(String(brokenResult.llmContent)).toContain('AST validation: FAILED');
  });

  it('validates .tsx files', async () => {
    const filePath = join(ctx.tempDir, 'component.tsx');
    writeFileSync(
      filePath,
      'export function Button() {\n  return <button>Click</button>;\n}\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const validResult = await executePreview(tool, {
      file_path: filePath,
      old_string: 'Click',
      new_string: 'Submit',
    });
    expect(String(validResult.llmContent)).toContain('AST validation: PASSED');

    const brokenResult = await executePreview(tool, {
      file_path: filePath,
      old_string: '<button>Click</button>;',
      new_string: '<button>Click</button',
    });
    expect(String(brokenResult.llmContent)).toContain('AST validation: FAILED');
  });

  it('validates .jsx files', async () => {
    const filePath = join(ctx.tempDir, 'component.jsx');
    writeFileSync(
      filePath,
      'export function Label() {\n  return <label>Name</label>;\n}\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'Name',
      new_string: 'Email',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');

    const brokenResult = await executePreview(tool, {
      file_path: filePath,
      old_string: '<label>Name</label>;',
      new_string: '<label>Name</label',
    });

    expect(brokenResult.error).toBeUndefined();
    expect(String(brokenResult.llmContent)).toContain('AST validation: FAILED');
  });
});
