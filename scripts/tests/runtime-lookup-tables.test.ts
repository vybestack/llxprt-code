/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import {
  scanRuntimeStateStructure,
  type RuntimeStateFinding,
} from './runtime-state-structure-guard.js';
import { loadImmutableTableAllowlist } from '../runtime-immutable-table-allowlist.js';

const tables = Object.freeze(
  (
    [
      ['messages.ts', 'MISSING_RUNTIME_REQUIREMENTS'],
      ['messages.ts', 'NORMALIZATION_REQUIREMENTS'],
      [
        '../../../agents/src/api/profile-application/switchProfileProvider.ts',
        'PRESERVED_PROFILE_EPHEMERALS',
      ],
      ['promptEnvelopeProjections.ts', 'STATEFUL_INCREMENTAL_PROMPT_KEYS'],
      ['promptEnvelopeProjections.ts', 'PROMPT_KEYS'],
      ['providerSwitch.ts', 'DEFAULT_PRESERVE_EPHEMERALS'],
      ['statelessHardening.ts', 'STATELESS_METADATA_KEYS'],
    ] as const
  ).map((table) => Object.freeze(table)),
);

function unfrozenSource(file: string, source: string, name: string): string {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    )
      initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  if (!initializer) throw new Error(`Missing table ${name}`);
  if (
    !ts.isCallExpression(initializer) ||
    initializer.expression.getText(parsed) !== 'Object.freeze'
  )
    return source;
  const value = initializer.arguments[0];
  if (!value) throw new Error(`Missing frozen table value ${name}`);
  return (
    source.slice(0, initializer.getStart(parsed)) +
    value.getText(parsed) +
    source.slice(initializer.end)
  );
}

function tableFindings(
  file: string,
  source: string,
  name: string,
): RuntimeStateFinding[] {
  return scanRuntimeStateStructure(file, source, [], undefined, {
    allowlist: [],
  }).filter((finding) => finding.declaration === name);
}

describe('runtime lookup table ownership policy', () => {
  it('keeps an empty committed immutable table allowlist', () => {
    expect(loadImmutableTableAllowlist()).toEqual([]);
  });

  it.each(tables)(
    'permits frozen %s %s without an allowance',
    (relative, name) => {
      const file = resolve(
        import.meta.dir,
        '../../packages/providers/src/runtime',
        relative,
      );
      expect(tableFindings(file, readFileSync(file, 'utf8'), name)).toEqual([]);
    },
  );

  it.each(tables)('rejects restoring unfrozen %s %s', (relative, name) => {
    const file = resolve(
      import.meta.dir,
      '../../packages/providers/src/runtime',
      relative,
    );
    const source = unfrozenSource(file, readFileSync(file, 'utf8'), name);
    expect(tableFindings(file, source, name)).toContainEqual(
      expect.objectContaining({ kind: 'mutable-state' }),
    );
  });

  it.each(tables)('rejects writing to %s %s', (relative, name) => {
    const file = resolve(
      import.meta.dir,
      '../../packages/providers/src/runtime',
      relative,
    );
    const source = `${readFileSync(file, 'utf8')}\nReflect.set(${name}, '0', 'corruption');`;
    expect(tableFindings(file, source, name)).toContainEqual(
      expect.objectContaining({ kind: 'module-mutation' }),
    );
  });
});
