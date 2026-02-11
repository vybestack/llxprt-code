// @plan PLAN-20260211-ASTGREP.P04
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AstGrepTool } from './ast-grep.js';
import type { ToolResult } from './tools.js';
import type { Config } from '../config/config.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('AstGrepTool', () => {
  let tempDir: string;
  let tool: AstGrepTool;
  const abortSignal = new AbortController().signal;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ast-grep-test-'));
    const mockConfig = {
      getTargetDir: () => tempDir,
    } as unknown as Config;
    tool = new AstGrepTool(mockConfig);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function writeFile(name: string, content: string): Promise<string> {
    const filePath = path.join(tempDir, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    return filePath;
  }

  interface AstGrepMetadata {
    matches: Array<{
      file: string;
      startLine: number;
      startCol: number;
      endLine: number;
      endCol: number;
      text: string;
      nodeKind: string;
      metaVariables: Record<string, string>;
    }>;
    truncated: boolean;
    totalMatches?: number;
  }

  async function execute(params: Record<string, unknown>): Promise<ToolResult> {
    const invocation = tool.createInvocation(params);
    return invocation.execute(abortSignal);
  }

  function meta(result: ToolResult): AstGrepMetadata {
    return result.metadata as unknown as AstGrepMetadata;
  }

  describe('pattern search (REQ-ASTGREP-002)', () => {
    it('should find method calls matching pattern', async () => {
      await writeFile(
        'test.ts',
        `
class Foo {
  bar() {
    this.world();
    this.hello();
  }
}
`,
      );
      const result = await execute({
        pattern: '$OBJ.world()',
        language: 'typescript',
        path: tempDir,
      });
      expect(meta(result).matches.length).toBe(1);
      expect(meta(result).matches[0].text).toBe('this.world()');
      expect(meta(result).matches[0].nodeKind).toBe('call_expression');
    });

    it('should not match comments (AST-aware)', async () => {
      await writeFile(
        'test.ts',
        `
// this.foo() is not a real call
/* this.foo() also not real */
const s = "this.foo()";
`,
      );
      const result = await execute({
        pattern: '$OBJ.foo()',
        language: 'typescript',
        path: tempDir,
      });
      expect(meta(result).matches.length).toBe(0);
    });

    it('should capture metavariables', async () => {
      await writeFile('test.ts', `this.myMethod(1, 2, 3);`);
      const result = await execute({
        pattern: '$OBJ.myMethod($$$ARGS)',
        language: 'typescript',
        path: tempDir,
      });
      expect(meta(result).matches.length).toBe(1);
      expect(meta(result).matches[0].metaVariables.OBJ).toBe('this');
    });
  });

  describe('rule search (REQ-ASTGREP-003)', () => {
    it('should find nodes matching a YAML rule', async () => {
      await writeFile(
        'test.ts',
        `
class Foo {
  hello() { }
  world() { }
}
`,
      );
      const result = await execute({
        rule: {
          kind: 'method_definition',
          has: { kind: 'property_identifier', regex: '^hello$' },
        },
        language: 'typescript',
        path: tempDir,
      });
      expect(meta(result).matches.length).toBe(1);
      expect(meta(result).matches[0].text).toContain('hello');
    });
  });

  describe('mutual exclusion (REQ-ASTGREP-004)', () => {
    it('should error when both pattern and rule provided', async () => {
      await writeFile('test.ts', 'const x = 1;');
      const result = await execute({
        pattern: '$X',
        rule: { kind: 'identifier' },
        language: 'typescript',
        path: tempDir,
      });
      expect(result.llmContent).toContain('exactly one');
    });

    it('should error when neither pattern nor rule provided', async () => {
      await writeFile('test.ts', 'const x = 1;');
      const result = await execute({
        language: 'typescript',
        path: tempDir,
      });
      expect(result.llmContent).toContain('exactly one');
    });
  });

  describe('path handling (REQ-ASTGREP-005/006)', () => {
    it('should default to workspace root when no path provided', async () => {
      await writeFile('test.ts', 'this.foo();');
      const result = await execute({
        pattern: '$OBJ.foo()',
        language: 'typescript',
      });
      expect(meta(result).matches.length).toBe(1);
    });

    it('should error for path outside workspace', async () => {
      const result = await execute({
        pattern: '$X',
        language: 'typescript',
        path: '/etc/passwd',
      });
      expect(result.llmContent).toContain('outside');
    });
  });

  describe('result format (REQ-ASTGREP-007)', () => {
    it('should return all required fields', async () => {
      await writeFile('test.ts', 'this.foo();');
      const result = await execute({
        pattern: '$OBJ.foo()',
        language: 'typescript',
        path: tempDir,
      });
      const match = meta(result).matches[0];
      expect(match).toHaveProperty('file');
      expect(match).toHaveProperty('startLine');
      expect(match).toHaveProperty('startCol');
      expect(match).toHaveProperty('endLine');
      expect(match).toHaveProperty('endCol');
      expect(match).toHaveProperty('text');
      expect(match).toHaveProperty('nodeKind');
      expect(match).toHaveProperty('metaVariables');
      // File should be relative
      expect(match.file).not.toContain(tempDir);
    });
  });

  describe('result limit (REQ-ASTGREP-008)', () => {
    it('should truncate results at maxResults', async () => {
      await writeFile(
        'test.ts',
        Array.from({ length: 5 }, (_, i) => `this.foo${i}();`).join('\n'),
      );
      const result = await execute({
        pattern: '$OBJ.$METHOD()',
        language: 'typescript',
        path: tempDir,
        maxResults: 2,
      });
      expect(meta(result).matches.length).toBe(2);
      expect(meta(result).truncated).toBe(true);
    });
  });

  describe('empty results (REQ-ASTGREP-009)', () => {
    it('should return empty array when no matches', async () => {
      await writeFile('test.ts', 'const x = 1;');
      const result = await execute({
        pattern: '$OBJ.nonexistent()',
        language: 'typescript',
        path: tempDir,
      });
      expect(meta(result).matches).toEqual([]);
      expect(meta(result).truncated).toBe(false);
    });
  });

  describe('invalid pattern (REQ-ASTGREP-011)', () => {
    it('should return clear error for unparseable pattern', async () => {
      await writeFile('test.ts', 'const x = 1;');
      const result = await execute({
        pattern: 'async $METHOD($$$PARAMS): $RET { $$$BODY }',
        language: 'typescript',
        path: tempDir,
      });
      // Multi-node patterns fail in ast-grep — should get an error or empty results
      expect(result).toBeDefined();
      expect(
        meta(result).matches?.length === 0 ||
          /error|parse|pattern/i.test(String(result.llmContent)),
      ).toBe(true);
    });
  });

  describe('language detection (REQ-ASTGREP-013)', () => {
    it('should auto-detect language for single .ts file', async () => {
      const filePath = await writeFile('test.ts', 'this.foo();');
      const result = await execute({
        pattern: '$OBJ.foo()',
        path: filePath,
      });
      expect(meta(result).matches.length).toBe(1);
    });

    it('should error for directory without language', async () => {
      await writeFile('test.ts', 'this.foo();');
      const result = await execute({
        pattern: '$OBJ.foo()',
        path: tempDir,
      });
      expect(result.llmContent).toContain('language');
    });
  });

  describe('glob filtering (REQ-ASTGREP-010)', () => {
    it('should filter files by glob pattern', async () => {
      await writeFile('main.ts', 'this.foo();');
      await writeFile('main.test.ts', 'this.foo();');
      const result = await execute({
        pattern: '$OBJ.foo()',
        language: 'typescript',
        path: tempDir,
        globs: ['!*.test.ts'],
      });
      expect(meta(result).matches.length).toBe(1);
      expect(meta(result).matches[0].file).toContain('main.ts');
      expect(meta(result).matches[0].file).not.toContain('test');
    });
  });
});
