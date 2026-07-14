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
