/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ast_edit preview phase validation gaps and
 * preview response structure (issue #1758).
 *
 * Tests behavior, not implementation: uses real files on disk and real
 * ASTEditTool instances. No mocking of the tool under test.
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  useTempDir,
  createFakeToolHost,
  executePreview,
  writeFileWithMtime,
  getFileMtime,
} from './test-helpers.js';
import { ASTEditTool } from '../../ast-edit.js';

describe('ast_edit preview phase: non-existent file path', () => {
  const ctx = useTempDir();

  it('reports file_not_found error when file does not exist and old_string is non-empty', async () => {
    const filePath = join(ctx.tempDir, 'does-not-exist.ts');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'something',
      new_string: 'something else',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe('file_not_found');
    expect(String(result.llmContent)).toContain('File not found');
    expect(String(result.llmContent)).not.toContain('LLXPRT EDIT PREVIEW');
  });

  it('does not create the file in preview mode when file is missing', async () => {
    const filePath = join(ctx.tempDir, 'no-create.ts');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    await executePreview(tool, {
      file_path: filePath,
      old_string: 'something',
      new_string: 'something else',
    });

    expect(() => readFileSync(filePath, 'utf-8')).toThrow(
      expect.objectContaining({ code: 'ENOENT' }),
    );
  });
});

describe('ast_edit preview phase: occurrence count reporting', () => {
  const ctx = useTempDir();

  it('reports 0 occurrences in the error message when old_string is absent', async () => {
    const filePath = join(ctx.tempDir, 'no-match.ts');
    writeFileSync(filePath, 'const x = 1;\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'NOT_PRESENT',
      new_string: 'const y = 2;',
    });

    expect(result.error?.type).toBe('edit_no_occurrence_found');
    expect(String(result.llmContent)).toContain('0 occurrences');
  });
});

describe('ast_edit preview response structure', () => {
  const ctx = useTempDir();

  it('includes declaration count, function count, and class count in preview output', async () => {
    const filePath = join(ctx.tempDir, 'structure.ts');
    const content = [
      'export function greet(name: string): string {',
      '  return `hello ${name}`;',
      '}',
      '',
      'export class Greeter {',
      '  private name: string;',
      '  constructor(name: string) {',
      '    this.name = name;',
      '  }',
      '}',
      '',
      'export const DEFAULT_NAME = "world";',
    ].join('\n');
    writeFileSync(filePath, content, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'export function greet',
      new_string: 'export function sayHello',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toMatch(/Context: typescript file with \d+ declaration/);
    expect(output).toMatch(/Functions: \d+/);
    expect(output).toMatch(/Classes: \d+/);
  });

  it('includes AST validation status in preview output', async () => {
    const filePath = join(ctx.tempDir, 'valid-ast.ts');
    writeFileSync(filePath, 'const x = 1;\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });

  it('includes AST validation failure with error details when syntax is broken', async () => {
    const filePath = join(ctx.tempDir, 'broken-result.ts');
    writeFileSync(filePath, 'const x = 1;\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const x = 1;',
      new_string: 'const x = { broken: ',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('AST validation: FAILED');
    expect(output).toContain('AST errors:');
    const display = result.returnDisplay as {
      metadata?: { astValidation?: { valid: boolean; errors: string[] } };
    };
    expect(display.metadata?.astValidation?.valid).toBe(false);
    expect(display.metadata?.astValidation?.errors.length).toBeGreaterThan(0);
  });

  it('includes file timestamp in preview output for use with last_modified', async () => {
    const filePath = join(ctx.tempDir, 'timestamp.ts');
    const fixedMtime = 1700000000000;
    writeFileWithMtime(filePath, 'const x = 1;\n', fixedMtime);
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('Timestamp:');
    expect(String(result.llmContent)).toContain(String(fixedMtime));
  });

  it('includes enhanced context with declaration names and line numbers', async () => {
    const filePath = join(ctx.tempDir, 'context-detail.ts');
    const content = [
      'export function alpha(): void {',
      '  // first function',
      '}',
      '',
      'export function beta(): void {',
      '  // second function',
      '}',
    ].join('\n');
    writeFileSync(filePath, content, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'export function alpha()',
      new_string: 'export function alphaRenamed()',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('ENHANCED CONTEXT ANALYSIS:');
    expect(output).toContain('function: alpha (line 1)');
    expect(output).toContain('function: beta (line 5)');
  });

  it('includes returnDisplay metadata with astValidation and currentMtime', async () => {
    const filePath = join(ctx.tempDir, 'metadata.ts');
    writeFileWithMtime(filePath, 'const x = 1;\n');
    const expectedMtime = getFileMtime(filePath);
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
    });

    expect(result.error).toBeUndefined();
    expect(result.returnDisplay).toBeDefined();
    const display = result.returnDisplay as {
      metadata?: { astValidation?: { valid: boolean }; currentMtime?: number };
    };
    expect(display.metadata).toBeDefined();
    expect(display.metadata?.astValidation).toBeDefined();
    expect(display.metadata?.astValidation?.valid).toBe(true);
    expect(display.metadata?.currentMtime).toBe(expectedMtime);
  });
});
