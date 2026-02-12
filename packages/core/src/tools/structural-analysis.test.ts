// @plan PLAN-20260211-ASTGREP.P06
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StructuralAnalysisTool } from './structural-analysis.js';
import type { ToolResult } from './tools.js';
import type { Config } from '../config/config.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

interface MetadataResult {
  results: Array<Record<string, unknown>> | Record<string, unknown>;
  truncated: boolean;
}

describe('StructuralAnalysisTool', () => {
  let tempDir: string;
  let tool: StructuralAnalysisTool;
  const abortSignal = new AbortController().signal;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'structural-analysis-test-'),
    );
    const mockConfig = {
      getTargetDir: () => tempDir,
    } as unknown as Config;
    tool = new StructuralAnalysisTool(mockConfig);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function writeFile(name: string, content: string): Promise<void> {
    const filePath = path.join(tempDir, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }

  async function execute(params: Record<string, unknown>): Promise<ToolResult> {
    const invocation = tool.createInvocation(params);
    return invocation.execute(abortSignal);
  }

  function meta(result: ToolResult): MetadataResult {
    return result.metadata as unknown as MetadataResult;
  }

  // ===== Common / Mode dispatch =====
  describe('mode dispatch (REQ-SA-002)', () => {
    it('should error on invalid mode', async () => {
      const result = await execute({
        mode: 'invalid',
        language: 'typescript',
      });
      expect(result.llmContent).toContain('Invalid mode');
      expect(result.llmContent).toContain('callers');
    });
  });

  describe('language parameter (REQ-SA-003)', () => {
    it('should error on missing language', async () => {
      const result = await execute({ mode: 'definitions', symbol: 'Foo' });
      expect(result.llmContent).toContain('language');
    });
  });

  describe('workspace boundary (REQ-SA-005)', () => {
    it('should error for path outside workspace', async () => {
      const result = await execute({
        mode: 'definitions',
        language: 'typescript',
        symbol: 'Foo',
        path: '/etc/passwd',
      });
      expect(result.llmContent).toContain('outside');
    });
  });

  // ===== Definitions (REQ-SA-DEFS-001) =====
  describe('definitions mode', () => {
    it('should find class definition by name', async () => {
      await writeFile('foo.ts', 'export class MyService { run() {} }');
      const result = await execute({
        mode: 'definitions',
        language: 'typescript',
        symbol: 'MyService',
        path: tempDir,
      });
      expect(meta(result).results.length).toBeGreaterThan(0);
      expect(meta(result).results[0].kind).toContain('class');
    });

    it('should find function definition by name', async () => {
      await writeFile(
        'util.ts',
        'function doStuff(x: number) { return x * 2; }',
      );
      const result = await execute({
        mode: 'definitions',
        language: 'typescript',
        symbol: 'doStuff',
        path: tempDir,
      });
      expect(meta(result).results.length).toBeGreaterThan(0);
    });

    it('should return empty for nonexistent symbol', async () => {
      await writeFile('foo.ts', 'const x = 1;');
      const result = await execute({
        mode: 'definitions',
        language: 'typescript',
        symbol: 'NonExistent',
        path: tempDir,
      });
      expect(meta(result).results).toEqual([]);
      expect(meta(result).truncated).toBe(false);
    });

    it('should find definitions across multiple files', async () => {
      await writeFile('a.ts', 'class Widget { }');
      await writeFile('b.ts', 'class Widget extends Base { }');
      const result = await execute({
        mode: 'definitions',
        language: 'typescript',
        symbol: 'Widget',
        path: tempDir,
      });
      expect(meta(result).results.length).toBe(2);
    });
  });

  // ===== Hierarchy (REQ-SA-HIER-001/002) =====
  describe('hierarchy mode', () => {
    it('should find parent class', async () => {
      await writeFile(
        'child.ts',
        'class ChildTool extends BaseTool { run() {} }',
      );
      const result = await execute({
        mode: 'hierarchy',
        language: 'typescript',
        symbol: 'ChildTool',
        path: tempDir,
      });
      expect(meta(result).results.extends).toContain('BaseTool');
    });

    it('should find interface implementation', async () => {
      await writeFile(
        'impl.ts',
        'class MyServer implements ContentGenerator { generate() {} }',
      );
      const result = await execute({
        mode: 'hierarchy',
        language: 'typescript',
        symbol: 'MyServer',
        path: tempDir,
      });
      expect(meta(result).results.implements).toContain('ContentGenerator');
    });

    it('should find subclasses', async () => {
      await writeFile('a.ts', 'class ToolA extends BaseTool { }');
      await writeFile('b.ts', 'class ToolB extends BaseTool { }');
      const result = await execute({
        mode: 'hierarchy',
        language: 'typescript',
        symbol: 'BaseTool',
        path: tempDir,
      });
      expect(meta(result).results.extendedBy.length).toBe(2);
      const names = meta(result).results.extendedBy.map(
        (e: Record<string, unknown>) => e.name,
      );
      expect(names).toContain('ToolA');
      expect(names).toContain('ToolB');
    });

    it('should find implementors', async () => {
      await writeFile(
        'impl.ts',
        'class Server implements IGenerator { gen() {} }',
      );
      const result = await execute({
        mode: 'hierarchy',
        language: 'typescript',
        symbol: 'IGenerator',
        path: tempDir,
      });
      expect(meta(result).results.implementedBy.length).toBe(1);
      expect(meta(result).results.implementedBy[0].name).toBe('Server');
    });
  });

  // ===== Callers (REQ-SA-CALLERS-001-006) =====
  // @plan PLAN-20260211-ASTGREP.P08
  describe('callers mode', () => {
    it('should find basic callers', async () => {
      await writeFile(
        'service.ts',
        `class Service {
  targetMethod() { return 1; }
  callerA() { this.targetMethod(); }
  callerB() { this.targetMethod(); }
  unrelated() { this.other(); }
}`,
      );
      const result = await execute({
        mode: 'callers',
        language: 'typescript',
        symbol: 'targetMethod',
        path: tempDir,
      });
      expect(meta(result).results.length).toBe(2);
      const methods = meta(result).results.map(
        (r: Record<string, unknown>) => r.method,
      );
      expect(methods).toContain('callerA');
      expect(methods).toContain('callerB');
    });

    it('should include via context', async () => {
      await writeFile(
        'service.ts',
        `class Service {
  target() { }
  caller() { const x = this.target(); }
}`,
      );
      const result = await execute({
        mode: 'callers',
        language: 'typescript',
        symbol: 'target',
        path: tempDir,
      });
      expect(meta(result).results.length).toBe(1);
      expect(meta(result).results[0].via).toContain('target');
    });

    it('should handle cycle detection', async () => {
      await writeFile(
        'cycle.ts',
        `class Svc {
  a() { this.b(); }
  b() { this.a(); }
}`,
      );
      const result = await execute({
        mode: 'callers',
        language: 'typescript',
        symbol: 'a',
        depth: 3,
        path: tempDir,
      });
      // Should not infinite loop — b calls a, but a is already visited
      expect(meta(result).results.length).toBeGreaterThan(0);
    });

    it('should respect maxNodes', async () => {
      await writeFile(
        'many.ts',
        `class Svc {
  target() {}
  a() { this.target(); }
  b() { this.target(); }
  c() { this.target(); }
  d() { this.target(); }
  e() { this.target(); }
}`,
      );
      const result = await execute({
        mode: 'callers',
        language: 'typescript',
        symbol: 'target',
        maxNodes: 2,
        path: tempDir,
      });
      expect(meta(result).results.length).toBeLessThanOrEqual(2);
      expect(meta(result).truncated).toBe(true);
    });
  });

  // ===== Callees (REQ-SA-CALLEES-001-003) =====
  // @plan PLAN-20260211-ASTGREP.P08
  describe('callees mode', () => {
    it('should find basic callees', async () => {
      await writeFile(
        'service.ts',
        `class Svc {
  myMethod() {
    this.foo();
    this.bar();
    console.log("hello");
  }
}`,
      );
      const result = await execute({
        mode: 'callees',
        language: 'typescript',
        symbol: 'myMethod',
        path: tempDir,
      });
      expect(meta(result).results.length).toBeGreaterThanOrEqual(3);
    });

    it('should deduplicate chained calls', async () => {
      await writeFile(
        'chain.ts',
        `class Svc {
  myMethod() {
    this.a().b().c();
  }
}`,
      );
      const result = await execute({
        mode: 'callees',
        language: 'typescript',
        symbol: 'myMethod',
        path: tempDir,
      });
      // Should have the outermost call this.a().b().c() but not this.a() or this.a().b() separately
      const texts = meta(result).results.map(
        (r: Record<string, unknown>) => r.text,
      );
      const chainCall = texts.find(
        (t: string) => t.includes('a()') && t.includes('c()'),
      );
      expect(chainCall).toBeDefined();
      // There should be exactly 1 call entry (the outermost chain)
      expect(meta(result).results.length).toBe(1);
    });
  });

  // ===== References (REQ-SA-REFS-001-003) =====
  // @plan PLAN-20260211-ASTGREP.P10
  describe('references mode', () => {
    it('should find categorized references', async () => {
      await writeFile(
        'usage.ts',
        `import { MyClass } from './myclass';
const obj = new MyClass();
const x: MyClass = obj;
class Child extends MyClass { }
obj.doSomething();
`,
      );
      const result = await execute({
        mode: 'references',
        language: 'typescript',
        symbol: 'MyClass',
        path: tempDir,
      });
      const { counts } = meta(result).results;
      expect(counts['Instantiations']).toBeGreaterThan(0);
      expect(counts['Imports']).toBeGreaterThan(0);
      expect(counts['Extends/Implements']).toBeGreaterThan(0);
    });

    it('should label heuristic category', async () => {
      await writeFile(
        'usage.ts',
        `const myClass = new MyClass();
myClass.foo();
`,
      );
      const result = await execute({
        mode: 'references',
        language: 'typescript',
        symbol: 'MyClass',
        path: tempDir,
      });
      expect(meta(result).results.categories).toHaveProperty(
        'Instance method calls (heuristic)',
      );
    });
  });

  // ===== Dependencies (REQ-SA-DEPS-001/002) =====
  // @plan PLAN-20260211-ASTGREP.P10
  describe('dependencies mode', () => {
    it('should find imports', async () => {
      await writeFile(
        'main.ts',
        `import { foo } from './foo';
import bar from './bar';
import './side-effect';
`,
      );
      const result = await execute({
        mode: 'dependencies',
        language: 'typescript',
        path: tempDir,
      });
      expect(meta(result).results.imports.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ===== Exports (REQ-SA-EXPORTS-001) =====
  // @plan PLAN-20260211-ASTGREP.P10
  describe('exports mode', () => {
    it('should find all export types', async () => {
      await writeFile(
        'mod.ts',
        `export class MyClass { }
export function doStuff() { }
export const VALUE = 42;
export interface IFace { }
export type MyType = string;
export default class DefaultClass { }
`,
      );
      const result = await execute({
        mode: 'exports',
        language: 'typescript',
        path: tempDir,
      });
      expect(meta(result).results.length).toBeGreaterThanOrEqual(5);
      const kinds = meta(result).results.map(
        (e: Record<string, unknown>) => e.kind,
      );
      expect(kinds).toContain('class');
      expect(kinds).toContain('function');
      expect(kinds).toContain('const');
    });
  });
});
