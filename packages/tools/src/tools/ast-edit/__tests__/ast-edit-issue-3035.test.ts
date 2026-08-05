/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for issue #3035: make ast_edit validation authoritative
 * and its contract accurate.
 *
 * Covers:
 * - REQ-3035-1: force schema documents the two-step preview/apply contract.
 * - REQ-3035-3: useful parser locations (whole-file recovery vs. precise).
 * - REQ-3035-4: coherent validation messaging (resolved vs. pre-existing).
 * - REQ-3035-6: previews omit WORKING SET CONTEXT but keep ENHANCED CONTEXT.
 * - REQ-3035-7: unsupported/prose files return no guessed declarations.
 *
 * Tests behavior, not implementation: real files on disk, real ASTEditTool
 * instances, and real git state. No mocking of the tool under test.
 */

import { describe, it, expect } from 'bun:test';
import { writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  useTempDir,
  createFakeToolHost,
  executePreview,
  executeApply,
} from './test-helpers.js';
import { ASTEditTool } from '../../ast-edit.js';

/**
 * Extracts the integer declaration count from the preview "Context:" header.
 */
function declarationCountFromPreview(output: string): number {
  const match = output.match(/with (\d+) declarations/);
  return match ? Number(match[1]) : -1;
}

describe('REQ-3035-1: force schema documents the two-step contract', () => {
  it('states that omitted/false previews and true applies', () => {
    const tool = new ASTEditTool(createFakeToolHost('/tmp'));
    const schema = tool.parameterSchema as {
      properties?: { force?: { description?: string } };
    };
    const description = schema.properties?.force?.description ?? '';
    // Preview vs. apply semantics must be explicit to the agent.
    expect(description.toLowerCase()).toContain('preview');
    expect(description.toLowerCase()).toContain('apply');
    // force must NOT be documented as a validation bypass.
    expect(description.toLowerCase()).not.toContain('bypass');
  });
});

describe('REQ-3035-3: useful parser error locations', () => {
  const ctx = useTempDir();

  it('reports the edit region (not line 1) for whole-file tree-sitter recovery without a nested diagnostic', async () => {
    // A class whose method body becomes `return {{{` triggers tree-sitter's
    // whole-program recovery, which otherwise reports line 1:1. When no
    // nested precise ERROR is available, the approximate edit-region location
    // is the only diagnostic.
    const filePath = join(ctx.tempDir, 'whole-recovery.ts');
    writeFileSync(
      filePath,
      ['class Foo {', '  bar() {', '    return 1;', '  }', '}', ''].join('\n'),
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: '    return 1;',
      new_string: '    return {{{',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('AST validation: FAILED');
    // Approximate edit-region reporting: the edit starts at line 3.
    expect(output).not.toMatch(/at line 1, column 1/);
    expect(output).toMatch(/near line 3/);
  });

  it('reports a precise nested parser location when available alongside whole-file recovery', async () => {
    // When the whole-file recovery has a nested precise ERROR, the exact
    // location is preferred over the approximate edit-region reporting.
    const filePath = join(ctx.tempDir, 'whole-recovery-nested.ts');
    writeFileSync(
      filePath,
      [
        'class Foo {',
        '  bar() {',
        '    return 1;',
        '  }',
        '}',
        'const marker = 1;',
        '',
      ].join('\n'),
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: '    return 1;',
      new_string: '    return {{{',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('AST validation: FAILED');
    // The nested precise ERROR provides an exact location at line 3, column 5
    // (1-based), preferred over the approximate whole-file recovery message.
    expect(output).toMatch(/Syntax error at line 3, column 5/);
    expect(output).not.toMatch(/at line 1, column 1/);
  });

  it('keeps already-precise parser locations precise (no regression)', async () => {
    // A localized `{{{` mid-file yields an accurate ERROR node location.
    const filePath = join(ctx.tempDir, 'precise.ts');
    writeFileSync(
      filePath,
      ['const a = 1;', 'const b = 2;', 'const c = 3;', ''].join('\n'),
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const b = 2;',
      new_string: 'const b = {{{ 2;',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('AST validation: FAILED');
    // Accurate location: line 2, column 9 (1-based), reported exactly.
    expect(output).toMatch(/Syntax error at line 2, column 9/);
    expect(output).not.toContain('near line');
    expect(output).not.toContain('whole-file recovery');
  });
});

describe('REQ-3035-4: coherent validation messaging', () => {
  const ctx = useTempDir();

  it('reports resolution and does NOT also claim pre-existing errors remain', async () => {
    // File starts with a pre-existing syntax error; the edit fixes it.
    const filePath = join(ctx.tempDir, 'resolvable.ts');
    writeFileSync(
      filePath,
      'const greeting = "hello";\nconst broken = @@@;\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const broken = @@@;',
      new_string: 'const broken = 2;',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('AST validation: PASSED');
    expect(output).toContain('resolved');
    // Must not contradict itself by also reporting lingering pre-existing errors.
    expect(output).not.toContain('Pre-existing syntax errors: Yes');
    expect(readFileSync(filePath, 'utf-8')).toBe(
      'const greeting = "hello";\nconst broken = 2;\n',
    );
  });

  it('reports remaining pre-existing-only errors without classifying them as new', async () => {
    // File has a pre-existing error that the edit does not touch; the edit
    // elsewhere is valid. The remaining error must be labeled pre-existing.
    const filePath = join(ctx.tempDir, 'preexisting-remains.ts');
    writeFileSync(filePath, 'const keep = 1;\nconst broken = @@@;\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'const keep = 1;',
      new_string: 'const keep = 2;',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('pre-existing');
    expect(output).not.toContain('new error introduced');
  });
});

describe('REQ-3035-6: previews keep target context and drop working set', () => {
  const ctx = useTempDir();

  /**
   * Initializes a throwaway git repo so a modified tracked file appears in the
   * git working set (the eager context the old code collected).
   */
  function initGitWorkingSet(tempDir: string): void {
    const git = (args: string[]): void => {
      const result = spawnSync('git', ['-C', tempDir, ...args], {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      if (result.status !== 0 || result.error) {
        throw new Error(
          `git ${args.join(' ')} failed: ${result.error?.message ?? result.stderr}`,
        );
      }
    };
    git(['init']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    const other = join(tempDir, 'other.ts');
    writeFileSync(other, 'export function helper(): void {}\n', 'utf-8');
    git(['add', 'other.ts']);
    git(['commit', '-m', 'init', 'other.ts']);
    // Mutate the tracked file so it shows up as an unstaged working-set change.
    writeFileSync(
      other,
      'export function helper(): void {\n  return;\n}\n',
      'utf-8',
    );
  }

  it('omits WORKING SET CONTEXT while retaining ENHANCED CONTEXT ANALYSIS', async () => {
    initGitWorkingSet(ctx.tempDir);
    const filePath = join(ctx.tempDir, 'target.ts');
    writeFileSync(filePath, 'export function alpha(): void {}\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'export function alpha()',
      new_string: 'export function beta()',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).not.toContain('WORKING SET CONTEXT');
    expect(output).not.toContain('other.ts');
    expect(output).toContain('ENHANCED CONTEXT ANALYSIS:');
    expect(output).toContain('function: alpha (line 1)');
  });
});

describe('REQ-3035-7: prose/unsupported files yield no guessed declarations', () => {
  const ctx = useTempDir();

  it('returns zero declarations for Markdown containing code-like words', async () => {
    const filePath = join(ctx.tempDir, 'doc.md');
    writeFileSync(
      filePath,
      [
        '# Documentation',
        '',
        'This specifies the default classification of items.',
        'The function of this module is described below.',
        'class diagrams are in the appendix.',
        'def examples are omitted.',
        '',
      ].join('\n'),
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'class diagrams are in the appendix.',
      new_string: 'class diagrams are omitted.',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(declarationCountFromPreview(output)).toBe(0);
    // No garbage guessed declarations under the enhanced context section.
    const header = 'ENHANCED CONTEXT ANALYSIS:';
    const headerIdx = output.indexOf(header);
    expect(headerIdx).toBeGreaterThan(-1);
    const section = output.slice(headerIdx);
    // No garbage guessed declarations under the enhanced context section.
    for (const kind of ['- function:', '- class:', '- variable:', '- def:']) {
      expect(section).not.toContain(kind);
    }
    expect(section).not.toContain(': of');
    expect(section).not.toContain(': diagrams');
  });

  it('returns zero declarations for a YAML file', async () => {
    const filePath = join(ctx.tempDir, 'config.yaml');
    writeFileSync(
      filePath,
      [
        'classification:',
        '  default: native',
        'specifies:',
        '  mode: strict',
        '',
      ].join('\n'),
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: '  mode: strict',
      new_string: '  mode: relaxed',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(declarationCountFromPreview(output)).toBe(0);
  });

  it('still extracts declarations for a supported language that parses cleanly', async () => {
    // Regression guard: supported-code extraction must keep working.
    const filePath = join(ctx.tempDir, 'real.ts');
    writeFileSync(
      filePath,
      'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'return a + b;',
      new_string: 'return a + b + 0;',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(declarationCountFromPreview(output)).toBeGreaterThanOrEqual(1);
    expect(output).toContain('function: add (line 1)');
  });
});
