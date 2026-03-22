/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import vitest from '@vitest/eslint-plugin';
import sonarjs from 'eslint-plugin-sonarjs';
import eslintComments from 'eslint-plugin-eslint-comments';
import globals from 'globals';
import headers from 'eslint-plugin-headers';
import reactRenderSafety from './eslint-rules/react-render-safety.js';
import noInlineDeps from './eslint-rules/no-inline-deps.js';
import inkTextColorRequired from './eslint-rules/ink-text-color-required.js';
import path from 'node:path';
import url from 'node:url';

// --- ESM way to get __dirname ---
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// --- ---

// Determine the monorepo root (assuming eslint.config.js is at the root)
const projectRoot = __dirname;

export default tseslint.config(
  {
    // Global ignores
    ignores: [
      'node_modules/*',
      '.yalc/**',
      '**/.yalc/**',
      'yalc.lock',
      '**/yalc.lock',
      '.integration-tests/**',
      'eslint.config.js',
      'packages/**/dist/**',
      'bundle/**',
      'packages/cli/src/test-*.ts',
      'packages/cli/src/test-*.tsx',
      'packages/cli/src/debug-*.ts',
      'packages/cli/src/debug-*.tsx',
      'debug-*.js',
      'test-*.js',
      'test-*.mjs',
      'suppress-deprecations.mjs',
      'reference/**',
      'research/**',
      'tmp/**',
      'package/bundle/**',
      '.integration-tests/**',
      '.stryker-tmp/**',
      '**/.stryker-tmp/**',
      'project-plans/**',
      'packages/opentui/**',
      'packages/ui/**',
      'packages/lsp/**',
      'evals/**',
      'packages/test-utils/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs['recommended-latest'],
  reactPlugin.configs.flat.recommended,
  reactPlugin.configs.flat['jsx-runtime'], // Add this if you are using React 17+
  {
    // Settings for eslint-plugin-react
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    // Import specific config
    files: ['packages/cli/src/**/*.{ts,tsx}'], // Target only TS/TSX in the cli package
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        node: true,
      },
    },
    rules: {
      ...importPlugin.configs.recommended.rules,
      ...importPlugin.configs.typescript.rules,
      'import/no-default-export': 'warn',
      'import/no-unresolved': 'off', // Disable for now, can be noisy with monorepos/paths
    },
  },
  {
    // General overrides and rules for the project (TS/TSX files)
    files: ['packages/*/src/**/*.{ts,tsx}'], // Target only TS/TSX in the cli package
    plugins: {
      import: importPlugin,
      sonarjs,
      'eslint-comments': eslintComments,
    },
    settings: {
      'import/resolver': {
        node: true,
      },
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: projectRoot,
      },
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      // General Best Practice Rules (subset adapted for flat config)
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      'arrow-body-style': ['error', 'as-needed'],
      curly: ['error', 'multi-line'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as' },
      ],
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'no-public' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-inferrable-types': [
        'error',
        { ignoreParameters: true, ignoreProperties: true },
      ],
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Prevent async errors from bypassing catch handlers
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      'import/no-internal-modules': [
        'error',
        {
          allow: [
            'react-dom/test-utils',
            'memfs/lib/volume.js',
            'vscode-jsonrpc/node.js',
            'yargs/**',
            '@anthropic-ai/sdk/**',
            '**/generated/**',
          ],
        },
      ],
      'import/no-relative-packages': 'error',
      'no-cond-assign': 'error',
      'no-debugger': 'error',
      'no-duplicate-case': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="require"]',
          message: 'Avoid using require(). Use ES6 imports instead.',
        },
        {
          selector: 'ThrowStatement > Literal:not([value=/^\\w+Error:/])',
          message:
            'Do not throw string literals or non-Error objects. Throw new Error("...") instead.',
        },
      ],
      'no-unsafe-finally': 'error',
      'no-unused-expressions': 'off', // Disable base rule
      '@typescript-eslint/no-unused-expressions': [
        // Enable TS version
        'error',
        { allowShortCircuit: true, allowTernary: true },
      ],
      'no-var': 'error',
      'object-shorthand': 'error',
      'one-var': ['error', 'never'],
      'prefer-arrow-callback': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'no-console': 'error',
      radix: 'error',
      'default-case': 'error',
      '@typescript-eslint/await-thenable': ['error'],
      '@typescript-eslint/no-floating-promises': ['error'],
      '@typescript-eslint/no-unnecessary-type-assertion': ['error'],

      // --- Strict rules modeled after lsp/ui packages (enabled as warnings for core/cli) ---

      // Strict TypeScript rules
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/strict-boolean-expressions': [
        'warn',
        {
          allowString: true,
          allowNumber: false,
          allowNullableObject: true,
          allowNullableBoolean: false,
          allowNullableString: true,
          allowNullableNumber: false,
          allowAny: false,
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'warn',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'warn',

      // General code quality
      'no-console': 'warn',
      'no-else-return': 'warn',
      'no-lonely-if': 'warn',
      'no-unneeded-ternary': 'warn',

      // Complexity limits
      complexity: ['warn', 15],
      'max-lines': [
        'warn',
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'warn',
        { max: 80, skipBlankLines: true, skipComments: true },
      ],

      // Sonarjs rules (spread recommended as warnings, then override specifics)
      ...Object.fromEntries(
        Object.entries(sonarjs.configs.recommended.rules ?? {}).map(
          ([rule, config]) => [rule, Array.isArray(config) ? ['warn', ...config.slice(1)] : 'warn'],
        ),
      ),
      'sonarjs/cognitive-complexity': ['warn', 30],
      'sonarjs/function-return-type': 'off',
      'sonarjs/no-wildcard-import': 'off',
      'sonarjs/file-header': 'off',

      // ESLint comments (recommended rules downgraded to warn)
      ...Object.fromEntries(
        Object.entries(eslintComments.configs.recommended.rules ?? {}).map(
          ([rule, config]) => [rule, Array.isArray(config) ? ['warn', ...config.slice(1)] : 'warn'],
        ),
      ),

      // --- End strict rules ---

      // Additional React-specific rules to prevent infinite loops
      'react-hooks/exhaustive-deps': [
        'error',
        {
          additionalHooks: '(useStateAndRef|useStableCallback|useStableGetter)',
        },
      ],
      'react/jsx-no-bind': [
        'warn',
        {
          ignoreDOMComponents: false,
          ignoreRefs: true,
          allowArrowFunctions: false,
          allowFunctions: false,
          allowBind: false,
        },
      ],
      'react/jsx-no-constructed-context-values': 'error',
    },
  },

  // extra settings for scripts that we run directly with node
  {
    files: ['./scripts/**/*.js', './scripts/**/*.mjs', 'esbuild.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // Debug infrastructure files ARE the logger — they must use console directly
  {
    files: ['packages/core/src/debug/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // CLI extension commands produce user-facing stdout/stderr output
  {
    files: [
      'packages/cli/src/commands/extensions/*.ts',
      'packages/cli/src/config/extension.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  // Vitest test configuration
  {
    // Prevent self-imports in packages
    files: ['packages/core/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          name: '@google/gemini-cli-core',
          message: 'Please use relative imports within the @google/gemini-cli-core package.',
        },
      ],
    },
  },
  {
    files: ['packages/cli/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          name: '@google/gemini-cli',
          message: 'Please use relative imports within the @google/gemini-cli package.',
        },
      ],
    },
  },
  {
    files: ['packages/*/src/**/*.test.{ts,tsx}'],
    plugins: {
      vitest,
    },
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/no-commented-out-tests': 'off',
      'vitest/no-disabled-tests': 'off',
      'vitest/no-standalone-expect': [
        'error',
        {
          additionalTestBlockFunctions: ['itProp'],
        },
      ],

      // Stricter vitest rules (warnings for now)
      'vitest/expect-expect': 'warn',
      'vitest/no-conditional-expect': 'warn',
      'vitest/no-conditional-in-test': 'warn',
      'vitest/require-to-throw-message': 'warn',
      'vitest/prefer-strict-equal': 'warn',
      'vitest/max-nested-describe': ['warn', { max: 3 }],
      'vitest/require-top-level-describe': 'warn',

      // Relax complexity rules for test files
      'max-lines-per-function': 'off',
    },
  },
  // Settings for eslint-rules directory
  {
    files: ['./eslint-rules/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['packages/vscode-ide-companion/esbuild.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Settings for CommonJS scripts
  {
    files: ['./scripts/**/*.cjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
  // extra settings for scripts that we run directly with node
  {
    files: ['packages/vscode-ide-companion/scripts/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Prettier config must be last
  prettierConfig,
  // extra settings for scripts that we run directly with node
  {
    files: ['./integration-tests/**/*.js', './test-*.js', './test-*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // Custom eslint rules for this repo
  {
    files: ['packages/**/*.{js,jsx,ts,tsx}'],
    plugins: {
      custom: {
        rules: {
          'react-render-safety': reactRenderSafety,
          'no-inline-deps': noInlineDeps,
          'ink-text-color-required': inkTextColorRequired,
        },
      },
    },
    rules: {
      // Custom rules
      // 'custom/react-render-safety': 'error', // TODO: Fix for ESLint 9 API
      'custom/no-inline-deps': 'warn', // Set to warn initially, can be changed to error later
      'custom/ink-text-color-required': 'error',
    },
  },
  // License header configuration
  {
    files: ['./**/*.{tsx,ts,js}'],
    plugins: {
      headers,
    },
    rules: {
      'headers/header-format': 'off',
    },
  },
  // Provider authentication anti-patterns
  {
    files: ['packages/core/src/providers/**/*.ts'],
    ignores: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/__tests__/**',
      '**/integration/**',
    ],
    rules: {
      // Prevent direct process.env reads for API keys and key storage in provider files
      // Extends base no-restricted-syntax rules (require/throw) with provider-specific rules
      'no-restricted-syntax': [
        'error',
        // Base rules from main config
        {
          selector: 'CallExpression[callee.name="require"]',
          message: 'Avoid using require(). Use ES6 imports instead.',
        },
        {
          selector: 'ThrowStatement > Literal:not([value=/^\\w+Error:/])',
          message:
            'Do not throw string literals or non-Error objects. Throw new Error("...") instead.',
        },
        // Provider-specific rules
        {
          // Only flag auth-related env var reads (API_KEY, API_TOKEN, etc.)
          // Allows legitimate reads of NODE_ENV, user-agent, etc.
          selector:
            'MemberExpression[object.object.name="process"][object.property.name="env"][property.name=/.*((API|AUTH).*KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS).*/i]',
          message:
            'Do not read API keys from process.env directly in providers. Use authResolver.resolveAuthentication() instead.',
        },
        {
          selector: 'PropertyDefinition[key.name=/.*[Kk]ey.*/][value]',
          message:
            'Providers should not store API keys directly. Use authResolver for stateless auth.',
        },
      ],
    },
  },
);
