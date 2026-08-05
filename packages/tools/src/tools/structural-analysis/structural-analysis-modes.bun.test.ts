/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for structural_analysis modes callees, definitions,
 * dependencies, and the tool description (issue #3038, AC1–AC6).
 *
 * Drives the REAL StructuralAnalysisTool end-to-end against real .ts files
 * written into a temp directory. The AST engine (@ast-grep/napi) is not
 * mocked — these tests exercise the actual tree-sitter grammar paths.
 *
 * @plan issue3038
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IToolHost } from '../../interfaces/index.js';
import { StructuralAnalysisTool } from '../structural-analysis.js';
import { createFakeToolHost } from '../ast-edit/__tests__/test-helpers.js';
import type { ToolResult } from '../tools.js';

interface ImportRecord {
  file: string;
  line: number;
  source: string;
  kind: string;
}

/**
 * Parses a ToolResult's llmContent and returns the `results` field as
 * unknown, failing loudly if the payload shape is wrong.
 */
function extractResults(result: ToolResult): unknown {
  const parsed: unknown = JSON.parse(result.llmContent);
  if (typeof parsed !== 'object' || parsed === null || !('results' in parsed)) {
    throw new Error(
      `Unexpected payload: missing results — ${result.llmContent}`,
    );
  }
  return parsed.results;
}

/** Narrows to an array of { text: string }, throwing on wrong shape. */
function asTextResults(value: unknown): Array<{ text: string }> {
  if (!Array.isArray(value)) {
    throw new Error('Expected array');
  }
  return value.map((item): { text: string } => {
    if (item === null || typeof item !== 'object') {
      throw new Error(`Expected { text: string }, got ${JSON.stringify(item)}`);
    }
    if (!('text' in item) || typeof item.text !== 'string') {
      throw new Error(`Expected text: string, got ${JSON.stringify(item)}`);
    }
    return { text: item.text };
  });
}

/** Narrows to an array of { kind: string; line: number }, throwing on wrong shape. */
function asKindResults(value: unknown): Array<{ kind: string; line: number }> {
  if (!Array.isArray(value)) {
    throw new Error('Expected array');
  }
  return value.map((item): { kind: string; line: number } => {
    if (item === null || typeof item !== 'object') {
      throw new Error(`Expected object, got ${JSON.stringify(item)}`);
    }
    if (!('kind' in item) || typeof item.kind !== 'string') {
      throw new Error(`Expected kind: string, got ${JSON.stringify(item)}`);
    }
    if (!('line' in item) || typeof item.line !== 'number') {
      throw new Error(`Expected line: number, got ${JSON.stringify(item)}`);
    }
    return { kind: item.kind, line: item.line };
  });
}

/** Narrows to an array of { method: string }, throwing on wrong shape. */
function asMethodResults(value: unknown): Array<{ method: string }> {
  if (!Array.isArray(value)) {
    throw new Error('Expected array');
  }
  return value.map((item): { method: string } => {
    if (item === null || typeof item !== 'object') {
      throw new Error(
        `Expected { method: string }, got ${JSON.stringify(item)}`,
      );
    }
    if (!('method' in item) || typeof item.method !== 'string') {
      throw new Error(`Expected method: string, got ${JSON.stringify(item)}`);
    }
    return { method: item.method };
  });
}

/** Narrows to { imports: ImportRecord[] }, throwing on wrong shape. */
function asImportsWrapper(value: unknown): { imports: ImportRecord[] } {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected imports wrapper object');
  }
  if (!('imports' in value)) {
    throw new Error('Expected { imports: [...] }');
  }
  const raw: unknown = value.imports;
  if (!Array.isArray(raw)) {
    throw new Error('Expected imports to be an array');
  }
  const imports: ImportRecord[] = raw.map((item): ImportRecord => {
    if (item === null || typeof item !== 'object') {
      throw new Error(`Expected import record, got ${JSON.stringify(item)}`);
    }
    if (!('file' in item) || typeof item.file !== 'string') {
      throw new Error('Expected file: string');
    }
    if (!('line' in item) || typeof item.line !== 'number') {
      throw new Error('Expected line: number');
    }
    if (!('source' in item) || typeof item.source !== 'string') {
      throw new Error('Expected source: string');
    }
    if (!('kind' in item) || typeof item.kind !== 'string') {
      throw new Error('Expected kind: string');
    }
    return {
      file: item.file,
      line: item.line,
      source: item.source,
      kind: item.kind,
    };
  });
  return { imports };
}

async function runTool(
  host: IToolHost,
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = new StructuralAnalysisTool(host);
  return tool.build(params).execute(new AbortController().signal);
}

describe('structural_analysis modes (issue #3038)', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-sa-3038-'));
  });

  afterAll(() => {
    // Only clean up if the temp dir was actually created: if mkdtempSync
    // threw in beforeAll, tempDir stays '' and rmSync on an empty path would
    // mask the real filesystem error.
    if (tempDir !== '') {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('AC1 — callees resolves every function-like container', () => {
    beforeAll(() => {
      writeFileSync(
        join(tempDir, 'callees-fixture.ts'),
        `function leafA(): void {}
function leafB(): void {}

function standaloneFunc(): void {
  leafA();
  leafB();
}

const arrowFn = (): void => {
  leafA();
};

function* generatorFunc(): void {
  leafA();
}

const fnExpr = function (): void {
  leafA();
};

const genExpr = function* (): Generator<number> {
  leafB();
};

const namedFnExpr = function inner(): void {
  leafA();
};

const fnExprWithNested = function (): void {
  leafA();
  function innerInFnExpr(): void {
    leafB();
  }
};

class Ship {
  ship(): void {
    leafA();
  }
}
`,
        'utf-8',
      );
    });

    const baseParams = (symbol: string): Record<string, unknown> => ({
      mode: 'callees',
      language: 'typescript',
      path: join(tempDir, 'callees-fixture.ts'),
      symbol,
    });

    it('finds both callees of a standalone function declaration', async () => {
      const results = asTextResults(
        extractResults(
          await runTool(
            createFakeToolHost(tempDir),
            baseParams('standaloneFunc'),
          ),
        ),
      );
      expect(results.length).toBe(2);
      const texts = results.map((r) => r.text);
      expect(texts).toContain('leafA()');
      expect(texts).toContain('leafB()');
    });

    it('finds the callee of an arrow function bound to a const', async () => {
      const results = asTextResults(
        extractResults(
          await runTool(createFakeToolHost(tempDir), baseParams('arrowFn')),
        ),
      );
      expect(results.length).toBe(1);
      expect(results[0].text).toBe('leafA()');
    });

    it('finds the callee of a generator function', async () => {
      const results = asTextResults(
        extractResults(
          await runTool(
            createFakeToolHost(tempDir),
            baseParams('generatorFunc'),
          ),
        ),
      );
      expect(results.length).toBe(1);
      expect(results[0].text).toBe('leafA()');
    });

    it('finds the callee of a class method (no regression)', async () => {
      const results = asTextResults(
        extractResults(
          await runTool(createFakeToolHost(tempDir), baseParams('ship')),
        ),
      );
      expect(results.length).toBe(1);
      expect(results[0].text).toBe('leafA()');
    });

    it('callers/callees directionality agrees for the same edge', async () => {
      const host = createFakeToolHost(tempDir);
      const callersNames = asMethodResults(
        extractResults(
          await runTool(host, {
            mode: 'callers',
            language: 'typescript',
            path: join(tempDir, 'callees-fixture.ts'),
            symbol: 'leafA',
          }),
        ),
      ).map((r) => r.method);
      expect(callersNames).toContain('standaloneFunc');

      const calleesResults = asTextResults(
        extractResults(await runTool(host, baseParams('standaloneFunc'))),
      );
      expect(calleesResults.some((r) => r.text === 'leafA()')).toBe(true);
    });

    it('attributes a call inside a generator to the generator scope (FIX-3)', async () => {
      const host = createFakeToolHost(tempDir);
      const callersNames = asMethodResults(
        extractResults(
          await runTool(host, {
            mode: 'callers',
            language: 'typescript',
            path: join(tempDir, 'callees-fixture.ts'),
            symbol: 'leafA',
          }),
        ),
      ).map((r) => r.method);
      expect(callersNames).toContain('generatorFunc');
    });

    it('finds the callee of a const-bound plain function expression', async () => {
      const results = asTextResults(
        extractResults(
          await runTool(createFakeToolHost(tempDir), baseParams('fnExpr')),
        ),
      );
      expect(results.length).toBe(1);
      expect(results[0].text).toBe('leafA()');
    });

    it('finds the callee of a const-bound generator function expression', async () => {
      const results = asTextResults(
        extractResults(
          await runTool(createFakeToolHost(tempDir), baseParams('genExpr')),
        ),
      );
      expect(results.length).toBe(1);
      expect(results[0].text).toBe('leafB()');
    });

    it('finds the callee of a const-bound named function expression by its const name', async () => {
      const results = asTextResults(
        extractResults(
          await runTool(createFakeToolHost(tempDir), baseParams('namedFnExpr')),
        ),
      );
      expect(results.length).toBe(1);
      expect(results[0].text).toBe('leafA()');
    });

    it('does not attribute a nested-function call as a callee of a function expression', async () => {
      const results = asTextResults(
        extractResults(
          await runTool(
            createFakeToolHost(tempDir),
            baseParams('fnExprWithNested'),
          ),
        ),
      );
      // fnExprWithNested directly calls leafA only; the nested
      // innerInFnExpr's call to leafB must NOT be counted as a callee.
      expect(results.length).toBe(1);
      expect(results[0].text).toBe('leafA()');
    });

    it('attributes a call inside a variable-bound function expression to its binding (callers)', async () => {
      const host = createFakeToolHost(tempDir);
      const callersNames = asMethodResults(
        extractResults(
          await runTool(host, {
            mode: 'callers',
            language: 'typescript',
            path: join(tempDir, 'callees-fixture.ts'),
            symbol: 'leafB',
          }),
        ),
      ).map((r) => r.method);
      expect(callersNames).toContain('genExpr');
    });
  });

  describe('FIX-3 — callees does not attribute nested-function calls', () => {
    let nestedFilePath: string;

    beforeAll(() => {
      nestedFilePath = join(tempDir, 'nested-callees-fixture.ts');
      writeFileSync(
        nestedFilePath,
        `function directLeaf(): void {}
function nestedLeaf(): void {}

function outerWithNested(): void {
  directLeaf();
  function innerNested(): void {
    nestedLeaf();
  }
}

const outerArrow = (): void => {
  directLeaf();
  const innerArrow = (): void => {
    nestedLeaf();
  };
};
`,
        'utf-8',
      );
    });

    const baseParams = (symbol: string): Record<string, unknown> => ({
      mode: 'callees',
      language: 'typescript',
      path: nestedFilePath,
      symbol,
    });

    it('does not report a nested function call as a callee of the outer function', async () => {
      const results = asTextResults(
        extractResults(
          await runTool(
            createFakeToolHost(tempDir),
            baseParams('outerWithNested'),
          ),
        ),
      );
      // outerWithNested directly calls directLeaf only; innerNested's call to
      // nestedLeaf must NOT be counted as a callee of the outer function.
      expect(results.length).toBe(1);
      expect(results[0].text).toBe('directLeaf()');
    });

    it('does not report a nested arrow call as a callee of the outer arrow', async () => {
      const results = asTextResults(
        extractResults(
          await runTool(createFakeToolHost(tempDir), baseParams('outerArrow')),
        ),
      );
      expect(results.length).toBe(1);
      expect(results[0].text).toBe('directLeaf()');
    });

    it('still reports the outer function direct calls and resolves nested callees independently', async () => {
      const outerResults = asTextResults(
        extractResults(
          await runTool(
            createFakeToolHost(tempDir),
            baseParams('outerWithNested'),
          ),
        ),
      );
      expect(outerResults.some((r) => r.text === 'directLeaf()')).toBe(true);
      expect(outerResults.some((r) => r.text === 'nestedLeaf()')).toBe(false);

      const innerResults = asTextResults(
        extractResults(
          await runTool(createFakeToolHost(tempDir), baseParams('innerNested')),
        ),
      );
      expect(innerResults.length).toBe(1);
      expect(innerResults[0].text).toBe('nestedLeaf()');
    });
  });

  describe('AC2 — definitions finds return-typed declarations', () => {
    let filePath: string;

    beforeAll(() => {
      filePath = join(tempDir, 'definitions-fixture.ts');
      writeFileSync(
        filePath,
        `export function withReturnType(x: number): number {
  return x;
}

function withoutReturnType(x: number) {
  return x;
}

class SomeClass {
  methodWithType(): void {
    return;
  }
}

interface SomeInterface {
  foo: string;
}

type SomeType = string;
`,
        'utf-8',
      );
    });

    const baseParams = (symbol: string): Record<string, unknown> => ({
      mode: 'definitions',
      language: 'typescript',
      path: filePath,
      symbol,
    });

    it('finds a function declaration that carries a return type', async () => {
      const results = asKindResults(
        extractResults(
          await runTool(
            createFakeToolHost(tempDir),
            baseParams('withReturnType'),
          ),
        ),
      );
      expect(results.length).toBe(1);
      expect(results[0].kind).toBe('function');
      expect(results[0].line).toBe(1);
    });

    it('finds a function declaration without a return type (no regression)', async () => {
      const results = asKindResults(
        extractResults(
          await runTool(
            createFakeToolHost(tempDir),
            baseParams('withoutReturnType'),
          ),
        ),
      );
      expect(results.length).toBe(1);
      expect(results[0].kind).toBe('function');
    });

    it('finds a class method with a return type', async () => {
      const results = asKindResults(
        extractResults(
          await runTool(
            createFakeToolHost(tempDir),
            baseParams('methodWithType'),
          ),
        ),
      );
      expect(results.length).toBe(1);
      expect(results[0].kind).toBe('method');
      expect(results[0].line).toBe(10);
    });

    it('finds class, interface, and type alias declarations with correct kind (no regression)', async () => {
      const host = createFakeToolHost(tempDir);

      const classResults = asKindResults(
        extractResults(await runTool(host, baseParams('SomeClass'))),
      );
      expect(classResults.length).toBe(1);
      expect(classResults[0].kind).toBe('class');

      const ifaceResults = asKindResults(
        extractResults(await runTool(host, baseParams('SomeInterface'))),
      );
      expect(ifaceResults.length).toBe(1);
      expect(ifaceResults[0].kind).toBe('interface');

      const typeResults = asKindResults(
        extractResults(await runTool(host, baseParams('SomeType'))),
      );
      expect(typeResults.length).toBe(1);
      expect(typeResults[0].kind).toBe('type');
    });
  });

  describe('AC3 — dependencies requires an explicit target', () => {
    beforeAll(() => {
      writeFileSync(
        join(tempDir, 'dep-fixture.ts'),
        `import { something } from './mod.js';
`,
        'utf-8',
      );
    });

    it('rejects dependencies with neither target nor path', async () => {
      const result = await runTool(createFakeToolHost(tempDir), {
        mode: 'dependencies',
        language: 'typescript',
      });
      expect(result.llmContent).toBe(
        'Error: `target` (or `path`) parameter is required for "dependencies" mode.',
      );
      expect(result.llmContent).not.toContain('"imports"');
    });

    it('succeeds when target is supplied', async () => {
      const imports = asImportsWrapper(
        extractResults(
          await runTool(createFakeToolHost(tempDir), {
            mode: 'dependencies',
            language: 'typescript',
            target: join(tempDir, 'dep-fixture.ts'),
          }),
        ),
      ).imports;
      const modImports = imports.filter((i) => i.source === './mod.js');
      expect(modImports).toHaveLength(1);
      expect(modImports[0].kind).toBe('named');
    });

    it('succeeds when path is supplied (alias for the search root)', async () => {
      const imports = asImportsWrapper(
        extractResults(
          await runTool(createFakeToolHost(tempDir), {
            mode: 'dependencies',
            language: 'typescript',
            path: join(tempDir, 'dep-fixture.ts'),
          }),
        ),
      ).imports;
      const modImports = imports.filter((i) => i.source === './mod.js');
      expect(modImports).toHaveLength(1);
      expect(modImports[0].kind).toBe('named');
    });
  });

  describe('AC4/AC5 — dependencies classifies every import binding', () => {
    let importFilePath: string;

    beforeAll(() => {
      importFilePath = join(tempDir, 'imports-fixture.ts');
      writeFileSync(
        importFilePath,
        `import type { A, B } from './types.js';
import { c } from './c.js';
import def from './def.js';
import def2, { e } from './e.js';
import * as ns from './ns.js';
import './side.js';
`,
        'utf-8',
      );
    });

    async function collectImports(): Promise<ImportRecord[]> {
      const results = extractResults(
        await runTool(createFakeToolHost(tempDir), {
          mode: 'dependencies',
          language: 'typescript',
          target: importFilePath,
        }),
      );
      return asImportsWrapper(results).imports;
    }

    it('classifies type-only imports', async () => {
      const imports = await collectImports();
      const typeImports = imports.filter((i) => i.kind === 'type');
      expect(typeImports.length).toBe(1);
      expect(typeImports[0].source).toBe('./types.js');
    });

    it('classifies named imports without a bogus default duplicate', async () => {
      const imports = await collectImports();
      const cImports = imports.filter((i) => i.source === './c.js');
      expect(cImports.length).toBe(1);
      expect(cImports[0].kind).toBe('named');
      const cDefaults = imports.filter(
        (i) => i.source === './c.js' && i.kind === 'default',
      );
      expect(cDefaults.length).toBe(0);
    });

    it('classifies default imports', async () => {
      const imports = await collectImports();
      const defImports = imports.filter((i) => i.source === './def.js');
      expect(defImports.length).toBe(1);
      expect(defImports[0].kind).toBe('default');
    });

    it('emits both default and named for a mixed import', async () => {
      const imports = await collectImports();
      const eImports = imports.filter((i) => i.source === './e.js');
      expect(eImports.length).toBe(2);
      const kinds = eImports.map((i) => i.kind).sort();
      expect(kinds).toEqual(['default', 'named']);
    });

    it('classifies namespace imports', async () => {
      const imports = await collectImports();
      const nsImports = imports.filter((i) => i.source === './ns.js');
      expect(nsImports.length).toBe(1);
      expect(nsImports[0].kind).toBe('namespace');
    });

    it('classifies side-effect imports', async () => {
      const imports = await collectImports();
      const sideImports = imports.filter((i) => i.source === './side.js');
      expect(sideImports.length).toBe(1);
      expect(sideImports[0].kind).toBe('side-effect');
    });

    it('strips surrounding quotes from every static import source', async () => {
      const imports = await collectImports();
      for (const imp of imports) {
        expect(imp.source.startsWith("'")).toBe(false);
        expect(imp.source.startsWith('"')).toBe(false);
        expect(imp.source.endsWith("'")).toBe(false);
        expect(imp.source.endsWith('"')).toBe(false);
      }
    });

    it('does not emit duplicate (file, line, source, kind) tuples', async () => {
      const imports = await collectImports();
      const keys = imports.map(
        (i) => `${i.file}:${i.line}:${i.source}:${i.kind}`,
      );
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('preserves colon-containing module specifiers through deduplication (FIX-5)', async () => {
      const colonFilePath = join(tempDir, 'colon-specifier-fixture.ts');
      writeFileSync(
        colonFilePath,
        `import protoThing from 'proto:thing';
import { named } from 'other:spec';
`,
        'utf-8',
      );
      const imports = asImportsWrapper(
        extractResults(
          await runTool(createFakeToolHost(tempDir), {
            mode: 'dependencies',
            language: 'typescript',
            target: colonFilePath,
          }),
        ),
      ).imports;
      const protoImports = imports.filter((i) => i.source === 'proto:thing');
      expect(protoImports.length).toBe(1);
      expect(protoImports[0].kind).toBe('default');
      const otherImports = imports.filter((i) => i.source === 'other:spec');
      expect(otherImports.length).toBe(1);
      expect(otherImports[0].kind).toBe('named');
    });
  });

  describe('AC6 — description documents the per-mode parameter matrix', () => {
    let description: string;

    beforeAll(() => {
      description = new StructuralAnalysisTool(createFakeToolHost(tempDir))
        .description;
    });

    it('states that the five symbol modes require symbol', () => {
      expect(description).toContain(
        'callers, callees, definitions, hierarchy, references: "symbol"',
      );
    });

    it('states that dependencies requires an explicit target and exports is optional', () => {
      expect(description).toContain('dependencies: "target" (or "path")');
      expect(description).toContain('exports: optional "target"');
    });

    it('includes one worked example per mode with its required parameter', () => {
      const symbolModes = [
        'callers',
        'callees',
        'definitions',
        'hierarchy',
        'references',
      ];
      const targetModes = ['dependencies', 'exports'];
      for (const mode of symbolModes) {
        const exampleLine = description
          .split('\n')
          .find((l) => l.includes(`"mode": "${mode}"`));
        if (exampleLine === undefined) {
          throw new Error(`No example found for mode ${mode}`);
        }
        expect(exampleLine).toContain('"symbol"');
      }
      for (const mode of targetModes) {
        const exampleLine = description
          .split('\n')
          .find((l) => l.includes(`"mode": "${mode}"`));
        if (exampleLine === undefined) {
          throw new Error(`No example found for mode ${mode}`);
        }
        expect(exampleLine).toContain('"target"');
      }
    });
  });
});
