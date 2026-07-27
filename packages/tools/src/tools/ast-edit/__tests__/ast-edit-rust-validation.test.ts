/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for ast_edit Rust language support (issue #1759).
 *
 * Covers three acceptance areas:
 * 1. AST validation: valid Rust passes, broken Rust fails with line/column
 * 2. Rust-specific constructs parse correctly (impl, trait, match, lifetimes)
 * 3. Context collection: Rust declarations (fn/struct/impl/trait/enum) and
 *    imports (use statements) are extracted
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  useTempDir,
  createFakeToolHost,
  executePreview,
} from './test-helpers.js';
import { ASTEditTool } from '../../ast-edit.js';
import { ASTQueryExtractor } from '../ast-query-extractor.js';
import { extractImports } from '../language-analysis.js';

const rustFilePath = join(tmpdir(), 'test.rs');

describe('ast_edit AST validation: Rust', () => {
  const ctx = useTempDir();

  it('reports AST PASSED for valid Rust', async () => {
    const filePath = join(ctx.tempDir, 'valid.rs');
    writeFileSync(
      filePath,
      'fn main() {\n    println!("hello");\n}\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'println!("hello");',
      new_string: 'println!("world");',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });

  it('reports AST FAILED with line/column for missing semicolon', async () => {
    const filePath = join(ctx.tempDir, 'missing-semicolon.rs');
    writeFileSync(filePath, 'fn main() {\n    let x = 42;\n}\n', 'utf-8');
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'let x = 42;',
      new_string: 'let x = 42',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    expect(output).toContain('AST validation: FAILED');
    expect(output).toContain('AST errors:');
    expect(output).toMatch(/Syntax error at line \d+, column \d+/);
  });

  it('reports AST FAILED for missing closing brace on impl block', async () => {
    const filePath = join(ctx.tempDir, 'missing-brace.rs');
    writeFileSync(
      filePath,
      'struct Foo;\nimpl Foo {\n    fn bar(&self) {}\n}\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'fn bar(&self) {}',
      new_string: 'fn bar(&self) {',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: FAILED');
  });

  it('reports AST PASSED for Rust impl blocks', async () => {
    const filePath = join(ctx.tempDir, 'impl.rs');
    writeFileSync(
      filePath,
      'struct Point { x: f64 }\nimpl Point {\n    fn get(&self) -> f64 { self.x }\n}\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'self.x }',
      new_string: 'self.x + 0.0 }',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });

  it('reports AST PASSED for Rust trait definitions', async () => {
    const filePath = join(ctx.tempDir, 'trait.rs');
    writeFileSync(
      filePath,
      'trait Greet {\n    fn say_hello(&self);\n}\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'fn say_hello(&self);',
      new_string: 'fn say_hi(&self);',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });

  it('reports AST PASSED for Rust match expressions', async () => {
    const filePath = join(ctx.tempDir, 'match.rs');
    writeFileSync(
      filePath,
      'fn check(x: i32) -> i32 {\n    match x {\n        0 => 1,\n        _ => 2,\n    }\n}\n',
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: '0 => 1,',
      new_string: '0 => 10,',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });

  it('reports AST PASSED for Rust lifetimes and generics', async () => {
    const filePath = join(ctx.tempDir, 'lifetimes.rs');
    writeFileSync(
      filePath,
      "fn first<'a>(s: &'a str) -> &'a str {\n    &s[0..1]\n}\n",
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: '&s[0..1]',
      new_string: '&s[0..2]',
    });

    expect(result.error).toBeUndefined();
    expect(String(result.llmContent)).toContain('AST validation: PASSED');
  });
});

describe('ast_edit Rust declaration extraction', () => {
  const ctx = useTempDir();

  it('extracts Rust functions, structs, traits, enums, and impl methods', async () => {
    const filePath = join(ctx.tempDir, 'module.rs');
    writeFileSync(
      filePath,
      [
        'fn free_function() {}',
        '',
        'struct Point {',
        '    x: f64,',
        '    y: f64,',
        '}',
        '',
        'impl Point {',
        '    fn new(x: f64, y: f64) -> Self {',
        '        Point { x, y }',
        '    }',
        '}',
        '',
        'trait Drawable {',
        '    fn draw(&self);',
        '}',
        '',
        'enum Color {',
        '    Red,',
        '    Green,',
        '}',
        '',
      ].join('\n'),
      'utf-8',
    );
    const tool = new ASTEditTool(createFakeToolHost(ctx.tempDir));

    const result = await executePreview(tool, {
      file_path: filePath,
      old_string: 'fn free_function() {}',
      new_string: 'fn free_function() { /* noop */ }',
    });

    expect(result.error).toBeUndefined();
    const output = String(result.llmContent);
    // The free-standing function
    expect(output).toContain('function: free_function');
    // The struct
    expect(output).toContain('struct: Point');
    // The impl method
    expect(output).toContain('function: new');
    // The trait
    expect(output).toContain('trait: Drawable');
    // The enum
    expect(output).toContain('enum: Color');
  });

  it('includes function signatures with parameters for Rust functions', async () => {
    const extractor = new ASTQueryExtractor();
    const code = 'fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n';

    const declarations = await extractor.extractDeclarations(
      rustFilePath,
      code,
    );

    expect(declarations).toHaveLength(1);
    expect(declarations[0].name).toBe('add');
    expect(declarations[0].type).toBe('function');
    expect(declarations[0].line).toBe(1);
    expect(declarations[0].signature).toBe('(a: i32, b: i32) -> i32');
  });

  it('categorizes struct, trait, and enum declarations distinctly', async () => {
    const extractor = new ASTQueryExtractor();
    const code = [
      'struct Point { x: f64 }',
      'trait Greet { fn hello(&self); }',
      'enum Status { Active, Inactive }',
      '',
    ].join('\n');

    const declarations = await extractor.extractDeclarations(
      rustFilePath,
      code,
    );

    const types = declarations.map((d) => d.type);
    expect(types).toContain('struct');
    expect(types).toContain('trait');
    expect(types).toContain('enum');
  });

  it('extracts methods inside impl blocks as functions', async () => {
    const extractor = new ASTQueryExtractor();
    const code = [
      'impl Point {',
      '    fn new() -> Self { Self {} }',
      '    fn distance(&self) -> f64 { 0.0 }',
      '}',
      '',
    ].join('\n');

    const declarations = await extractor.extractDeclarations(
      rustFilePath,
      code,
    );

    const functions = declarations.filter((d) => d.type === 'function');
    const fnNames = functions.map((d) => d.name);
    expect(fnNames).toContain('new');
    expect(fnNames).toContain('distance');
    const impls = declarations.filter((d) => d.type === 'impl');
    expect(impls.map((d) => d.name)).toContain('Point');
  });
});

describe('ast_edit Rust import extraction', () => {
  it('extracts simple use declarations', () => {
    const code = 'use std::collections::HashMap;\nuse std::io::Read;\n';
    const imports = extractImports(code, 'rust');

    expect(imports).toHaveLength(2);
    expect(imports[0].module).toBe('std::collections::HashMap');
    expect(imports[0].line).toBe(1);
    expect(imports[1].module).toBe('std::io::Read');
    expect(imports[1].line).toBe(2);
  });

  it('extracts grouped use declarations with braces', () => {
    const code = 'use std::io::{Read, Write};\n';
    const imports = extractImports(code, 'rust');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('std::io');
    expect(imports[0].items).toEqual(['Read', 'Write']);
  });

  it('extracts single-item grouped use declarations', () => {
    const code = 'use std::fs::{self};\n';
    const imports = extractImports(code, 'rust');

    expect(imports).toHaveLength(1);
    expect(imports[0].items).toEqual(['self']);
  });

  it('ignores non-use lines', () => {
    const code = 'fn main() {}\n// use comment::NotImport;\n';
    const imports = extractImports(code, 'rust');

    expect(imports).toHaveLength(0);
  });

  it('strips inline comments from use declarations', () => {
    const code = 'use std::fmt; // formatting\n';
    const imports = extractImports(code, 'rust');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('std::fmt');
  });

  it('strips trailing as-alias from simple use paths', () => {
    const code = 'use std::fmt::Write as W;\n';
    const imports = extractImports(code, 'rust');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('std::fmt::Write');
  });

  it('extracts pub use re-exports', () => {
    const code = 'pub use crate::utils::helper;\n';
    const imports = extractImports(code, 'rust');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('crate::utils::helper');
    expect(imports[0].line).toBe(1);
  });

  it('handles nested brace groups in use declarations', () => {
    const code = 'use std::{io::{Read, Write}, fs};\n';
    const imports = extractImports(code, 'rust');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('std');
    expect(imports[0].items).toEqual(['io::{Read, Write}', 'fs']);
  });

  it('handles empty brace groups in use declarations', () => {
    const code = 'use std::{};\n';
    const imports = extractImports(code, 'rust');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('std');
    expect(imports[0].items).toEqual([]);
  });

  it('strips block comments from use declarations', () => {
    const code = 'use std::fs; /* important */\n';
    const imports = extractImports(code, 'rust');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('std::fs');
  });

  it('extracts visibility-qualified use declarations', () => {
    const code = [
      'pub use crate::utils::helper;\n',
      'pub(crate) use std::fs::File;\n',
      'pub(super) use std::io::Read;\n',
    ].join('');

    const imports = extractImports(code, 'rust');

    expect(imports).toHaveLength(3);
    expect(imports[0].module).toBe('crate::utils::helper');
    expect(imports[1].module).toBe('std::fs::File');
    expect(imports[2].module).toBe('std::io::Read');
  });

  it('handles block comments containing // in use declarations', () => {
    const code = 'use std::fs; /* see docs//examples */\n';
    const imports = extractImports(code, 'rust');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('std::fs');
  });
});
