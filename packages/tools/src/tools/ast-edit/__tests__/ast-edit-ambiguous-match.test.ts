/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ast_edit ambiguous match handling (issue #1758).
 *
 * When old_string appears in multiple locations, the tool uses
 * String.replace() semantics: only the FIRST occurrence is replaced.
 * These tests verify that actual file-on-disk behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTempDir,
  createFakeToolHost,
  executeApply,
  executePreview,
} from './test-helpers.js';
import { ASTEditTool } from '../../ast-edit.js';

describe('ast_edit ambiguous match: exactly 2 occurrences', () => {
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

  it('replaces only the first occurrence when old_string appears twice', async () => {
    const filePath = join(tempDir, 'two-matches.ts');
    const content = [
      'const DUPLICATE = 1;',
      'const OTHER = 2;',
      'const DUPLICATE = 3;',
    ].join('\n');
    writeFileSync(filePath, content, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'DUPLICATE',
      new_string: 'RENAMED',
    });

    expect(result.error).toBeUndefined();
    const fileContent = readFileSync(filePath, 'utf-8');
    const lines = fileContent.split('\n');
    expect(lines[0]).toContain('RENAMED');
    expect(lines[0]).not.toContain('DUPLICATE');
    expect(lines[2]).toContain('DUPLICATE');
    expect(lines[2]).not.toContain('RENAMED');
  });

  it('reports 1 replacement applied when old_string matches twice', async () => {
    const filePath = join(tempDir, 'two-count.ts');
    writeFileSync(
      filePath,
      'const TOKEN = 1;\nconst OTHER = 2;\nconst TOKEN = 3;\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'TOKEN',
      new_string: 'ID',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('1 replacement(s)');
  });
});

describe('ast_edit ambiguous match: 3+ occurrences', () => {
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

  it('replaces only the first occurrence when old_string appears 3 times', async () => {
    const filePath = join(tempDir, 'three-matches.ts');
    const content = [
      'let value = placeholder;',
      'let value2 = placeholder;',
      'let value3 = placeholder;',
    ].join('\n');
    writeFileSync(filePath, content, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'placeholder',
      new_string: 'real',
    });

    expect(result.error).toBeUndefined();
    const fileContent = readFileSync(filePath, 'utf-8');
    const lines = fileContent.split('\n');
    expect(lines[0]).toContain('real');
    expect(lines[1]).toContain('placeholder');
    expect(lines[2]).toContain('placeholder');
  });
});

describe('ast_edit ambiguous match: correct occurrence targeted', () => {
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

  it('targets the first occurrence in document order when old_string has different surrounding context', async () => {
    const filePath = join(tempDir, 'context-order.ts');
    const content = [
      '// Section A',
      'function process() {',
      '  return COMMON_PATTERN;',
      '}',
      '// Section B',
      'function validate() {',
      '  return COMMON_PATTERN;',
      '}',
    ].join('\n');
    writeFileSync(filePath, content, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'COMMON_PATTERN',
      new_string: 'RESOLVED',
    });

    expect(result.error).toBeUndefined();
    const fileContent = readFileSync(filePath, 'utf-8');
    const firstIdx = fileContent.indexOf('RESOLVED');
    const processIdx = fileContent.indexOf('function process');
    const validateIdx = fileContent.indexOf('function validate');
    expect(firstIdx).toBeGreaterThan(processIdx);
    expect(firstIdx).toBeLessThan(validateIdx);
  });

  it('uses a more specific old_string to target a later occurrence', async () => {
    const filePath = join(tempDir, 'specific-target.ts');
    const content = [
      'export const VERSION = "1.0.0";',
      'export function getVersion() {',
      '  return VERSION;',
      '}',
    ].join('\n');
    writeFileSync(filePath, content, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(tempDir));

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
});

describe('ast_edit ambiguous match: preview consistency with apply', () => {
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

  it('preview shows the same first-occurrence replacement that apply produces', async () => {
    const filePath = join(tempDir, 'preview-consistency.ts');
    const content = 'const X = dup;\nconst Y = dup;\n';
    writeFileSync(filePath, content, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(tempDir));

    const previewResult = await executePreview(tool, {
      file_path: filePath,
      old_string: 'dup',
      new_string: 'unique',
    });

    expect(previewResult.error).toBeUndefined();
    const previewDisplay = previewResult.returnDisplay as {
      newContent: string;
    };
    expect(previewDisplay.newContent).toContain('unique');
    const previewLines = previewDisplay.newContent.split('\n');
    expect(previewLines[0]).toContain('unique');
    expect(previewLines[1]).toContain('dup');

    const applyFilePath = join(tempDir, 'apply-consistency.ts');
    writeFileSync(applyFilePath, content, 'utf-8');
    const applyTool = new ASTEditTool(createFakeToolHost(tempDir));
    const applyResult = await executeApply(applyTool, {
      file_path: applyFilePath,
      old_string: 'dup',
      new_string: 'unique',
    });

    expect(applyResult.error).toBeUndefined();
    const appliedContent = readFileSync(applyFilePath, 'utf-8');
    expect(appliedContent).toBe(previewDisplay.newContent);
  });
});
