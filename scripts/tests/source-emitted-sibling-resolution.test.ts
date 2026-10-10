/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compilerEmittedSiblings } from '../compiler-emitted-siblings.js';
import {
  sourceEmittedSiblingPlugin,
  resolveEmittedSiblingImport,
} from '../source-emitted-sibling-resolution.js';

describe('source sibling resolution for tests', () => {
  it('routes only compiler-verified relative Core imports to current TypeScript', () => {
    const root = mkdtempSync(join(tmpdir(), 'emitted-resolution-'));
    try {
      const dir = join(root, 'packages/core/src/config');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'configBaseCore.ts'),
        'export const version = 2;',
      );
      writeFileSync(
        join(dir, 'configBaseCore.js'),
        'export const version = 1;\n//# sourceMappingURL=configBaseCore.js.map',
      );
      writeFileSync(
        join(dir, 'configBaseCore.js.map'),
        JSON.stringify({
          file: 'configBaseCore.js',
          sources: ['configBaseCore.ts'],
        }),
      );
      writeFileSync(join(dir, 'handwritten.ts'), 'export const value = 2;');
      writeFileSync(join(dir, 'handwritten.js'), 'export const value = 1;');
      writeFileSync(join(dir, 'stale.ts'), 'export const value = 2;');
      writeFileSync(
        join(dir, 'stale.js'),
        'export const value = 1;\n//# sourceMappingURL=stale.js.map',
      );
      writeFileSync(
        join(dir, 'stale.js.map'),
        JSON.stringify({ file: 'different.js', sources: ['stale.ts'] }),
      );
      writeFileSync(
        join(root, 'packages/core/package.json'),
        JSON.stringify({
          exports: { './shipped.js': { import: './src/config/shipped.js' } },
        }),
      );
      writeFileSync(join(dir, 'shipped.ts'), 'export const value = 2;');
      writeFileSync(
        join(dir, 'shipped.js'),
        'export const value = 1;\n//# sourceMappingURL=shipped.js.map',
      );
      writeFileSync(
        join(dir, 'shipped.js.map'),
        JSON.stringify({ file: 'shipped.js', sources: ['shipped.ts'] }),
      );
      const emitted = new Set(compilerEmittedSiblings(root));
      expect(
        resolveEmittedSiblingImport(
          './configBaseCore.js',
          join(dir, 'configBase.ts'),
          root,
          emitted,
        ),
      ).toBe(join(dir, 'configBaseCore.ts'));
      expect(
        resolveEmittedSiblingImport(
          './handwritten.js',
          join(dir, 'configBase.ts'),
          root,
          emitted,
        ),
      ).toBeUndefined();
      expect(
        resolveEmittedSiblingImport(
          './stale.js',
          join(dir, 'configBase.ts'),
          root,
          emitted,
        ),
      ).toBeUndefined();
      expect(
        resolveEmittedSiblingImport(
          './shipped.js',
          join(dir, 'configBase.ts'),
          root,
          emitted,
        ),
      ).toBeUndefined();
      expect(
        resolveEmittedSiblingImport(
          '@vybestack/llxprt-code-core/config/configBaseCore.js',
          join(dir, 'configBase.ts'),
          root,
          emitted,
          true,
        ),
      ).toBe(join(dir, 'configBaseCore.ts'));
      expect(
        resolveEmittedSiblingImport(
          '@vybestack/llxprt-code-core/config/shipped.js',
          join(dir, 'configBase.ts'),
          root,
          emitted,
          true,
        ),
      ).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('executes current TS while preserving shipped and handwritten JavaScript exports', async () => {
    const root = mkdtempSync(join(tmpdir(), 'emitted-runtime-'));
    try {
      const dir = join(root, 'packages/core/src/config');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(root, 'packages/core/package.json'),
        JSON.stringify({
          type: 'module',
          exports: { './shipped.js': './src/config/shipped.js' },
        }),
      );
      writeFileSync(join(dir, 'generated.ts'), 'export const value = 2;');
      writeFileSync(
        join(dir, 'generated.js'),
        'export const value = 1;\n//# sourceMappingURL=generated.js.map',
      );
      writeFileSync(
        join(dir, 'generated.js.map'),
        JSON.stringify({ file: 'generated.js', sources: ['generated.ts'] }),
      );
      utimesSync(
        join(dir, 'generated.ts'),
        new Date(),
        new Date(Date.now() + 10_000),
      );
      writeFileSync(join(dir, 'handwritten.ts'), 'export const value = 2;');
      writeFileSync(join(dir, 'handwritten.js'), 'export const value = 1;');
      writeFileSync(join(dir, 'upToDate.ts'), 'export const value = 2;');
      writeFileSync(
        join(dir, 'upToDate.js'),
        'export const value = 1;\n//# sourceMappingURL=upToDate.js.map',
      );
      writeFileSync(
        join(dir, 'upToDate.js.map'),
        JSON.stringify({ file: 'upToDate.js', sources: ['upToDate.ts'] }),
      );
      utimesSync(
        join(dir, 'upToDate.js'),
        new Date(),
        new Date(Date.now() + 10_000),
      );
      writeFileSync(join(dir, 'shipped.ts'), 'export const value = 2;');
      writeFileSync(
        join(dir, 'shipped.js'),
        'export const value = 1;\n//# sourceMappingURL=shipped.js.map',
      );
      writeFileSync(
        join(dir, 'shipped.js.map'),
        JSON.stringify({ file: 'shipped.js', sources: ['shipped.ts'] }),
      );
      writeFileSync(
        join(dir, 'consumer.ts'),
        "import { value as fresh } from './generated.js'; import { value as handwritten } from './handwritten.js'; import { value as upToDate } from './upToDate.js'; import { value as shipped } from './shipped.js'; console.log(JSON.stringify({ fresh, handwritten, upToDate, shipped }));",
      );
      const built = await Bun.build({
        entrypoints: [join(dir, 'consumer.ts')],
        target: 'bun',
        outdir: join(root, 'dist'),
        plugins: [sourceEmittedSiblingPlugin(root)],
      });
      expect(built.success).toBe(true);
      const child = Bun.spawnSync({
        cmd: [process.execPath, join(root, 'dist/consumer.js')],
        stdout: 'pipe',
      });
      expect(child.exitCode).toBe(0);
      expect(JSON.parse(child.stdout.toString())).toEqual({
        fresh: 2,
        handwritten: 1,
        upToDate: 1,
        shipped: 1,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
