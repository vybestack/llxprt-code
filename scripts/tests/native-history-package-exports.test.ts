/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dir, '../..');

function runtimeCoreImports(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__' || entry.name === 'test-utils') return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return runtimeCoreImports(path);
    if (
      !entry.name.endsWith('.ts') ||
      /\.(test|spec|test-helper|fixtures)\./.test(entry.name)
    )
      return [];
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const imports: string[] = [];
    function visit(node: ts.Node): void {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        const onlyTypeBindings =
          bindings !== undefined &&
          ts.isNamedImports(bindings) &&
          bindings.elements.every((element) => element.isTypeOnly);
        const typeOnly =
          clause?.isTypeOnly ||
          (clause?.name === undefined && onlyTypeBindings);
        if (
          !typeOnly &&
          node.moduleSpecifier.text.startsWith('@vybestack/llxprt-code-core/')
        )
          imports.push(node.moduleSpecifier.text);
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const argument = node.arguments[0];
        if (
          argument &&
          ts.isStringLiteral(argument) &&
          argument.text.startsWith('@vybestack/llxprt-code-core/')
        )
          imports.push(argument.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    return imports;
  });
}

it('resolves provider and agent core runtime imports from an installed package without tsconfig aliases', () => {
  const directory = mkdtempSync(join(tmpdir(), 'native-history-exports-'));
  try {
    const scope = join(directory, 'node_modules/@vybestack');
    mkdirSync(scope, { recursive: true });
    symlinkSync(
      join(root, 'packages/core'),
      join(scope, 'llxprt-code-core'),
      'dir',
    );
    const specifiers = [
      ...new Set(
        ['providers', 'agents'].flatMap((name) =>
          runtimeCoreImports(join(root, 'packages', name, 'src')),
        ),
      ),
    ];
    expect(specifiers.length).toBeGreaterThan(0);
    const result = spawnSync(
      process.execPath,
      [
        '--conditions=bun',
        '--eval',
        `
      const { existsSync } = require('node:fs');
      const { createRequire } = require('node:module');
      const resolve = createRequire(process.cwd() + '/probe.cjs').resolve;
      for (const specifier of JSON.parse(process.env.CORE_SPECIFIERS)) {
        const path = resolve(specifier);
        if (!existsSync(path)) throw new Error('Missing export target: ' + path);
      }
    `,
      ],
      {
        cwd: directory,
        env: { ...process.env, CORE_SPECIFIERS: JSON.stringify(specifiers) },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
