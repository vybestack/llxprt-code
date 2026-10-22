/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect } from 'bun:test';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { BunPlugin } from 'bun';
import { pathToFileURL } from 'node:url';

export function nativePathModuleFixture(root: string): {
  readonly put: (file: string, text: string) => void;
  readonly run: (source: string) => Promise<unknown>;
} {
  // One long-name, symlink-free root: the adapter and the compiler then agree
  // on the physical prefix, whatever spelling tmpdir() produced.
  const physical = join(realpathSync.native(root), 'filesystem');
  const modules = resolve(import.meta.dir, '..');
  const adapter = join(root, 'filesystem-adapter.ts');
  const compiler = resolve(
    import.meta.dir,
    '../../node_modules/typescript/lib/typescript.js',
  );
  writeFileSync(
    adapter,
    `import * as fs from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import ts from ${JSON.stringify(compiler)};
const originalReadDirectory = ts.sys.readDirectory;
const root = ${JSON.stringify(physical)};
function native(path: string): string {
  const local = path.replaceAll('\\\\', '/');
  return local === 'C:/fixture' || local.startsWith('C:/fixture/')
    ? resolve(root, local.slice('C:/fixture/'.length))
    : path;
}
export const existsSync = (path: string): boolean => fs.existsSync(native(path));
export const readFileSync = (path: string, encoding: 'utf8' | 'utf-8'): string => fs.readFileSync(native(path), encoding);
export const readdirSync: typeof fs.readdirSync = (path, options) => fs.readdirSync(native(String(path)), options);
export const statSync = (path: string): fs.Stats => fs.statSync(native(path));
export const realpathSync = (path: string): string => path;
function fixturePath(file: string): string {
  const local = relative(root, resolve(file));
  return local === '..' || local.startsWith('..' + sep) || isAbsolute(local)
    ? file
    : 'C:/fixture/' + local.split(sep).join('/');
}
export const readDirectory: typeof ts.sys.readDirectory = (path, ...args) => originalReadDirectory(native(path), ...args).map(fixturePath);
`,
  );
  const infrastructure: BunPlugin = {
    name: 'native Windows filesystem inputs',
    setup(build) {
      build.onResolve({ filter: /(?:^typescript$|typescript\.js$)/ }, () => ({
        path: compiler,
        external: true,
      }));
      build.onLoad({ filter: /\.ts$/ }, (args) => {
        if (!args.path.startsWith(modules)) return undefined;
        return {
          contents: readFileSync(args.path, 'utf8')
            .replaceAll(
              'import.meta.url',
              JSON.stringify(pathToFileURL(args.path).href),
            )
            .replaceAll('import.meta.dir', JSON.stringify(dirname(args.path)))
            .replaceAll("from 'typescript'", `from ${JSON.stringify(compiler)}`)
            .replaceAll("from 'node:path'", "from 'node:path/win32'")
            .replaceAll("from 'node:fs'", `from ${JSON.stringify(adapter)}`),
          loader: 'ts',
        };
      });
    },
  };
  return {
    put(file, text): void {
      const path = join(physical, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
    async run(source): Promise<unknown> {
      const entry = join(root, 'entry.ts');
      writeFileSync(
        entry,
        source.replaceAll(
          "from 'typescript'",
          `from ${JSON.stringify(compiler)}`,
        ),
      );
      const built = await Bun.build({
        entrypoints: [entry],
        target: 'bun',
        outdir: join(root, 'bundle'),
        plugins: [infrastructure],
      });
      expect(built.success, built.logs.join('\n')).toBe(true);
      const child = Bun.spawnSync({
        cmd: [process.execPath, join(root, 'bundle/entry.js')],
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(child.exitCode, child.stderr.toString()).toBe(0);
      const value: unknown = JSON.parse(child.stdout.toString());
      return value;
    },
  };
}
