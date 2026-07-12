/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IToolHost } from '../../../interfaces/index.js';
import { ASTEditTool } from '../../ast-edit.js';
import type { ToolResult } from '../../tools.js';

function createTempDir(prefix = 'llxprt-ast-preview-test-'): {
  dir: string;
  cleanup: () => void;
} {
  const dir = join(
    tmpdir(),
    `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup after each test.
      }
    },
  };
}

function createFakeToolHost(targetDir: string): IToolHost {
  return {
    getTargetDir: () => targetDir,
    getWorkspaceRoots: () => [targetDir],
    getApprovalMode: () => 'auto',
    setApprovalMode: () => {},
    isInteractive: () => false,
    hasFeatureFlag: () => false,
    getEphemeralSettings: () => ({}),
  };
}

async function executePreview(
  tool: ASTEditTool,
  params: Record<string, unknown>,
): Promise<ToolResult> {
  return tool.build(params).execute(new AbortController().signal);
}

describe('ASTEditTool preview phase validation (issue #1755)', () => {
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

  it('returns EDIT_NO_OCCURRENCE_FOUND error when old_string is absent in preview mode', async () => {
    const filePath = join(tempDir, 'absent-old-string.ts');
    const originalContent = 'const greeting = "hello";\n';
    writeFileSync(filePath, originalContent, 'utf-8');

    const tool = new ASTEditTool(createFakeToolHost(tempDir));
    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'THIS STRING DOES NOT EXIST',
      new_string: 'const greeting = "world";',
      force: false,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe('edit_no_occurrence_found');
    expect(String(result.llmContent)).toContain('0 occurrences');
    expect(String(result.llmContent)).not.toContain('LLXPRT EDIT PREVIEW');
    expect(String(result.llmContent)).not.toContain(
      'NEXT STEP: Call again with force: true',
    );
    expect(readFileSync(filePath, 'utf-8')).toBe(originalContent);
  });

  it('returns LLXPRT EDIT PREVIEW green-light when old_string matches in preview mode', async () => {
    const filePath = join(tempDir, 'valid-old-string.ts');
    writeFileSync(filePath, 'const greeting = "hello";\n', 'utf-8');

    const tool = new ASTEditTool(createFakeToolHost(tempDir));
    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const greeting = "hello";',
      new_string: 'const greeting = "world";',
      force: false,
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('LLXPRT EDIT PREVIEW');
    expect(String(result.llmContent)).toContain(
      'NEXT STEP: Call again with force: true',
    );
  });

  it('preserves new-file preview semantics when old_string is empty and file does not exist', async () => {
    const filePath = join(tempDir, 'brand-new-file.ts');

    const tool = new ASTEditTool(createFakeToolHost(tempDir));
    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: '',
      new_string: 'const brandNew = 42;\n',
      force: false,
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('LLXPRT EDIT PREVIEW');
    expect(String(result.llmContent)).toContain(
      'NEXT STEP: Call again with force: true',
    );
  });

  it('does not modify file content when old_string is absent in preview mode', async () => {
    const filePath = join(tempDir, 'unchanged-file.ts');
    const originalContent =
      'export function add(a: number, b: number): number {\n  return a + b;\n}\n';
    writeFileSync(filePath, originalContent, 'utf-8');

    const tool = new ASTEditTool(createFakeToolHost(tempDir));
    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'export function subtract(',
      new_string: 'export function subtract(a: number, b: number): number {',
      force: false,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe('edit_no_occurrence_found');
    expect(readFileSync(filePath, 'utf-8')).toBe(originalContent);
  });

  it('builds enhanced context from current content in preview mode', async () => {
    const filePath = join(tempDir, 'current-context.ts');
    const originalContent =
      'export function greet(name: string): string {\n  return `hello ${name}`;\n}\n';
    writeFileSync(filePath, originalContent, 'utf-8');

    const tool = new ASTEditTool(createFakeToolHost(tempDir));
    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: originalContent,
      new_string: '',
      force: false,
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain(
      '- Context: typescript file with 1 declarations',
    );
  });
});

const NL = '\n';

function makeBrokenFile(): string {
  return [
    'export function greet(name: string): string {',
    '  return `hello ${name}`;',
    '}',
    'const broken = @@@;',
    '',
  ].join(NL);
}

describe('ASTEditTool pre-existing vs newly-introduced error categorization (issue #2124)', () => {
  let tempDir: string;
  let cleanup: () => void = () => {};

  beforeEach(() => {
    const tmp = createTempDir('llxprt-ast-categorize-');
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('categorizes a pre-existing syntax error as pre-existing in preview', async () => {
    const filePath = join(tempDir, 'preexisting-error.ts');
    writeFileSync(filePath, makeBrokenFile(), 'utf-8');

    const tool = new ASTEditTool(createFakeToolHost(tempDir));
    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'return `hello ${name}`;',
      new_string: 'return `world ${name}`;',
      force: false,
    });

    expect(result.error).toBeUndefined();
    const content = String(result.llmContent);
    expect(content).toMatch(
      /AST validation: FAILED \(pre-existing error at line \d+ — present before this edit\)/,
    );
    expect(content).not.toContain('new error introduced');
    expect(content).toContain('Pre-existing syntax errors: Yes');
  });

  it('categorizes a syntax error introduced by the edit as newly-introduced in preview', async () => {
    const filePath = join(tempDir, 'clean-before-edit.ts');
    writeFileSync(filePath, 'const greeting = "hello";' + NL, 'utf-8');

    const tool = new ASTEditTool(createFakeToolHost(tempDir));
    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const greeting = "hello";',
      new_string: 'const greeting = @@@;',
      force: false,
    });

    expect(result.error).toBeUndefined();
    const content = String(result.llmContent);
    expect(content).toContain('new error introduced by this edit');
    expect(content).not.toContain('Pre-existing syntax errors: Yes');
  });

  it('reports PASSED when editing a clean file without introducing errors', async () => {
    const filePath = join(tempDir, 'clean-edit.ts');
    writeFileSync(filePath, 'const greeting = "hello";' + NL, 'utf-8');

    const tool = new ASTEditTool(createFakeToolHost(tempDir));
    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const greeting = "hello";',
      new_string: 'const greeting = "world";',
      force: false,
    });

    expect(result.error).toBeUndefined();
    const content = String(result.llmContent);
    expect(content).toContain('AST validation: PASSED');
    expect(content).not.toContain('FAILED');
    expect(content).not.toContain('Pre-existing syntax errors: Yes');
  });

  it('categorizes a pre-existing error as pre-existing in apply (force) output', async () => {
    const filePath = join(tempDir, 'apply-preexisting.ts');
    writeFileSync(filePath, makeBrokenFile(), 'utf-8');

    const tool = new ASTEditTool(createFakeToolHost(tempDir));
    const result = await tool
      .build({
        file_path: filePath,
        old_string: 'return `hello ${name}`;',
        new_string: 'return `world ${name}`;',
        force: true,
      })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    const content = String(result.llmContent);
    expect(content).toMatch(
      /AST validation: FAILED \(pre-existing error at line \d+ — present before this edit\)/,
    );
    expect(content).not.toContain('new error introduced');
    expect(content).toContain('Pre-existing syntax errors: Yes');
    const display = result.returnDisplay as {
      metadata?: {
        astValidation?: { valid: boolean; errors: string[] };
        preEditValidation?: { valid: boolean; errors: string[] };
      };
    };
    expect(display.metadata?.preEditValidation).toBeDefined();
    expect(display.metadata?.preEditValidation?.valid).toBe(false);
    expect(display.metadata?.astValidation?.valid).toBe(false);
    // Verify the file was actually written despite the pre-existing error.
    expect(readFileSync(filePath, 'utf-8')).toContain(
      'return `world ${name}`;',
    );
  });

  it('categorizes a newly-introduced error in apply (force) output', async () => {
    const filePath = join(tempDir, 'apply-new-error.ts');
    writeFileSync(filePath, 'const greeting = "hello";' + NL, 'utf-8');

    const tool = new ASTEditTool(createFakeToolHost(tempDir));
    const result = await tool
      .build({
        file_path: filePath,
        old_string: 'const greeting = "hello";',
        new_string: 'const greeting = @@@;',
        force: true,
      })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    const content = String(result.llmContent);
    expect(content).toContain('new error introduced by this edit');
    expect(content).not.toContain('Pre-existing syntax errors: Yes');
    // Verify the file was actually written with the (broken) new content.
    expect(readFileSync(filePath, 'utf-8')).toContain('@@@');
  });

  it('reports mixed pre-existing and newly-introduced errors in preview', async () => {
    // File has a pre-existing syntax error (unclosed function at line 7) and
    // the edit introduces a new error (@@@ at line 1).
    const filePath = join(tempDir, 'mixed-errors.ts');
    const brokenContent = [
      'const greeting = "hello";',
      'const a = 1;',
      'const b = 2;',
      'const c = 3;',
      'const d = 4;',
      'const e = 5;',
      'function broken(',
    ].join(NL);
    writeFileSync(filePath, brokenContent, 'utf-8');

    const tool = new ASTEditTool(createFakeToolHost(tempDir));
    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'const greeting = "hello";',
      new_string: 'const greeting = @@@;',
      force: false,
    });

    expect(result.error).toBeUndefined();
    const content = String(result.llmContent);
    expect(content).toContain('Pre-existing syntax errors: Yes');
    expect(content).toMatch(
      /AST validation: FAILED \(file had pre-existing errors? at line \d+; post-edit error at line \d+ may be newly introduced\)/,
    );
    expect(content).toMatch(/AST errors: Syntax error at line \d+, column \d+/);
    expect(content).not.toContain('present before this edit');
  });
});
