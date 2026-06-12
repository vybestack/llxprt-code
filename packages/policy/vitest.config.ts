import { existsSync } from 'node:fs';
import { sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const policyPackagePrefix = '@vybestack/llxprt-code-policy/';
const policyEntry = fileURLToPath(new URL('./index.ts', import.meta.url));
const policySrcDir = fileURLToPath(new URL('./src/', import.meta.url));

function resolveTsSource(baseDir: string, specifier: string): string | null {
  // Guard against path traversal: the resolved path must stay within baseDir.
  const baseRoot = resolve(baseDir);
  const direct = resolve(baseRoot, specifier);
  if (direct !== baseRoot && !direct.startsWith(baseRoot + sep)) {
    return null;
  }
  if (direct.endsWith('.js')) {
    const tsPath = direct.slice(0, -3) + '.ts';
    if (existsSync(tsPath)) {
      return tsPath;
    }
  }
  if (existsSync(direct)) {
    return direct;
  }
  return null;
}

const workspaceDependencyAliasPlugin = {
  name: 'llxprt-policy-workspace-dependency-aliases',
  enforce: 'pre' as const,
  resolveId(source: string) {
    if (source === '@vybestack/llxprt-code-policy') {
      return policyEntry;
    }
    if (source.startsWith(policyPackagePrefix)) {
      return resolveTsSource(
        policySrcDir,
        source.slice(policyPackagePrefix.length),
      );
    }
    return null;
  },
};

export default defineConfig({
  plugins: [workspaceDependencyAliasPlugin],
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    setupFiles: ['./test-setup.ts'],
    server: {
      deps: {
        inline: ['@vybestack/llxprt-code-policy'],
      },
    },
  },
});
