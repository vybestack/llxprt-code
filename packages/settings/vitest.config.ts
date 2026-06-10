/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * @requirement REQ-DEP-001
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const settingsPackagePrefix = '@vybestack/llxprt-code-settings/';
const settingsEntry = fileURLToPath(new URL('./index.ts', import.meta.url));
const settingsSrcDir = fileURLToPath(new URL('./src/', import.meta.url));

const storagePackagePrefix = '@vybestack/llxprt-code-storage/';
const storageEntry = fileURLToPath(
  new URL('../storage/index.ts', import.meta.url),
);
const storageSrcDir = fileURLToPath(
  new URL('../storage/src/', import.meta.url),
);

/**
 * Storage deep-path export mapping mirrors package.json "exports" field.
 * Export subpaths like "./storage/secure-store.js" map to source dirs like "secure-store/".
 */
const storageExportToSource: Record<string, string> = {
  'config/storage': 'config/storage',
  'services/fileSystemService': 'services/fileSystemService',
  'services/fileDiscoveryService': 'services/fileDiscoveryService',
  'storage/secure-store': 'secure-store/secure-store',
  'storage/provider-key-storage': 'secure-store/provider-key-storage',
  'storage/sessionTypes': 'session/sessionTypes',
  'storage/ConversationFileWriter': 'conversation/ConversationFileWriter',
};

function resolveTsSource(baseDir: string, specifier: string): string | null {
  const direct = baseDir + specifier;
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

const workspaceAliasPlugin = {
  name: 'llxprt-settings-workspace-source-aliases',
  enforce: 'pre' as const,
  resolveId(source: string) {
    if (source === '@vybestack/llxprt-code-settings') {
      return settingsEntry;
    }
    if (source.startsWith(settingsPackagePrefix)) {
      return resolveTsSource(
        settingsSrcDir,
        source.slice(settingsPackagePrefix.length),
      );
    }
    if (source === '@vybestack/llxprt-code-storage') {
      return storageEntry;
    }
    if (source.startsWith(storagePackagePrefix)) {
      const subPath = source
        .slice(storagePackagePrefix.length)
        .replace(/\.js$/, '');
      const sourcePath = storageExportToSource[subPath];
      if (sourcePath) {
        const tsPath = storageSrcDir + sourcePath + '.ts';
        if (existsSync(tsPath)) {
          return tsPath;
        }
      }
      return resolveTsSource(
        storageSrcDir,
        source.slice(storagePackagePrefix.length),
      );
    }
    return null;
  },
};

const isWindows = process.platform === 'win32';
const isMacCi = process.platform === 'darwin' && process.env.CI === 'true';
const shouldUseForkPool = isWindows || isMacCi;

export default defineConfig({
  plugins: [workspaceAliasPlugin],
  test: {
    passWithNoTests: true,
    reporters: ['default', 'junit'],
    testTimeout: 30000,
    teardownTimeout: 120000,
    silent: true,
    dangerouslyIgnoreUnhandledErrors: isWindows,
    pool: shouldUseForkPool ? 'forks' : undefined,
    poolOptions: shouldUseForkPool
      ? {
          forks: {
            minForks: 1,
            maxForks: 2,
          },
        }
      : undefined,
    outputFile: {
      junit: 'junit.xml',
    },
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*'],
      reporter: [
        ['text'],
        ['json-summary', { outputFile: 'coverage-summary.json' }],
      ],
    },
  },
});
