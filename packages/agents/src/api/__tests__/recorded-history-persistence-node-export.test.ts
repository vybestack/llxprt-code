/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const agentsRoot = resolve(import.meta.dir, '..', '..', '..');

describe('Agent session persistence publication', () => {
  it('resolves the session journal constructor through a Node-exported Core entry', () => {
    const owner = resolve(
      agentsRoot,
      'src/api/control/recordedHistoryPersistence.ts',
    );
    const source = ts.createSourceFile(
      owner,
      readFileSync(owner, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const specifier = source.statements
      .filter(ts.isImportDeclaration)
      .find((statement) => {
        const bindings = statement.importClause?.namedBindings;
        return (
          bindings !== undefined &&
          ts.isNamedImports(bindings) &&
          bindings.elements.some(
            (element) =>
              element.name.text === 'SessionPersistenceService' &&
              !element.isTypeOnly,
          )
        );
      })?.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) {
      throw new Error('Session journal constructor import is missing');
    }

    const resolved = execFileSync(
      'node',
      [
        '--input-type=module',
        '-e',
        `const mod = await import(${JSON.stringify(specifier.text)}); process.stdout.write(typeof mod.SessionPersistenceService);`,
      ],
      {
        cwd: agentsRoot,
        env: { PATH: process.env.PATH },
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    expect(resolved).toBe('function');
  });
});
