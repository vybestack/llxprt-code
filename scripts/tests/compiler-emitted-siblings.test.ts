/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compilerEmittedSiblings,
  emittedIgnoreEntries,
} from '../compiler-emitted-siblings.js';

function withFixture(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'emitted-siblings-'));
  try {
    mkdirSync(join(root, 'packages/mcp/src/auth'), { recursive: true });
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function put(root: string, name: string, value = ''): void {
  writeFileSync(join(root, 'packages/mcp/src/auth', name), value);
}

describe('compiler-emitted sibling exclusion', () => {
  it('selects only JS and declarations backed by a TypeScript source and its source map', () => {
    withFixture((root) => {
      put(root, 'oauth.ts', 'export const oauth = 1;');
      put(
        root,
        'oauth.js',
        'export const oauth = 1;\n//# sourceMappingURL=oauth.js.map',
      );
      put(
        root,
        'oauth.js.map',
        JSON.stringify({ version: 3, file: 'oauth.js', sources: ['oauth.ts'] }),
      );
      put(root, 'oauth.d.ts', 'export declare const oauth = 1;');
      expect(compilerEmittedSiblings(root)).toEqual([
        'packages/mcp/src/auth/oauth.d.ts',
        'packages/mcp/src/auth/oauth.js',
      ]);
    });
  });

  it('excludes compiler-proven core siblings without excluding handwritten core JavaScript', () => {
    withFixture((root) => {
      const directory = join(root, 'packages/core/src/config');
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'ownership.ts'), 'export const owner = 1;');
      writeFileSync(
        join(directory, 'ownership.js'),
        'export const owner = 1;\n//# sourceMappingURL=ownership.js.map',
      );
      writeFileSync(
        join(directory, 'ownership.js.map'),
        JSON.stringify({
          version: 3,
          file: 'ownership.js',
          sources: ['ownership.ts'],
        }),
      );
      writeFileSync(
        join(directory, 'ownership.d.ts'),
        'export declare const owner = 1;',
      );
      writeFileSync(
        join(directory, 'handwritten.js'),
        'export const hand = 1;',
      );
      expect(compilerEmittedSiblings(root)).toEqual([
        'packages/core/src/config/ownership.d.ts',
        'packages/core/src/config/ownership.js',
      ]);
    });
  });

  it('retains handwritten JS, absent maps, and maps that point at another source', () => {
    withFixture((root) => {
      put(root, 'entry.js', 'export const entry = 1;');
      put(root, 'mapped.ts');
      put(root, 'mapped.js', 'export const mapped = 1;');
      put(
        root,
        'mapped.js.map',
        JSON.stringify({
          version: 3,
          file: 'mapped.js',
          sources: ['other.ts'],
        }),
      );
      put(root, 'mapped.d.ts', 'export declare const mapped: number;');
      expect(compilerEmittedSiblings(root)).toEqual([]);
    });
  });

  it('recognizes declaration-only compiler output without a JS sibling', () => {
    withFixture((root) => {
      put(
        root,
        'types.ts',
        'export interface Shape { readonly sides: number; }',
      );
      put(root, 'types.d.ts', '/** emitted */');
      expect(compilerEmittedSiblings(root)).toEqual([]);
      put(
        root,
        'types.d.ts',
        `export interface Shape {
    readonly sides: number;
}
`,
      );
      expect(compilerEmittedSiblings(root)).toEqual([
        'packages/mcp/src/auth/types.d.ts',
      ]);
      put(
        root,
        'types.ts',
        `import type { Thing } from './current.js';
export interface Shape { readonly value: Thing; }`,
      );
      put(
        root,
        'types.d.ts',
        `import type { Thing } from './old.js';
export interface Shape {
    readonly value: Thing;
}
`,
      );
      expect(compilerEmittedSiblings(root)).toEqual([
        'packages/mcp/src/auth/types.d.ts',
      ]);
    });
  });

  it('retains explicitly exported JS even with a complete sibling set', () => {
    withFixture((root) => {
      put(root, 'entry.ts');
      put(root, 'entry.js', 'export {};\n//# sourceMappingURL=entry.js.map');
      put(
        root,
        'entry.js.map',
        JSON.stringify({ version: 3, file: 'entry.js', sources: ['entry.ts'] }),
      );
      writeFileSync(
        join(root, 'packages/mcp/package.json'),
        JSON.stringify({
          exports: { './entry.js': { import: './src/auth/entry.js' } },
        }),
      );
      expect(compilerEmittedSiblings(root)).toEqual([]);
    });
  });
});

it('writes ignore entries relative to the temporary ignore file rather than the invocation cwd', () => {
  const root = '/workspace/project';
  const ignoreFile = join(root, 'tmp', 'format-emitted-123', '.prettierignore');
  expect(
    emittedIgnoreEntries(root, ignoreFile, [
      'packages/core/src/config/configBaseCore.js',
    ]),
  ).toBe('../../packages/core/src/config/configBaseCore.js\n');
});

it('does not classify JS whose stale source map refers to a different output', () => {
  withFixture((root) => {
    put(root, 'stale.ts', 'export const version = 2;');
    put(
      root,
      'stale.js',
      'export const version = 1;\n//# sourceMappingURL=stale.js.map',
    );
    put(
      root,
      'stale.js.map',
      JSON.stringify({ file: 'earlier.js', sources: ['stale.ts'] }),
    );
    expect(compilerEmittedSiblings(root)).toEqual([]);
  });
});
