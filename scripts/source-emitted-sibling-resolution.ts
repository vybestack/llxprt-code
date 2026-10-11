/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { plugin } from 'bun';
import type { BunPlugin } from 'bun';
import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { compilerEmittedSiblings } from './compiler-emitted-siblings.js';

export function resolveEmittedSiblingImport(
  specifier: string,
  importer: string,
  repoRoot: string,
  emitted: ReadonlySet<string>,
  packageAliases = false,
): string | undefined {
  const packageRoots = [
    ['@vybestack/llxprt-code-core/', 'packages/core/src/'],
    ['@vybestack/llxprt-code-mcp/', 'packages/mcp/src/'],
  ];
  const packageRoot = packageAliases
    ? packageRoots.find(([prefix]) => specifier.startsWith(prefix))
    : undefined;
  if (
    packageRoot === undefined &&
    !specifier.startsWith('./') &&
    !specifier.startsWith('../')
  ) {
    return undefined;
  }
  const javascript =
    packageRoot === undefined
      ? resolve(dirname(importer), specifier)
      : resolve(
          repoRoot,
          packageRoot[1],
          specifier.slice(packageRoot[0].length),
        );
  const relativePath = relative(repoRoot, javascript).replaceAll('\\', '/');
  return emitted.has(relativePath)
    ? javascript.slice(0, -3) + '.ts'
    : undefined;
}

function emittedSiblingPlugin(
  repoRoot: string,
  sourceFirst: boolean,
  packageConfigIdentity = false,
): BunPlugin {
  const physicalRoot = realpathSync(repoRoot);
  const emitted = new Set(
    compilerEmittedSiblings(physicalRoot).filter((path) => {
      if (!path.endsWith('.js')) return false;
      const javascript = resolve(physicalRoot, path);
      const source = javascript.slice(0, -3) + '.ts';
      return (
        sourceFirst || statSync(source).mtimeMs > statSync(javascript).mtimeMs
      );
    }),
  );
  const siblingNames = [...new Set([...emitted].map((path) => basename(path)))];
  const filter = new RegExp(
    `(?:^|/)(?:${siblingNames
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')})$`,
  );
  return {
    name: sourceFirst
      ? releaseSourceEmittedSiblingPlugin.name
      : 'test source resolution for compiler-emitted siblings',
    setup(build) {
      if (packageConfigIdentity) {
        // Bun gives a redirected package subpath a different Config identity and
        // cannot mock that redirected file URL. Re-export the native Bun package
        // subpath from relative Core imports so both routes share its class.
        build.onLoad(
          { filter: /^config$/, namespace: 'core-config-source-identity' },
          () => ({
            contents:
              "export * from '@vybestack/llxprt-code-core/config/config.js';",
            loader: 'ts',
          }),
        );
      }
      build.onResolve({ filter, namespace: 'file' }, ({ path, importer }) => {
        const source = resolveEmittedSiblingImport(
          path,
          importer,
          physicalRoot,
          emitted,
          sourceFirst,
        );
        if (source === undefined) return undefined;
        if (
          packageConfigIdentity &&
          source === resolve(physicalRoot, 'packages/core/src/config/config.ts')
        ) {
          return { path: 'config', namespace: 'core-config-source-identity' };
        }
        return { path: source };
      });
    },
  };
}

export function sourceEmittedSiblingPlugin(
  repoRoot: string,
  packageConfigIdentity = false,
): BunPlugin {
  return emittedSiblingPlugin(repoRoot, false, packageConfigIdentity);
}

export function releaseSourceEmittedSiblingPlugin(repoRoot: string): BunPlugin {
  return emittedSiblingPlugin(repoRoot, true);
}

export function installSourceEmittedSiblingResolution(
  repoRoot: string,
  packageConfigIdentity = false,
): void {
  plugin(sourceEmittedSiblingPlugin(repoRoot, packageConfigIdentity));
}
