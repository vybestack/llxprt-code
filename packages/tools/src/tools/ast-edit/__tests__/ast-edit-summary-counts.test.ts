/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ast_edit preview summary counts across languages
 * (issue #2806).
 *
 * The preview header reports `- Functions: N` and `- Classes: N`. These
 * counts are derived from the AST declaration list, NOT from per-language
 * regex extractors, so they must be accurate for every supported language.
 *
 * Tests behavior, not implementation: uses real files on disk and real
 * ASTEditTool instances. No mocking of the tool under test.
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

/**
 * Escapes a literal string for safe embedding in a RegExp.
 */
function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts the numeric count from a preview header line like
 * "- Functions: 3". Throws with the surrounding output when the label is
 * absent so output-format regressions surface the actual content.
 */
function countFrom(output: string, label: string): number {
  const match = output.match(new RegExp(`${escapeRegex(label)}: (\\d+)`));
  if (!match) {
    throw new Error(
      `Expected preview header "${label}: N" but it was not found.\nOutput:\n${output}`,
    );
  }
  return Number(match[1]);
}

/**
 * Fails fast with a clear diagnostic if the preview produced an error,
 * so subsequent assertions don't report confusing NaN/undefined failures.
 */
function requireNoError(result: {
  error?: unknown;
  llmContent: unknown;
}): void {
  if (result.error !== undefined) {
    throw new Error(
      `Preview returned an error: ${JSON.stringify(result.error)}`,
    );
  }
}

describe('ast_edit summary counts: TypeScript', () => {
  const ctx = useTempDir();

  it('counts functions and classes from AST declarations', async () => {
    const filePath = join(ctx.tempDir, 'counts.ts');
    writeFileSync(
      filePath,
      [
        'function alpha(): void {}',
        'function beta(): void {}',
        'class Greeter {',
        '  greet() {}',
        '}',
        'const x = 1;',
        '',
      ].join('\n'),
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'function alpha()',
      new_string: 'function alphaRenamed()',
    });

    requireNoError(result);
    const output = String(result.llmContent);
    // 2 top-level functions + 1 method inside the class
    expect(countFrom(output, 'Functions')).toBe(3);
    expect(countFrom(output, 'Classes')).toBe(1);
  });
});

describe('ast_edit summary counts: Rust', () => {
  const ctx = useTempDir();

  it('counts functions, structs, traits, enums, and impls (not 0)', async () => {
    const filePath = join(ctx.tempDir, 'counts.rs');
    writeFileSync(
      filePath,
      [
        'fn free_function() {}',
        '',
        'struct Point {',
        '    x: f64,',
        '    y: f64,',
        '}',
        '',
        'impl Point {',
        '    fn new() -> Self { Self { x: 0.0, y: 0.0 } }',
        '}',
        '',
        'trait Drawable {',
        '    fn draw(&self);',
        '}',
        '',
        'enum Color {',
        '    Red,',
        '    Green,',
        '}',
        '',
      ].join('\n'),
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'fn free_function() {}',
      new_string: 'fn free_function() { /* noop */ }',
    });

    requireNoError(result);
    const output = String(result.llmContent);
    // free_function + new (impl method) = 2 functions
    expect(countFrom(output, 'Functions')).toBe(2);
    // struct Point + trait Drawable + enum Color + impl Point = 4
    expect(countFrom(output, 'Classes')).toBe(4);
  });
});

describe('ast_edit summary counts: C', () => {
  const ctx = useTempDir();

  it('counts functions, structs, unions, and enums (not 0)', async () => {
    const filePath = join(ctx.tempDir, 'counts.c');
    writeFileSync(
      filePath,
      [
        'struct Point {',
        '    int x;',
        '    int y;',
        '};',
        '',
        'union Data {',
        '    int i;',
        '    float f;',
        '};',
        '',
        'enum Status { OK, FAIL };',
        '',
        'int compute(void) {',
        '    return 0;',
        '}',
        '',
      ].join('\n'),
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'return 0;',
      new_string: 'return 1;',
    });

    requireNoError(result);
    const output = String(result.llmContent);
    expect(countFrom(output, 'Functions')).toBe(1);
    // struct Point + union Data + enum Status = 3
    expect(countFrom(output, 'Classes')).toBe(3);
  });
});

describe('ast_edit summary counts: consistency with declarations', () => {
  const ctx = useTempDir();

  it('Rust function/class counts match the ENHANCED CONTEXT declarations', async () => {
    const filePath = join(ctx.tempDir, 'consistent.rs');
    writeFileSync(
      filePath,
      [
        'fn handler() {}',
        'struct Config {',
        '    enabled: bool,',
        '}',
        'enum Mode { Fast, Slow }',
        '',
      ].join('\n'),
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'fn handler() {}',
      new_string: 'fn handler() { /* done */ }',
    });

    requireNoError(result);
    const output = String(result.llmContent);

    // Count the declaration lines under ENHANCED CONTEXT ANALYSIS
    const header = 'ENHANCED CONTEXT ANALYSIS:';
    const headerIdx = output.indexOf(header);
    expect(headerIdx).toBeGreaterThan(-1);
    const declSection = output.slice(headerIdx + header.length);
    const declLines = declSection.split('\n');
    const functionDecls = declLines.filter((l) =>
      l.trim().startsWith('- function:'),
    ).length;
    const classLikePrefixes = [
      '- struct:',
      '- enum:',
      '- trait:',
      '- union:',
      '- impl:',
    ];
    const classLikeDecls = declLines.filter((l) =>
      classLikePrefixes.some((p) => l.trim().startsWith(p)),
    ).length;

    expect(countFrom(output, 'Functions')).toBe(functionDecls);
    expect(countFrom(output, 'Classes')).toBe(classLikeDecls);
  });
});
