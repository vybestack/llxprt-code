/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ast_edit C language support (issue #1761).
 *
 * Covers four acceptance areas:
 * 1. AST validation: valid C passes, broken C fails with line/column
 * 2. C-specific constructs parse correctly (preprocessor, pointers,
 *    function pointers, unions, structs)
 * 3. .h header files use the same language mapping as .c files
 * 4. Context collection: C declarations (functions, structs, enums,
 *    unions, typedefs) and imports (#include) are extracted
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
import { ASTQueryExtractor } from '../ast-query-extractor.js';
import { extractImports } from '../language-analysis.js';

const cFilePath = join('test.c');

describe('ast_edit AST validation: C', () => {
  const ctx = useTempDir();

  it('reports AST PASSED for valid C', async () => {
    const filePath = join(ctx.tempDir, 'valid.c');
    writeFileSync(
      filePath,
      'int add(int a, int b) {\n    return a + b;\n}\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'return a + b;',
      new_string: 'return a + b + 0;',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });

  it('reports AST FAILED with line/column for missing semicolon', async () => {
    const filePath = join(ctx.tempDir, 'missing-semicolon.c');
    writeFileSync(
      filePath,
      'int main(void) {\n    int x = 42;\n    return 0;\n}\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'int x = 42;',
      new_string: 'int x = 42',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('AST validation: FAILED');
    expect(output).toContain('AST errors:');
    expect(output).toMatch(/Syntax error at line \d+, column \d+/);
  });

  it('reports AST FAILED for missing closing brace', async () => {
    const filePath = join(ctx.tempDir, 'missing-brace.c');
    writeFileSync(filePath, 'int main(void) {\n    return 0;\n}\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const brokenResult = await executePreview(tool, {
      file_path: filePath,
      old_string: '    return 0;\n}',
      new_string: '    return 0;\n',
    });

    expect(brokenResult.error).toBeUndefined();
    expect(String(brokenResult.llmContent)).toContain('AST validation: FAILED');
  });
});

describe('ast_edit C-specific constructs', () => {
  const ctx = useTempDir();

  it('reports AST PASSED for preprocessor directives (#include, #define)', async () => {
    const filePath = join(ctx.tempDir, 'preproc.c');
    writeFileSync(
      filePath,
      [
        '#include <stdio.h>',
        '#define MAX 100',
        'int main(void) {',
        '    printf("%d", MAX);',
        '    return 0;',
        '}',
        '',
      ].join('\n'),
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'printf("%d", MAX);',
      new_string: 'printf("%d", MAX + 1);',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });

  it('reports AST PASSED for pointer declarations', async () => {
    const filePath = join(ctx.tempDir, 'pointers.c');
    writeFileSync(
      filePath,
      [
        'int main(void) {',
        '    int x = 10;',
        '    int *p = &x;',
        '    return *p;',
        '}',
        '',
      ].join('\n'),
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'int *p = &x;',
      new_string: 'int *p = &x; int *q = p;',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });

  it('reports AST PASSED for function pointers', async () => {
    const filePath = join(ctx.tempDir, 'fnptr.c');
    writeFileSync(
      filePath,
      [
        'typedef int (*compare_fn)(int, int);',
        'int ascending(int a, int b) { return a - b; }',
        'int main(void) {',
        '    compare_fn cmp = ascending;',
        '    return cmp(1, 2);',
        '}',
        '',
      ].join('\n'),
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'cmp(1, 2);',
      new_string: 'cmp(3, 4);',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });

  it('reports AST PASSED for unions', async () => {
    const filePath = join(ctx.tempDir, 'union.c');
    writeFileSync(
      filePath,
      [
        'union Data {',
        '    int i;',
        '    float f;',
        '};',
        'int main(void) {',
        '    union Data d;',
        '    d.i = 42;',
        '    return d.i;',
        '}',
        '',
      ].join('\n'),
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'd.i = 42;',
      new_string: 'd.i = 100;',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });

  it('reports AST PASSED for struct definitions', async () => {
    const filePath = join(ctx.tempDir, 'struct.c');
    writeFileSync(
      filePath,
      [
        'struct Point {',
        '    int x;',
        '    int y;',
        '};',
        'int main(void) {',
        '    struct Point p;',
        '    p.x = 1;',
        '    p.y = 2;',
        '    return p.x + p.y;',
        '}',
        '',
      ].join('\n'),
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'p.x = 1;',
      new_string: 'p.x = 10;',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });
});

describe('ast_edit .h header files', () => {
  const ctx = useTempDir();

  it('reports AST PASSED for valid .h header file', async () => {
    const filePath = join(ctx.tempDir, 'header.h');
    writeFileSync(
      filePath,
      [
        '#ifndef HEADER_H',
        '#define HEADER_H',
        'typedef struct {',
        '    int x;',
        '    int y;',
        '} Point;',
        'Point create_point(int x, int y);',
        '#endif',
        '',
      ].join('\n'),
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'int x;',
      new_string: 'int x; int z;',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });

  it('reports AST FAILED for broken .h header file', async () => {
    const filePath = join(ctx.tempDir, 'broken.h');
    writeFileSync(
      filePath,
      'typedef struct {\n    int x;\n} Point;\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'int x;',
      new_string: 'int x',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('AST validation: FAILED');
    expect(output).toMatch(/Syntax error at line \d+, column \d+/);
  });
});

describe('ast_edit C declaration extraction', () => {
  it('extracts C functions with signatures', async () => {
    const extractor = new ASTQueryExtractor();
    const code = 'int add(int a, int b) {\n    return a + b;\n}\n';

    const declarations = await extractor.extractDeclarations(cFilePath, code);

    const functions = declarations.filter((d) => d.type === 'function');
    expect(functions).toHaveLength(1);
    expect(functions[0].name).toBe('add');
    expect(functions[0].line).toBe(1);
    expect(functions[0].signature).toBe('(int a, int b)');
  });

  it('extracts struct definitions', async () => {
    const extractor = new ASTQueryExtractor();
    const code = 'struct Point {\n    int x;\n    int y;\n};\n';

    const declarations = await extractor.extractDeclarations(cFilePath, code);

    const structs = declarations.filter((d) => d.type === 'struct');
    expect(structs).toHaveLength(1);
    expect(structs[0].name).toBe('Point');
  });

  it('extracts union definitions', async () => {
    const extractor = new ASTQueryExtractor();
    const code = 'union Data {\n    int i;\n    float f;\n};\n';

    const declarations = await extractor.extractDeclarations(cFilePath, code);

    const unions = declarations.filter((d) => d.type === 'union');
    expect(unions).toHaveLength(1);
    expect(unions[0].name).toBe('Data');
  });

  it('extracts enum definitions', async () => {
    const extractor = new ASTQueryExtractor();
    const code = 'enum Color { RED, GREEN, BLUE };\n';

    const declarations = await extractor.extractDeclarations(cFilePath, code);

    const enums = declarations.filter((d) => d.type === 'enum');
    expect(enums).toHaveLength(1);
    expect(enums[0].name).toBe('Color');
  });

  it('extracts simple typedefs', async () => {
    const extractor = new ASTQueryExtractor();
    const code = 'typedef unsigned long size_t;\n';

    const declarations = await extractor.extractDeclarations(cFilePath, code);

    const typedefs = declarations.filter((d) => d.type === 'typedef');
    expect(typedefs).toHaveLength(1);
    expect(typedefs[0].name).toBe('size_t');
  });

  it('extracts function pointer typedefs', async () => {
    const extractor = new ASTQueryExtractor();
    const code = 'typedef int (*compare_fn)(int, int);\n';

    const declarations = await extractor.extractDeclarations(cFilePath, code);

    const typedefs = declarations.filter((d) => d.type === 'typedef');
    expect(typedefs).toHaveLength(1);
    expect(typedefs[0].name).toBe('compare_fn');
  });

  it('extracts array typedefs', async () => {
    const extractor = new ASTQueryExtractor();
    const code = 'typedef int buffer[10];\n';

    const declarations = await extractor.extractDeclarations(cFilePath, code);

    const typedefs = declarations.filter((d) => d.type === 'typedef');
    expect(typedefs).toHaveLength(1);
    expect(typedefs[0].name).toBe('buffer');
  });

  it('does not classify function pointer variables as function prototypes', async () => {
    const extractor = new ASTQueryExtractor();
    const code = 'void (*callback)(int);\n';

    const declarations = await extractor.extractDeclarations(cFilePath, code);

    const functions = declarations.filter((d) => d.type === 'function');
    expect(functions).toHaveLength(0);
  });

  it('extracts declarations from a full C module', async () => {
    const extractor = new ASTQueryExtractor();
    const code = [
      '#include <stdio.h>',
      'typedef struct { int x; int y; } Point;',
      'struct Rectangle { int w; int h; };',
      'union Data { int i; float f; };',
      'enum Status { OK, FAIL };',
      'int compute(Point p) { return p.x + p.y; }',
      '',
    ].join('\n');

    const declarations = await extractor.extractDeclarations(cFilePath, code);
    const names = declarations.map((d) => d.name);
    const types = declarations.map((d) => d.type);

    expect(names).toContain('Point');
    expect(types).toContain('typedef');
    expect(names).toContain('Rectangle');
    expect(types).toContain('struct');
    expect(names).toContain('Data');
    expect(types).toContain('union');
    expect(names).toContain('Status');
    expect(types).toContain('enum');
    expect(names).toContain('compute');
    expect(types).toContain('function');
  });

  it('works with .h header files for declaration extraction', async () => {
    const extractor = new ASTQueryExtractor();
    const headerPath = join('header.h');
    const code = 'typedef struct { int x; } Vec;\nvoid init(Vec *v);\n';

    const declarations = await extractor.extractDeclarations(headerPath, code);

    const names = declarations.map((d) => d.name);
    expect(names).toContain('Vec');
    expect(names).toContain('init');
  });
});

describe('ast_edit C import extraction', () => {
  it('extracts system #include directives', () => {
    const code = '#include <stdio.h>\n#include <stdlib.h>\n';
    const imports = extractImports(code, 'c');

    expect(imports).toHaveLength(2);
    expect(imports[0].module).toBe('stdio.h');
    expect(imports[0].items).toEqual([]);
    expect(imports[0].line).toBe(1);
    expect(imports[1].module).toBe('stdlib.h');
    expect(imports[1].line).toBe(2);
  });

  it('extracts local #include directives with quotes', () => {
    const code = '#include "myheader.h"\n';
    const imports = extractImports(code, 'c');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('myheader.h');
    expect(imports[0].items).toEqual([]);
  });

  it('ignores non-include lines', () => {
    const code = 'int main(void) { return 0; }\n// #include <fake.h>\n';
    const imports = extractImports(code, 'c');

    expect(imports).toHaveLength(0);
  });
});
