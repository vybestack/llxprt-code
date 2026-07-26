/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest" />
import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import {
  buildTestGroups,
  INCLUDE_PATTERNS,
  BASE_EXCLUDE_PATTERNS,
} from './vitest.test-groups.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const inkStubPath = resolve(__dirname, './test-utils/ink-stub.ts');
const inkTestingLibraryPath = resolve(
  __dirname,
  './test-utils/ink-testing-library.ts',
);
const inkTestingLibraryActualPath = resolve(
  __dirname,
  '../../node_modules/ink-testing-library/build/index.js',
);
// Resolve ajv/fdir dynamically (see ajv2020Entry/fdirEntry below) instead of
// hardcoding nested node_modules paths, which break when npm hoists these
// packages differently after dependency version changes.
const ajvCjsEntry = require.resolve('ajv/dist/ajv.js');
const providersPackagePrefix = '@vybestack/llxprt-code-providers/';
const corePackagePrefix = '@vybestack/llxprt-code-core/';
const storagePackagePrefix = '@vybestack/llxprt-code-storage/';
const settingsPackagePrefix = '@vybestack/llxprt-code-settings/';
const ideIntegrationPackagePrefix = '@vybestack/llxprt-code-ide-integration/';
const agentsPackagePrefix = '@vybestack/llxprt-code-agents/';
const providersEntry = resolve(__dirname, '../providers/index.ts');
const providersSrcDir = resolve(__dirname, '../providers/src/') + '/';
const coreEntry = resolve(__dirname, '../core/index.ts');
const coreSrcDir = resolve(__dirname, '../core/src/') + '/';
const storageEntry = resolve(__dirname, '../storage/index.ts');
const storageSrcDir = resolve(__dirname, '../storage/src/') + '/';

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
  'storage/envelope-codec': 'secure-store/envelope-codec',
  'storage/sessionTypes': 'session/sessionTypes',
  'storage/ConversationFileWriter': 'conversation/ConversationFileWriter',
};
const settingsEntry = resolve(__dirname, '../settings/index.ts');
const settingsSrcDir = resolve(__dirname, '../settings/src/') + '/';
const ideIntegrationEntry = resolve(__dirname, '../ide-integration/index.ts');
const ideIntegrationSrcDir =
  resolve(__dirname, '../ide-integration/src/') + '/';
const agentsEntry = resolve(__dirname, '../agents/index.ts');
const agentsSrcDir = resolve(__dirname, '../agents/src/') + '/';

function resolveTsSource(baseDir: string, specifier: string): string {
  const direct = baseDir + specifier;
  if (direct.endsWith('.js')) {
    const withoutExt = direct.slice(0, -3);
    const tsPath = withoutExt + '.ts';
    if (existsSync(tsPath)) {
      return tsPath;
    }
    // Barrel exports (e.g. "./auth.js" -> "dist/src/auth/index.js") map a
    // file-like subpath onto a directory's index module. Mirror that here so
    // vitest source resolution finds "<subpath>/index.ts".
    const indexTsPath = withoutExt + '/index.ts';
    if (existsSync(indexTsPath)) {
      return indexTsPath;
    }
  }
  return direct;
}

const workspaceAliasPlugin = {
  name: 'llxprt-cli-workspace-source-aliases',
  enforce: 'pre' as const,
  /**
   * @plan:PLAN-20260603-ISSUE1584.P16
   * @requirement:REQ-VERIFY-001
   * @pseudocode verification.md lines 19-22
   */
  resolveId(source: string) {
    if (source === '@vybestack/llxprt-code-providers') {
      return providersEntry;
    }
    if (source.startsWith(providersPackagePrefix)) {
      return resolveTsSource(
        providersSrcDir,
        source.slice(providersPackagePrefix.length),
      );
    }
    if (source === '@vybestack/llxprt-code-core') {
      return coreEntry;
    }
    if (source.startsWith(corePackagePrefix)) {
      return resolveTsSource(
        coreSrcDir,
        source.slice(corePackagePrefix.length),
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
    // @plan PLAN-20260608-ISSUE1588.P03b — settings source alias
    if (source === '@vybestack/llxprt-code-settings') {
      return settingsEntry;
    }
    if (source.startsWith(settingsPackagePrefix)) {
      return resolveTsSource(
        settingsSrcDir,
        source.slice(settingsPackagePrefix.length),
      );
    }
    if (source === '@vybestack/llxprt-code-ide-integration') {
      return ideIntegrationEntry;
    }
    if (source.startsWith(ideIntegrationPackagePrefix)) {
      return resolveTsSource(
        ideIntegrationSrcDir,
        source.slice(ideIntegrationPackagePrefix.length),
      );
    }
    if (source === '@vybestack/llxprt-code-agents') {
      return agentsEntry;
    }
    if (source.startsWith(agentsPackagePrefix)) {
      return resolveTsSource(
        agentsSrcDir,
        source.slice(agentsPackagePrefix.length),
      );
    }
    if (source === 'ajv/dist/2020.js') {
      return ajv2020Entry;
    }
    if (source === 'ajv') {
      return ajvCjsEntry;
    }
    if (source === 'fdir') {
      return fdirEntry;
    }
    return null;
  },
};

const ajv2020Entry = require.resolve('ajv/dist/2020.js');
const fdirEntry = resolve(
  dirname(require.resolve('fdir/package.json')),
  'dist/index.mjs',
);

const isMultiRuntimeGuardrailRun =
  process.argv.includes('--run') &&
  process.argv.includes('provider-multi-runtime');

// Build the three disjoint routing groups from source requirements. The
// helper discovers the exact same file set using the authoritative
// include/exclude contract, then splits it into pure-node, react-ink-node,
// and jsdom groups so the node-majority can skip per-file jsdom environment
// cost. Group test paths are already normalized package-relative.
const testGroups = buildTestGroups({
  multiRuntimeGuardrail: isMultiRuntimeGuardrailRun,
});

// Authoritative exclude contract consumed from the helper. When the
// multi-runtime guardrail argv is present, the integration exclude is removed
// by the helper's buildExclude and reflected here via re-derivation.
const INTEGRATION_EXCLUDE = '**/*.integration.{test,spec}.?(c|m)[jt]s?(x)';
const baseExcludePatterns = isMultiRuntimeGuardrailRun
  ? BASE_EXCLUDE_PATTERNS.filter((p) => p !== INTEGRATION_EXCLUDE)
  : BASE_EXCLUDE_PATTERNS;

// Shared Vite-level config that each routing project must carry so workspace
// source aliases resolve identically to the root. Projects without
// `extends: true` do not inherit root plugins/resolve, so they re-declare them.
const projectResolve = {
  conditions: ['node', 'import', 'module', 'browser', 'default'],
  extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json'],
  alias: {
    'ajv/dist/2020.js': ajv2020Entry,
    ajv: ajvCjsEntry,
    fdir: fdirEntry,
    ink: inkStubPath,
    'ink-testing-library': inkTestingLibraryPath,
    [inkTestingLibraryActualPath]: inkTestingLibraryPath,
    react: resolve(__dirname, '../../node_modules/react'),
  },
};

const sharedTestOptions = {
  exclude: ['**/node_modules/**', '**/dist/**'],
  globals: true,
  silent: true,
  reporters: ['default', 'junit'],
  outputFile: { junit: 'junit.xml' },
  poolOptions: {
    threads: { singleThread: true, maxThreads: 2 },
  },
  testTimeout: 30000,
  hookTimeout: 30000,
};

// Detect whether this config is being loaded as the primary/invoked config
// or imported by a sibling config (agentStream, mutation). Sibling configs
// are always invoked with an explicit config path that differs from this
// file. When no explicit sibling config path appears in argv, this is the
// main config invocation and routing projects should be attached.
const configFlagIndex = process.argv.findIndex(
  (argument) => argument === '--config' || argument === '-c',
);
const separateConfig =
  configFlagIndex < 0 ? undefined : process.argv[configFlagIndex + 1];
const inlineConfig = process.argv
  .find((argument) => argument.startsWith('--config='))
  ?.slice('--config='.length);
const explicitConfig = separateConfig ?? inlineConfig;
const isMainConfig =
  explicitConfig === undefined ||
  resolve(process.cwd(), explicitConfig) ===
    resolve(__dirname, 'vitest.config.ts');

// Routing projects built from typed group objects. Each project carries the
// workspace alias plugin and resolve config so module resolution works
// identically to the root.
const routingProjects = testGroups.map((group) => ({
  plugins: [workspaceAliasPlugin],
  resolve: projectResolve,
  test: {
    ...sharedTestOptions,
    name: group.name,
    environment: group.environment,
    setupFiles: [group.setupFile],
    include: group.testFiles,
    ...(group.environment === 'jsdom'
      ? {
          environmentOptions: {
            jsdom: {
              resources: 'usable',
              runScripts: 'dangerously',
            },
          },
        }
      : {}),
  },
}));

export default defineConfig({
  plugins: [workspaceAliasPlugin],
  root: __dirname,
  resolve: {
    conditions: ['node', 'import', 'module', 'browser', 'default'],
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json'],
    alias: {
      /**
       * @plan:PLAN-20260603-ISSUE1584.P16
       * @requirement:REQ-VERIFY-001
       * @pseudocode verification.md lines 19-22
       */
      'ajv/dist/2020.js': ajv2020Entry,
      ajv: ajvCjsEntry,
      fdir: fdirEntry,
      ink: inkStubPath,
      'ink-testing-library': inkTestingLibraryPath,
      [inkTestingLibraryActualPath]: inkTestingLibraryPath,
      react: resolve(__dirname, '../../node_modules/react'),
    },
  },
  test: {
    include: INCLUDE_PATTERNS,
    exclude: baseExcludePatterns,
    environment: 'jsdom',
    globals: true,
    reporters: ['default', 'junit'],
    silent: true,
    outputFile: {
      junit: 'junit.xml',
    },
    setupFiles: ['./test-setup.ts'],
    poolOptions: {
      threads: {
        singleThread: true, // Run tests sequentially to reduce memory pressure
        maxThreads: 2, // Limit parallelism
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    environmentOptions: {
      jsdom: {
        resources: 'usable',
        runScripts: 'dangerously',
      },
    },
    // Three disjoint routing projects split by source requirements. Each
    // project carries the workspace alias plugin and resolve config so module
    // resolution works identically to the root. Pure-node files skip the
    // per-file jsdom environment cost entirely.
    //
    // Projects are attached only when this config is the active/invoked
    // config — not when a sibling config (agentStream, mutation) imports it
    // via mergeConfig/spread. This prevents test.projects from leaking
    // through and causing sibling runs to enumerate the full group set.
    projects: isMainConfig ? routingProjects : undefined,
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*'],
      reporter: [
        ['text', { file: 'full-text-summary.txt' }],
        ['json-summary', { outputFile: 'coverage-summary.json' }],
      ],
    },
  },
});
