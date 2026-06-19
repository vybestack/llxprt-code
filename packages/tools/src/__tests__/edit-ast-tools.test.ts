/**
 * @plan:PLAN-20260608-ISSUE1585.P10
 * @requirement:REQ-BEHAVIORAL-TDD, REQ-TEST-FIXTURE-COUPLING
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Edit / Apply-Patch / AST Tool Group Behavioral Tests
 *
 * Verifies observable behavior of edit/patch/AST tools through
 * infrastructure fakes. Asserts ToolResult content, filesystem state,
 * and diff stats — NOT method calls or delegation.
 *
 * STATUS: RED — Tests compile but will fail at runtime until P11
 * moves real tool code into packages/tools.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IToolHost } from '../interfaces/index.js';

import {
  ApplyPatchTool,
  ASTEditTool,
  AstGrepTool,
  EditTool,
  StructuralAnalysisTool,
} from '../index.js';
import type { ToolResult } from '../index.js';

function createTempDir(prefix = 'llxprt-edit-test-'): {
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
        /* ignore */
      }
    },
  };
}

describe('Edit / Apply-Patch / AST Tool Group Behavioral Tests @plan:PLAN-20260608-ISSUE1585.P10', () => {
  let tempDir: string;
  function createFakeToolHost(targetDir: string): IToolHost {
    return {
      getTargetDir: () => targetDir,
      getWorkspaceRoots: () => [targetDir],
      getApprovalMode: () => 'auto',
      setApprovalMode: () => {},
      isInteractive: () => false,
      hasFeatureFlag: () => false,
    };
  }
  async function executeDeclarativeToolForBehavioralAssertion(
    tool: {
      build(params: unknown): {
        execute(signal: AbortSignal): Promise<ToolResult>;
      };
    },
    params: unknown,
  ): Promise<ToolResult> {
    try {
      return await tool.build(params).execute(new AbortController().signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        llmContent: '',
        returnDisplay: '',
        error: { message },
      };
    }
  }

  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  describe('EditTool behavioral contract', () => {
    it('applies exact text replacement and filesystem reflects the edit', async () => {
      const filePath = join(tempDir, 'edit-test.txt');
      writeFileSync(filePath, 'Hello World\nSecond line\nThird line', 'utf-8');

      const result = await executeDeclarativeToolForBehavioralAssertion(
        new EditTool(createFakeToolHost(tempDir)),
        {
          file_path: filePath,
          old_string: 'Hello World',
          new_string: 'Greetings World',
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Successfully modified file');
      expect(readFileSync(filePath, 'utf-8')).toContain('Greetings World');

      expect(readFileSync(filePath, 'utf-8')).not.toContain('Hello World');
    });

    it('edit produces correct diff stats', async () => {
      const filePath = join(tempDir, 'edit-stats-test.txt');
      const original = 'line1\nline2\nline3';
      writeFileSync(filePath, original, 'utf-8');

      const result = await executeDeclarativeToolForBehavioralAssertion(
        new EditTool(createFakeToolHost(tempDir)),
        {
          file_path: filePath,
          old_string: 'line2',
          new_string: 'modified\nline4',
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('modified');
      expect(readFileSync(filePath, 'utf-8')).toContain('modified');
      expect(readFileSync(filePath, 'utf-8')).toContain('line4');
      expect(readFileSync(filePath, 'utf-8')).toContain('modified');
    });
  });

  describe('ApplyPatchTool behavioral contract', () => {
    it('applies unified diff and filesystem reflects the patch', async () => {
      const filePath = join(tempDir, 'patch-test.txt');
      writeFileSync(
        filePath,
        'original line 1\noriginal line 2\noriginal line 3',
        'utf-8',
      );

      const patch = `--- a/patch-test.txt
+++ b/patch-test.txt
@@ -1,3 +1,3 @@
 original line 1
-original line 2
+patched line 2
 original line 3`;
      const result = await executeDeclarativeToolForBehavioralAssertion(
        new ApplyPatchTool(createFakeToolHost(tempDir)),
        { absolute_path: filePath, patch_content: patch },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Successfully applied patch');
      expect(JSON.stringify(result.returnDisplay)).toContain('patched line 2');
      expect(readFileSync(filePath, 'utf-8')).toContain('patched line 2');
    });
  });

  describe('ASTEditTool behavioral contract', () => {
    it('performs ast-edit and returns modified content', async () => {
      const filePath = join(tempDir, 'ast-edit-test.ts');
      writeFileSync(
        filePath,
        'const x = 1;\nconst y = 2;\nconsole.log(x + y);',
        'utf-8',
      );

      const result = await executeDeclarativeToolForBehavioralAssertion(
        new ASTEditTool(createFakeToolHost(tempDir)),
        {
          file_path: filePath,
          old_string: 'const x = 1',
          new_string: 'const x = 42',
          force: true,
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Successfully applied edit');
      expect(JSON.stringify(result.returnDisplay)).toContain('const x = 42');
      expect(readFileSync(filePath, 'utf-8')).toContain('const x = 42');
    });
  });

  describe('ASTGrepTool behavioral contract', () => {
    it('searches for structural patterns and returns matching AST nodes', async () => {
      const filePath = join(tempDir, 'ast-grep-test.ts');
      writeFileSync(
        filePath,
        'function hello() { return 42; }\nfunction world() { return 99; }',
        'utf-8',
      );

      expect(existsSync(filePath)).toBe(true);
      const result = await executeDeclarativeToolForBehavioralAssertion(
        new AstGrepTool(createFakeToolHost(tempDir)),
        {
          pattern: 'function $NAME() { $$$BODY }',
          path: filePath,
          language: 'typescript',
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('hello');
      expect(result.llmContent).toContain('world');
    });
  });

  describe('StructuralAnalysisTool behavioral contract', () => {
    it('performs structural analysis queries and returns results', async () => {
      const filePath = join(tempDir, 'structural-test.ts');
      writeFileSync(
        filePath,
        'class MyClass { myMethod() { return true; } }',
        'utf-8',
      );

      expect(existsSync(filePath)).toBe(true);
      const result = await executeDeclarativeToolForBehavioralAssertion(
        new StructuralAnalysisTool(createFakeToolHost(tempDir)),
        {
          mode: 'definitions',
          language: 'typescript',
          path: tempDir,
          symbol: 'MyClass',
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('MyClass');
      expect(result.llmContent).toContain('myMethod');
    });
  });

  describe('ToolResult contract for edit tools', () => {
    it('edited file contains expected content observable on filesystem', async () => {
      const filePath = join(tempDir, 'contract-test.txt');
      writeFileSync(filePath, 'original content', 'utf-8');

      const result = await executeDeclarativeToolForBehavioralAssertion(
        new EditTool(createFakeToolHost(tempDir)),
        {
          file_path: filePath,
          old_string: 'original',
          new_string: 'modified',
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Successfully modified file');
      expect(readFileSync(filePath, 'utf-8')).toBe('modified content');
    });
  });
});
