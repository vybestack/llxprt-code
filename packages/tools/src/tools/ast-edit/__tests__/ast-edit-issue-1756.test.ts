/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression tests for issue #1756: ast_edit must not silently replace only
 * the first occurrence when old_string matches multiple locations.
 *
 * The exact reproduction from the issue is a TypeScript file where a fragment
 * like `active: true,` appears in two distinct syntactic contexts (a function
 * body and a const declaration). Both the apply and preview phases must reject
 * the edit with EDIT_EXPECTED_OCCURRENCE_MISMATCH and leave the file untouched.
 * Providing enough surrounding context to match exactly once must still succeed.
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

const TWO_CONTEXT_CONTENT = [
  'function getConfig() {',
  '  return {',
  '    active: true,',
  '    name: "function-config",',
  '  };',
  '}',
  'const defaultConfig = {',
  '  active: true,',
  '  name: "const-config",',
  '};',
].join('\n');

describe('ast_edit issue #1756: no silent first-occurrence replacement', () => {
  const ctx = useTempDir();

  it('apply rejects when the ambiguous fragment appears in two contexts', async () => {
    const filePath = join(ctx.tempDir, 'two-contexts.ts');
    writeFileSync(filePath, TWO_CONTEXT_CONTENT, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: 'active: true,',
      new_string: 'active: false,',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(
      ToolErrorType.EDIT_EXPECTED_OCCURRENCE_MISMATCH,
    );
    expect(String(result.llmContent)).toContain('2 times');
    expect(readFileSync(filePath, 'utf-8')).toBe(TWO_CONTEXT_CONTENT);
  });

  it('preview rejects the same ambiguous fragment so no diff is shown', async () => {
    const filePath = join(ctx.tempDir, 'two-contexts-preview.ts');
    writeFileSync(filePath, TWO_CONTEXT_CONTENT, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'active: true,',
      new_string: 'active: false,',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe(
      ToolErrorType.EDIT_EXPECTED_OCCURRENCE_MISMATCH,
    );
    expect(String(result.llmContent)).not.toContain('LLXPRT EDIT PREVIEW');
    expect(readFileSync(filePath, 'utf-8')).toBe(TWO_CONTEXT_CONTENT);
  });

  it('succeeds when the caller disambiguates by including surrounding context', async () => {
    const filePath = join(ctx.tempDir, 'disambiguated.ts');
    writeFileSync(filePath, TWO_CONTEXT_CONTENT, 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executeApply(tool, {
      file_path: filePath,
      old_string: '    active: true,\n    name: "function-config",',
      new_string: '    active: false,\n    name: "function-config",',
    });

    expect(result.error).toBeUndefined();
    // Assert the full expected content so a regression that replaces the WRONG
    // occurrence (or both) is caught: only the function-body fragment changed,
    // the const-declaration fragment is untouched.
    const expected = [
      'function getConfig() {',
      '  return {',
      '    active: false,',
      '    name: "function-config",',
      '  };',
      '}',
      'const defaultConfig = {',
      '  active: true,',
      '  name: "const-config",',
      '};',
    ].join('\n');
    expect(readFileSync(filePath, 'utf-8')).toBe(expected);
  });
});
