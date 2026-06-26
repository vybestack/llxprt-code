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
  'storage/sessionTypes': 'session/sessionTypes',
  'storage/ConversationFileWriter': 'conversation/ConversationFileWriter',
};
const settingsEntry = resolve(__dirname, '../settings/index.ts');
const settingsSrcDir = resolve(__dirname, '../settings/src/') + '/';
const ideIntegrationEntry = resolve(__dirname, '../ide-integration/index.ts');
const ideIntegrationSrcDir =
  resolve(__dirname, '../ide-integration/src/') + '/';

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

const baseExcludePatterns = [
  '**/node_modules/**',
  '**/dist/**',
  '**/tmp/**',
  '**/cypress/**',
  '**/*.integration.{test,spec}.?(c|m)[jt]s?(x)',
  // Temporarily exclude ALL React DOM tests that have React 19 compatibility issues
  // This is a comprehensive exclusion until React 19 compatibility is properly resolved
  // EXCEPT KeypressContext.test.tsx which we're actively working on for issue #263
  // EXCEPT ThinkingBlockDisplay.test.tsx for Phase P04
  '**/test-utils/**/*.test.tsx',
  '**/ui/App.e2e.test.tsx',
  '**/ui/App.test.tsx',
  // App.test.tsx split into cohesive shards (issue #2114, max-lines); all
  // share the same ink reconciler setup and remain lint-only like the parent.
  '**/ui/App.context.test.tsx',
  '**/ui/App.components.test.tsx',
  '**/ui/App.dialogs.test.tsx',
  '**/ui/App.behavior.test.tsx',
  // '**/ui/commands/directoryCommand.test.tsx', // Temporarily enabled for trust gating implementation (9786c4dcf)
  // React 19 / ink-stub incompatible — ALL ui/components/*.test.tsx render empty in jsdom
  '**/ui/components/*.test.tsx',
  '**/ui/components/__tests__/*.test.tsx',
  // SessionBrowserDialog - ink-testing-library/ink-stub reconciler conflict (issue #1385)
  // Tests pass individually but fail when run in sequence due to global ink mock
  '**/ui/components/__tests__/SessionBrowserDialog*.spec.tsx',
  '**/ui/components/messages/DiffRenderer.test.tsx',
  // GeminiMessage/ToolMessage - behavioral tests excluded due to ink-testing-library/ink-stub
  // incompatibility in CI (renders empty string). Tests pass locally but fail in CI.
  // Issue #1034 converted them from snapshot to behavioral tests but CI rendering issue remains.
  '**/ui/components/messages/GeminiMessage.test.tsx',
  '**/ui/components/messages/ToolMessage.test.tsx',
  '**/ui/components/messages/ToolConfirmationMessage.responsive.test.tsx',
  '**/ui/components/messages/ToolConfirmationMessage.test.tsx',
  '**/ui/components/messages/ToolGroupMessage.test.tsx',
  // ThinkingBlockDisplay - ink-testing-library doesn't render styled Text in NO_COLOR mode
  '**/ui/components/messages/ThinkingBlockDisplay.test.tsx',
  '**/ui/components/messages/WarningMessage.test.tsx',
  '**/ui/components/shared/*.test.tsx',
  '**/ui/components/views/*.test.tsx',
  '**/ui/containers/*.test.tsx',
  '**/ui/contexts/SessionContext.test.tsx',
  '**/ui/hooks/useEditorSettings.test.tsx',
  '**/ui/hooks/useReverseSearchCompletion.test.tsx',
  '**/ui/hooks/useGeminiStream.integration.test.tsx',
  '**/ui/hooks/useGeminiStream.test.tsx',
  // useGeminiStream.test.tsx split into cohesive shards (issue #2114,
  // max-lines); all share the same React 19 setup and remain lint-only like
  // the parent. Exact paths so the runnable dedup/subagent/thinking/ordering
  // siblings are not matched.
  '**/ui/hooks/useGeminiStream.cancellation.test.tsx',
  '**/ui/hooks/useGeminiStream.usercancel.test.tsx',
  '**/ui/hooks/useGeminiStream.commands.test.tsx',
  '**/ui/hooks/useGeminiStream.approval.test.tsx',
  '**/ui/hooks/useGeminiStream.finished.test.tsx',
  '**/ui/hooks/useGeminiStream.include.test.tsx',
  '**/ui/hooks/useGeminiStream.thought.test.tsx',
  '**/ui/hooks/useGeminiStream.loopdetect.test.tsx',
  '**/ui/hooks/useGeminiStream.hooks.test.tsx',
  '**/ui/hooks/useGeminiStream.mcp.test.tsx',
  '**/ui/hooks/useKeypress.test.tsx',
  '**/ui/hooks/usePermissionsModifyTrust.test.tsx',
  '**/ui/privacy/**/*.test.tsx',
  '**/ui/utils/**/*.test.tsx',
  // '**/gemini.test.tsx', // Temporarily enabled for terminal mode cleanup (ba88707b1 reimplementation)
  // Exclude UI component tests that may directly import React DOM
  '**/ui/components/**/*.test.ts',
  // Temporarily suppress remaining React 19 regressions until the hooks are migrated
  // EXCEPT useToolScheduler.test.ts which we're actively working on for issue #1055
  '**/ui/hooks/useEditorSettings.test.ts',
  '**/ui/hooks/useReverseSearchCompletion.test.ts',
  '**/ui/hooks/useGeminiStream.test.ts',
  '**/ui/hooks/useGeminiStream.integration.test.ts',
  '**/ui/hooks/useKeypress.test.ts',
  '**/ui/hooks/usePermissionsModifyTrust.test.ts',
  // Block the command test that still imports the legacy runtime helpers
  '**/ui/commands/toolformatCommand.test.ts',
];

if (isMultiRuntimeGuardrailRun) {
  const integrationIndex = baseExcludePatterns.indexOf(
    '**/*.integration.{test,spec}.?(c|m)[jt]s?(x)',
  );
  if (integrationIndex >= 0) {
    baseExcludePatterns.splice(integrationIndex, 1);
  }
}

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
    include: [
      '**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'config.test.ts',
      // Temporarily include KeypressContext test for issue #263
      'src/ui/contexts/KeypressContext.test.tsx',
      'src/ui/contexts/KeypressContext.parsing.test.tsx',
      // ThinkingBlockDisplay test excluded - ink-testing-library doesn't render styled Text in NO_COLOR mode
      // Include useGeminiStream thinking test for Phase P07
      'src/ui/hooks/useGeminiStream.thinking.test.tsx',
      'src/ui/hooks/useGeminiStream.ordering.test.tsx',
      // Include useGeminiStream dedup test for issue #1040
      'src/ui/hooks/useGeminiStream.dedup.test.tsx',
      // Include useToolScheduler test for issue #1055 - Phase 2
      'src/ui/hooks/useToolScheduler.test.ts',
      // Include OAuthUrlMessage test (migrated from @testing-library/react)
      'src/ui/components/messages/OAuthUrlMessage.test.tsx',
      // Include useSlashCompletion extension filtering tests for fa93b56243 reimplementation
      'src/ui/hooks/useSlashCompletion.extensions.test.tsx',
      // Include gemini test for terminal mode cleanup (ba88707b1 reimplementation)
      'src/gemini.test.tsx',
      // Include directoryCommand test for trust gating implementation (9786c4dcf reimplementation)
      'src/ui/commands/directoryCommand.test.tsx',
      // Include ProfileChangeMessage test for cleanup-plan ab11b2c27
      'src/ui/components/messages/ProfileChangeMessage.test.tsx',
      // Include HistoryItemDisplay test for cleanup-plan ab11b2c27
      'src/ui/components/HistoryItemDisplay.test.tsx',
      // Include useTodoContinuation test for issue #1277
      'src/ui/hooks/useTodoContinuation.spec.ts',
      // Include HooksList test for audit issue #8
      'src/ui/components/views/HooksList.test.tsx',
      // NOTE: ui/components/*.test.tsx are all excluded due to React 19/ink-stub incompatibility.
      // StatsDisplay, ModelStatsDisplay, etc. must be run individually outside the suite.
    ],
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
