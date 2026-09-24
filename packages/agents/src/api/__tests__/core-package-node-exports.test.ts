/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const agentsRoot = resolve(import.meta.dirname, '../../..');
const coreRoot = resolve(agentsRoot, '../core');
const corePackage: unknown = JSON.parse(
  readFileSync(resolve(coreRoot, 'package.json'), 'utf8'),
);

function isRuntimeImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined || clause.isTypeOnly) return false;
  const bindings = clause.namedBindings;
  return (
    clause.name !== undefined ||
    bindings === undefined ||
    ts.isNamespaceImport(bindings) ||
    bindings.elements.some((element) => !element.isTypeOnly)
  );
}

function runtimeCoreSubpath(statement: ts.Statement): string | undefined {
  if (
    !ts.isImportDeclaration(statement) ||
    !ts.isStringLiteral(statement.moduleSpecifier) ||
    !isRuntimeImport(statement)
  ) {
    return undefined;
  }
  const specifier = statement.moduleSpecifier.text;
  const prefix = '@vybestack/llxprt-code-core/';
  return specifier.startsWith(prefix)
    ? `./${specifier.slice(prefix.length)}`
    : undefined;
}

describe('agents Node consumer core imports', () => {
  it('exports every runtime core subpath imported by agents production source', () => {
    if (typeof corePackage !== 'object' || corePackage === null) {
      throw new Error('Core package must declare an exports map');
    }
    if (
      !('exports' in corePackage) ||
      typeof corePackage.exports !== 'object' ||
      corePackage.exports === null
    ) {
      throw new Error('Core package must declare an exports map');
    }
    const exportsMap = corePackage.exports;
    const missing = new Set<string>();
    const sourceRoot = resolve(agentsRoot, 'src');
    const sourceFiles = readdirSync(sourceRoot, {
      recursive: true,
      encoding: 'utf8',
    }).filter(
      (file) =>
        /\.tsx?$/.test(file) &&
        !/\.(?:test|spec)\.|\/__tests__\/|\/test-bun\//.test(file),
    );
    for (const relativeFile of sourceFiles) {
      const file = resolve(sourceRoot, relativeFile);
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const statement of source.statements) {
        const subpath = runtimeCoreSubpath(statement);
        if (subpath !== undefined && !(subpath in exportsMap)) {
          missing.add(subpath);
        }
      }
    }
    expect([...missing].sort()).toStrictEqual([]);
  });
});
