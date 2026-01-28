/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const inkStubPath = resolve(__dirname, './test-utils/ink-stub.ts');

const isMultiRuntimeGuardrailRun =
  process.argv.includes('--run') &&
  process.argv.includes('provider-multi-runtime');

const baseExcludePatterns = [
  '**/node_modules/**',
  '**/dist/**',
  '**/cypress/**',
  '**/*.integration.{test,spec}.?(c|m)[jt]s?(x)',
  // Temporarily exclude ALL React DOM tests that have React 19 compatibility issues
  // This is a comprehensive exclusion until React 19 compatibility is properly resolved
  // EXCEPT KeypressContext.test.tsx which we're actively working on for issue #263
  // EXCEPT ThinkingBlockDisplay.test.tsx for Phase P04
  '**/test-utils/**/*.test.tsx',
  '**/ui/App.e2e.test.tsx',
  '**/ui/App.test.tsx',
  '**/ui/commands/directoryCommand.test.tsx',
  '**/ui/components/*.test.tsx',
  '**/ui/components/__tests__/*.test.tsx',
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
  '**/ui/hooks/useKeypress.test.tsx',
  '**/ui/hooks/usePermissionsModifyTrust.test.tsx',
  '**/ui/privacy/**/*.test.tsx',
  '**/ui/utils/**/*.test.tsx',
  '**/gemini.test.tsx',
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
  '**/ui/hooks/**/*.spec.ts',
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
  root: __dirname,
  resolve: {
    conditions: ['node', 'import', 'module', 'browser', 'default'],
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json'],
    alias: {
      ink: inkStubPath,
    },
  },
  test: {
    include: [
      '**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'config.test.ts',
      // Temporarily include KeypressContext test for issue #263
      'src/ui/contexts/KeypressContext.test.tsx',
      // ThinkingBlockDisplay test excluded - ink-testing-library doesn't render styled Text in NO_COLOR mode
      // Include useGeminiStream thinking test for Phase P07
      'src/ui/hooks/useGeminiStream.thinking.test.tsx',
      // Include useGeminiStream dedup test for issue #1040
      'src/ui/hooks/useGeminiStream.dedup.test.tsx',
      // Include useToolScheduler test for issue #1055 - Phase 2
      'src/ui/hooks/useToolScheduler.test.ts',
      // Include OAuthUrlMessage test (migrated from @testing-library/react)
      'src/ui/components/messages/OAuthUrlMessage.test.tsx',
      // Include useSlashCompletion extension filtering tests for fa93b56243 reimplementation
      'src/ui/hooks/useSlashCompletion.extensions.test.tsx',
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
        'html',
        'json',
        'lcov',
        'cobertura',
        ['json-summary', { outputFile: 'coverage-summary.json' }],
      ],
    },
  },
});
