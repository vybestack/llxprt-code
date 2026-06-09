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
