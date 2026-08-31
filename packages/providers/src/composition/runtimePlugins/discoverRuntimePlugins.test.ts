/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for install-driven plugin discovery (issue #2758).
 *
 * The filesystem is the only stubbed boundary; the discovery logic itself is
 * real. Each layout below is a node_modules tree the CLI could actually be
 * installed into.
 */

import { describe, expect, it } from 'bun:test';
import {
  discoverRuntimePluginPackages,
  resolvePluginSearchRoot,
} from './discoverRuntimePlugins.js';
import type { RuntimePluginDiscoveryDeps } from './discoverRuntimePlugins.js';

const NODE_MODULES = '/g/lib/node_modules';
const HOST_FILE = `${NODE_MODULES}/@vybestack/llxprt-code-providers/dist/x.js`;

interface Layout {
  readonly dirs: Record<string, string[]>;
  readonly files: Record<string, string>;
  readonly fromPath?: string;
}

function deps(layout: Layout): RuntimePluginDiscoveryDeps {
  return {
    fromPath: layout.fromPath ?? HOST_FILE,
    exists: (path) => path in layout.files || path in layout.dirs,
    listDir: (path) => layout.dirs[path] ?? [],
    readFile: (path) => {
      if (!(path in layout.files)) {
        throw new Error(`unexpected read of ${path}`);
      }
      return layout.files[path];
    },
  };
}

function manifest(name: string, isPlugin: boolean): string {
  return JSON.stringify(
    isPlugin ? { name, llxprt: { runtimePlugin: true } } : { name },
  );
}

function pkg(name: string, isPlugin: boolean): Record<string, string> {
  return { [`${NODE_MODULES}/${name}/package.json`]: manifest(name, isPlugin) };
}

describe('resolvePluginSearchRoot', () => {
  it('uses the node_modules directory that contains this package', () => {
    expect(resolvePluginSearchRoot(deps({ dirs: {}, files: {} }))).toBe(
      NODE_MODULES,
    );
  });

  it('falls back to the nearest existing node_modules in a source checkout', () => {
    // No ancestor is literally named node_modules, which is how a repo
    // checkout looks when running from source.
    const root = '/repo/node_modules';
    expect(
      resolvePluginSearchRoot(
        deps({
          dirs: { [root]: [] },
          files: {},
          fromPath: '/repo/packages/providers/src/x.ts',
        }),
      ),
    ).toBe(root);
  });
});

describe('discoverRuntimePluginPackages', () => {
  it('returns nothing when no installed package declares the marker', () => {
    expect(
      discoverRuntimePluginPackages(
        deps({
          dirs: { [NODE_MODULES]: ['plain-package'] },
          files: { ...pkg('plain-package', false) },
        }),
      ),
    ).toStrictEqual([]);
  });

  it('finds a package that declares the marker regardless of its name', () => {
    // Discovery is by declaration, not naming convention, so a third-party
    // package may be called anything.
    expect(
      discoverRuntimePluginPackages(
        deps({
          dirs: { [NODE_MODULES]: ['kookoo'] },
          files: { ...pkg('kookoo', true) },
        }),
      ),
    ).toStrictEqual(['kookoo']);
  });

  it('finds scoped packages', () => {
    expect(
      discoverRuntimePluginPackages(
        deps({
          dirs: {
            [NODE_MODULES]: ['@acme'],
            [`${NODE_MODULES}/@acme`]: ['provider'],
          },
          files: { ...pkg('@acme/provider', true) },
        }),
      ),
    ).toStrictEqual(['@acme/provider']);
  });

  it('returns discovered packages in deterministic alphabetical order', () => {
    // Load order fixes contributed-alias order, so it must not depend on the
    // filesystem's listing order.
    const discovered = discoverRuntimePluginPackages(
      deps({
        dirs: { [NODE_MODULES]: ['zeta-provider', 'alpha-provider'] },
        files: {
          ...pkg('zeta-provider', true),
          ...pkg('alpha-provider', true),
        },
      }),
    );

    expect(discovered).toStrictEqual(['alpha-provider', 'zeta-provider']);
  });

  it('ignores dot directories such as .bin', () => {
    expect(
      discoverRuntimePluginPackages(
        deps({
          dirs: { [NODE_MODULES]: ['.bin', 'real-provider'] },
          files: { ...pkg('real-provider', true) },
        }),
      ),
    ).toStrictEqual(['real-provider']);
  });

  it('ignores a package whose marker is present but not true', () => {
    expect(
      discoverRuntimePluginPackages(
        deps({
          dirs: { [NODE_MODULES]: ['off-provider'] },
          files: {
            [`${NODE_MODULES}/off-provider/package.json`]: JSON.stringify({
              name: 'off-provider',
              llxprt: { runtimePlugin: false },
            }),
          },
        }),
      ),
    ).toStrictEqual([]);
  });

  it('ignores a neighbouring package with an unparseable manifest', () => {
    // A broken package that never claimed to be a plugin must not stop the
    // CLI from starting. A plugin has to declare the marker to be one.
    expect(
      discoverRuntimePluginPackages(
        deps({
          dirs: { [NODE_MODULES]: ['broken', 'good-provider'] },
          files: {
            [`${NODE_MODULES}/broken/package.json`]: '{ not json',
            ...pkg('good-provider', true),
          },
        }),
      ),
    ).toStrictEqual(['good-provider']);
  });

  it('ignores a directory with no package.json', () => {
    expect(
      discoverRuntimePluginPackages(
        deps({ dirs: { [NODE_MODULES]: ['stray-dir'] }, files: {} }),
      ),
    ).toStrictEqual([]);
  });
});
