/**
 * Tests for validateASTSyntax — verifies it detects tree-sitter ERROR nodes
 * and zero-width phantom nodes (MISSING tokens from error recovery) rather
 * than relying on thrown exceptions (tree-sitter is error-recovering).
 */

import { describe, it, expect } from 'vitest';
import { validateASTSyntax } from '../edit-calculator.js';

const JS_PATH = '/test/file.js';
const TS_PATH = '/test/file.ts';
// eslint-disable-next-line sonarjs/regular-expr -- Static test regex reviewed for lint hardening; behavior preserved.
const SYNTAX_ERROR_PATTERN = /Syntax error at line \d+, column \d+/;

describe('validateASTSyntax', () => {
  it('should return valid for correct JavaScript', () => {
    const result = validateASTSyntax(
      JS_PATH,
      'const x = 1;\nfunction foo() { return x; }',
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toStrictEqual([]);
  });

  it('should return valid for correct TypeScript', () => {
    const result = validateASTSyntax(
      TS_PATH,
      'const x: number = 1;\ninterface Foo { bar: string; }',
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toStrictEqual([]);
  });

  it('should detect syntax errors in JavaScript', () => {
    const result = validateASTSyntax(JS_PATH, '{{{{ )))) const const');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(SYNTAX_ERROR_PATTERN);
  });

  it('should detect syntax errors in TypeScript', () => {
    const result = validateASTSyntax(TS_PATH, 'function foo( { return; }');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(SYNTAX_ERROR_PATTERN);
  });

  it('should return valid: true for unknown extensions (no language mapping)', () => {
    const result = validateASTSyntax(
      '/test/file.xyz',
      'this is not valid code in any language {{{',
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toStrictEqual([]);
  });

  it('should handle empty content for a known language', () => {
    const result = validateASTSyntax(JS_PATH, '');
    expect(result.valid).toBe(true);
    expect(result.errors).toStrictEqual([]);
  });

  it('should handle case-insensitive extensions', () => {
    const result = validateASTSyntax('/test/file.JS', 'const x = 1;');
    expect(result.valid).toBe(true);
    expect(result.errors).toStrictEqual([]);
  });

  it('should detect unclosed string literals', () => {
    const result = validateASTSyntax(
      JS_PATH,
      'const x = "unclosed string;\nconst y = 2;',
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should detect garbled syntax with misplaced tokens', () => {
    const result = validateASTSyntax(TS_PATH, 'function foo() } { return 1; {');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should detect missing closing brace via zero-width phantom node', () => {
    const result = validateASTSyntax(TS_PATH, 'function foo() {');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(SYNTAX_ERROR_PATTERN);
  });

  it('should detect missing closing brace in interface', () => {
    const code = ['interface Foo {', '  bar: string;', ''].join(
      String.fromCharCode(10),
    );
    const result = validateASTSyntax(TS_PATH, code);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should pass valid multi-line TypeScript', () => {
    const lines = [
      'interface Foo {',
      '  bar: string;',
      '  baz: number;',
      '}',
      '',
      'function greet(name: string): string {',
      '  return "Hello " + name;',
      '}',
    ];
    const code = lines.join(String.fromCharCode(10));
    const result = validateASTSyntax(TS_PATH, code);
    expect(result.valid).toBe(true);
    expect(result.errors).toStrictEqual([]);
  });
});
