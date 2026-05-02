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
      'import/no-default-export': 'error',
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
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
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
        'error',
        { prefer: 'type-imports' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',

      // General code quality
      'no-console': 'warn',
      'no-else-return': 'error',
      'no-lonely-if': 'error',
      'no-unneeded-ternary': 'error',

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
      'sonarjs/todo-tag': 'error',
      'sonarjs/no-ignored-exceptions': 'error',
      'sonarjs/regular-expr': 'error',
      'sonarjs/slow-regex': 'error',

      'sonarjs/function-return-type': 'off',
      'sonarjs/no-wildcard-import': 'off',
      'sonarjs/file-header': 'off',

      // Irrelevant SonarJS rules for this Node.js CLI codebase

      // AWS infrastructure rules — no CloudFormation/Terraform/CDK usage
      'sonarjs/aws-apigateway-public-api': 'off',
      'sonarjs/aws-ec2-rds-dms-public': 'off',
      'sonarjs/aws-ec2-unencrypted-ebs-volume': 'off',
      'sonarjs/aws-efs-unencrypted': 'off',
      'sonarjs/aws-iam-all-privileges': 'off',
      'sonarjs/aws-iam-all-resources-accessible': 'off',
      'sonarjs/aws-iam-privilege-escalation': 'off',
      'sonarjs/aws-iam-public-access': 'off',
      'sonarjs/aws-opensearchservice-domain': 'off',
      'sonarjs/aws-rds-unencrypted-databases': 'off',
      'sonarjs/aws-restricted-ip-admin-access': 'off',
      'sonarjs/aws-s3-bucket-granted-access': 'off',
      'sonarjs/aws-s3-bucket-insecure-http': 'off',
      'sonarjs/aws-s3-bucket-public-access': 'off',
      'sonarjs/aws-s3-bucket-server-encryption': 'off',
      'sonarjs/aws-s3-bucket-versioning': 'off',
      'sonarjs/aws-sagemaker-unencrypted-notebook': 'off',
      'sonarjs/aws-sns-unencrypted-topics': 'off',
      'sonarjs/aws-sqs-unencrypted-queue': 'off',

      // Web security / browser / HTTP rules — CLI does not serve HTTP, set cookies, or render HTML
      'sonarjs/certificate-transparency': 'off',
      'sonarjs/content-length': 'off',
      'sonarjs/content-security-policy': 'off',
      'sonarjs/cookie-no-httponly': 'off',
      'sonarjs/cookies': 'off',
      'sonarjs/cors': 'off',
      'sonarjs/csrf': 'off',
      'sonarjs/disabled-auto-escaping': 'off',
      'sonarjs/disabled-resource-integrity': 'off',
      'sonarjs/dns-prefetching': 'off',
      'sonarjs/frame-ancestors': 'off',
      'sonarjs/hidden-files': 'off',
      'sonarjs/insecure-cookie': 'off',
      'sonarjs/link-with-target-blank': 'off',
      'sonarjs/no-clear-text-protocols': 'off',
      'sonarjs/no-ip-forward': 'off',
      'sonarjs/no-mime-sniff': 'off',
      'sonarjs/no-mixed-content': 'off',
      'sonarjs/no-referrer-policy': 'off',
      'sonarjs/no-session-cookies-on-static-assets': 'off',
      'sonarjs/post-message': 'off',
      'sonarjs/session-regeneration': 'off',
      'sonarjs/strict-transport-security': 'off',
      'sonarjs/unverified-certificate': 'off',
      'sonarjs/unverified-hostname': 'off',
      'sonarjs/weak-ssl': 'off',
      'sonarjs/x-powered-by': 'off',

      // HTML/DOM/Accessibility rules — no server-rendered HTML or DOM manipulation
      'sonarjs/no-table-as-layout': 'off',
      'sonarjs/object-alt-content': 'off',
      'sonarjs/table-header': 'off',
      'sonarjs/table-header-reference': 'off',
      'sonarjs/no-intrusive-permissions': 'off',

      // Framework-specific rules — Angular/Vue not used; React SonarJS rules overlap with eslint-plugin-react
      'sonarjs/no-angular-bypass-sanitization': 'off',
      'sonarjs/no-vue-bypass-sanitization': 'off',
      'sonarjs/chai-determinate-assertion': 'off',
      'sonarjs/no-hook-setter-in-body': 'off',
      'sonarjs/no-useless-react-setstate': 'off',
      'sonarjs/prefer-read-only-props': 'off',
      'sonarjs/no-uniq-key': 'off',
      'sonarjs/jsx-no-leaked-render': 'off',

      // Database/SQL rules — no SQL or database usage
      'sonarjs/sql-queries': 'off',
      'sonarjs/web-sql-database': 'off',

      // Other irrelevant rules
      'sonarjs/review-blockchain-mnemonic': 'off',
      'sonarjs/xml-parser-xxe': 'off',
      'sonarjs/xpath': 'off',
      'sonarjs/file-uploads': 'off',

      // Expensive heuristic — NLP analysis on comments with no value for this codebase
      'sonarjs/no-commented-code': 'off',

      // TypeScript-incompatible rules — SonarJS doesn't understand TS global types
      'sonarjs/no-reference-error': 'off', // Flags NodeJS, describe, it, beforeEach as undefined

      // CLI-inappropriate rules — this is a CLI tool, not a web server
      'sonarjs/process-argv': 'off', // CLI needs command line args
      'sonarjs/standard-input': 'off', // CLI needs stdin for pipes
      'sonarjs/publicly-writable-directories': 'off', // CLI needs temp files
      'sonarjs/sockets': 'off', // MCP server uses stdio sockets

      // Module-scope misunderstanding — ESM module scope IS local scope
      'sonarjs/declarations-in-global-scope': 'off', // Top-level module decls are NOT global

      // API naming conflicts — tool API uses snake_case
      'sonarjs/variable-name': 'off', // file_path, old_string, new_string match tool params

      // Redundant with TypeScript-ESLint / other plugins (already have better versions)
      'sonarjs/cyclomatic-complexity': 'off', // ESLint 'complexity' already enabled
      'sonarjs/max-lines-per-function': 'off', // ESLint rule already enabled
      'sonarjs/max-lines': 'off', // ESLint rule already enabled
      'sonarjs/no-unused-vars': 'off', // @typescript-eslint/no-unused-vars handles this
      'sonarjs/no-unused-function-argument': 'off', // Covered by TS no-unused-vars with argsIgnorePattern
      'sonarjs/unused-import': 'off', // import plugin handles this
      'sonarjs/no-implicit-dependencies': 'off', // import plugin handles this
      'sonarjs/deprecation': 'off', // TypeScript compiler already warns on deprecated APIs

      // TypeScript-idiomatic patterns that SonarJS misunderstands
      'sonarjs/void-use': 'off', // Fire-and-forget promises are valid TS pattern
      'sonarjs/no-nested-functions': 'off', // Closures are idiomatic; nested-control-flow catches real issues
      'sonarjs/no-undefined-assignment': 'off', // TS uses undefined for optional properties (idiomatic)

      // Issue #1569c: Misfit SonarJS style rules turned off as documented noise.
      // These rules either conflict with Prettier, are pure stylistic preference,
      // or produce high false-positive rates with no correctness value for this codebase.
      'sonarjs/arrow-function-convention': 'off', // Conflicts with Prettier parens handling
      'sonarjs/no-duplicate-string': 'off', // 3-occurrence threshold produces pure noise
      'sonarjs/shorthand-property-grouping': 'off', // Pure ordering preference, no correctness value
      'sonarjs/elseif-without-else': 'off', // Pure style; conflicts with early-return pattern
      'sonarjs/max-union-size': 'off', // Discriminated unions legitimately exceed arbitrary limit
      'sonarjs/no-alphabetical-sort': 'off', // Heuristic is false-positive prone on typed arrays
      'sonarjs/prefer-regexp-exec': 'off', // String.match and RegExp.exec are both idiomatic
      'sonarjs/function-name': 'off', // Conflicts with TS class/method naming conventions
      'sonarjs/prefer-immediate-return': 'off', // Named intermediates improve readability/debuggability
      'sonarjs/pseudo-random': 'off', // CLI context: Math.random for IDs/jitter, not cryptography

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
    files: ['packages/*/src/**/*.{test,spec}.{ts,tsx}'],
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
      // fast-check's `fc.assert` is a real assertion helper; tests using
      // `fc.assert(fc.property(...))` do assert but use no literal `expect`.
      'vitest/expect-expect': [
        'error',
        { assertFunctionNames: ['expect', 'fc.assert'] },
      ],
      'vitest/no-conditional-expect': 'error',
      'vitest/no-conditional-in-test': 'error',
      'vitest/require-to-throw-message': 'error',
      'vitest/prefer-strict-equal': 'error',
      'vitest/max-nested-describe': ['error', { max: 3 }],
      'vitest/require-top-level-describe': 'error',

      // Relax complexity rules for test files
      'max-lines-per-function': 'off',

      // Test files use `typeof import('pkg')` for vi mock typing; it's idiomatic.
      '@typescript-eslint/consistent-type-imports': 'off',

    },
  },
  // ============================================================================
  // Issue #1569: Batch BN4C - no-unnecessary-condition enforcement
  // ============================================================================
  // Promote this rule from warn to error for the specific batch scope.
  {
    files: [
      'packages/a2a-server/src/agent/executor.ts',
      'packages/a2a-server/src/agent/task.ts',
    ],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'error',
    },
  },
  // ============================================================================
  // End Issue #1569 BN4C
  // ============================================================================
  // ============================================================================
  // Issue #1569: Batch BN4D - strict-boolean-expressions enforcement
  // ============================================================================
  // Promote this rule from warn to error for the specific batch scope.
  {
    files: [
      'packages/a2a-server/src/config/config.ts',
      'packages/a2a-server/src/agent/task.ts',
    ],
    rules: {
      '@typescript-eslint/strict-boolean-expressions': 'error',
    },
  },
  // ============================================================================
  // End Issue #1569 BN4D
  // ============================================================================
  // ============================================================================
  // Issue #1569: Batch C5A - max-lines-per-function enforcement
  // ============================================================================
  // Promote this rule from warn to error for the specific batch scope.
  {
    files: ['packages/a2a-server/src/agent/executor.ts'],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  // ============================================================================
  // End Issue #1569 C5A
  // ============================================================================
  // ============================================================================
  // Issue #1569: Batch C5B - complexity enforcement
  // ============================================================================
  // Promote this rule from warn to error for the specific batch scope.
  {
    files: ['packages/a2a-server/src/agent/task.ts'],
    rules: {
      complexity: ['error', 15],
    },
  },
  // ============================================================================
  // End Issue #1569 C5B
  // ============================================================================
  // ============================================================================
  // Issue #1569: Batch C5C - sonarjs/cognitive-complexity enforcement
  // ============================================================================
  // Promote this rule from warn to error for the specific batch scope.
  {
    files: ['packages/a2a-server/src/agent/task.ts'],
    rules: {
      'sonarjs/cognitive-complexity': ['error', 30],
    },
  },
  // ============================================================================
  // End Issue #1569 C5C
  // ============================================================================
  // ============================================================================
  // Issue #1569: Batch C5D - max-lines enforcement
  // ============================================================================
  // Promote this rule from warn to error for the specific batch scope.
  {
    files: ['packages/a2a-server/src/agent/task.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  // ============================================================================
  // ============================================================================
  // End Issue #1569 S6A
  // ============================================================================
  // Issue #1569: Batch S6B - sonarjs/no-ignored-exceptions enforcement
  // ============================================================================
  // Ensure catch blocks handle errors rather than silently ignoring them.
  {
    files: [
      'packages/a2a-server/src/agent/executor.ts',
      'packages/a2a-server/src/agent/task.ts',
    ],
    rules: {
      'sonarjs/no-ignored-exceptions': 'error',
    },
  },
  // ============================================================================
  // End Issue #1569 S6B
  // ============================================================================
  // Issue #1569: Batch S6D - sonarjs/os-command enforcement
  // ============================================================================
  // Enforce safe OS command execution patterns.
  {
    files: ['packages/a2a-server/src/agent/executor.ts'],
    plugins: {
      sonarjs,
    },
    rules: {
      'sonarjs/os-command': 'error',
      'sonarjs/no-os-command-from-path': 'error',
    },
  },
  // ============================================================================
  // End Issue #1569 S6D
  // ============================================================================
  // Issue #1576: Enforce strict line-limit errors on AppContainer module files.
  // These files are being decomposed; error-level rules catch regressions during
  // and after the decomposition. Test files are excluded (they already have
  // max-lines-per-function: 'off' via the vitest block above).
  {
    files: [
      'packages/cli/src/ui/AppContainerRuntime.tsx',
      'packages/cli/src/ui/containers/AppContainer/**/*.ts',
      'packages/cli/src/ui/containers/AppContainer/**/*.tsx',
    ],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'max-lines': [
        'error',
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'error',
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
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
  // Examples should have access to standard globals like fetch
  {
    files: ['packages/cli/src/commands/extensions/examples/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        fetch: 'readonly',
      },
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
  // ============================================================================
  // Issue #1577: text-buffer.ts decomposition - Architecture Enforcement
  // ============================================================================

  // Domain modules must be pure (no React, no side effects)
  {
    files: [
      'packages/cli/src/ui/components/shared/buffer-types.ts',
      'packages/cli/src/ui/components/shared/word-navigation.ts',
      'packages/cli/src/ui/components/shared/buffer-operations.ts',
      'packages/cli/src/ui/components/shared/transformations.ts',
      'packages/cli/src/ui/components/shared/visual-layout.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message:
                'Domain modules must be pure. React only allowed in text-buffer.ts',
            },
            {
              name: '@vybestack/llxprt-code-core',
              importNames: ['debugLogger'],
              message:
                'Domain modules must be side-effect free. No logging.',
            },
          ],
          patterns: [
            {
              group: ['node:fs', 'node:child_process', 'node:os'],
              message:
                'Domain modules must be pure. No Node.js I/O modules.',
            },
          ],
        },
      ],
      complexity: ['error', 15],
      'max-lines': [
        'error',
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'error',
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // vim-buffer-actions.ts specific restrictions
  {
    files: ['packages/cli/src/ui/components/shared/vim-buffer-actions.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: './text-buffer.js',
              message:
                'Import from buffer-types, buffer-operations, or word-navigation directly',
            },
            {
              name: './buffer-reducer.js',
              message:
                'vim-buffer-actions must not import buffer-reducer (creates cycle)',
            },
            {
              name: 'react',
              message: 'vim-buffer-actions must be pure logic. No React.',
            },
          ],
          patterns: [
            {
              group: ['**/shared/text-buffer.js'],
              message: 'Import from specific module, not text-buffer.js',
            },
          ],
        },
      ],
      complexity: ['error', 15],
      'max-lines-per-function': ['error', 80],
    },
  },

  // buffer-reducer.ts specific restrictions
  {
    files: ['packages/cli/src/ui/components/shared/buffer-reducer.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message: 'buffer-reducer must be pure logic. No React.',
            },
          ],
        },
      ],
      complexity: ['error', 15],
      'max-lines-per-function': ['error', 80],
    },
  },

  // text-buffer.ts size limits (React allowed here only)
  // useTextBuffer is a React hook composition root; its size comes from
  // useCallback/useMemo declarations, not from logic complexity.
  {
    files: ['packages/cli/src/ui/components/shared/text-buffer.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // Migration: Warn on utility imports from text-buffer.js in CLI src
  {
    files: ['packages/cli/src/**/*.ts', 'packages/cli/src/**/*.tsx'],
    ignores: [
      'packages/cli/src/ui/components/shared/text-buffer.ts',
      'packages/cli/src/ui/components/shared/text-buffer.test.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          paths: [],
          patterns: [
            {
              group: ['**/shared/text-buffer.js'],
              importNames: [
                'offsetToLogicalPos',
                'logicalPosToOffset',
                'textBufferReducer',
                'pushUndo',
                'replaceRangeInternal',
                'findNextWordStartInLine',
                'findPrevWordStartInLine',
                'findWordEndInLine',
                'getPositionFromOffsets',
                'getLineRangeOffsets',
              ],
              message:
                'Import from buffer-operations.js, word-navigation.js, or buffer-types.js directly. See Issue #1577.',
            },
          ],
        },
      ],
    },
  },
  // ============================================================================
  // End Issue #1577
  // ============================================================================

  // ============================================================================
  // Issue #1581: subagent.ts decomposition - Size enforcement
  // ============================================================================
  //
  // Error-level max-lines and max-lines-per-function rules on the four new
  // modules ensure they never grow past their design targets. The coordinator
  // file (subagent.ts) uses 'warn' during the decomposition (Phases 1-4) and
  // will be promoted to 'error' in Phase 5 once the file is thin enough.
  // These rules target files that don't exist yet — ESLint silently ignores
  // unmatched globs, so CI stays green during Phase 0.
  {
    files: [
      'packages/core/src/core/subagentTypes.ts',
      'packages/core/src/core/subagentRuntimeSetup.ts',
      'packages/core/src/core/subagentToolProcessing.ts',
      'packages/core/src/core/subagentExecution.ts',
    ],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'max-lines': [
        'error',
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'error',
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  // subagent.ts coordinator: warn during decomposition, promoted to error in Phase 5
  {
    files: ['packages/core/src/core/subagent.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'max-lines': [
        'warn',
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'warn',
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  // Enforce execution -> runtimeSetup dependency boundary.
  // subagentExecution.ts must not import from subagentRuntimeSetup.js.
  // All runtime artifacts must be passed as parameters by the coordinator.
  // See project-plans/issue1581/README.md §Dependency Graph.
  {
    files: ['packages/core/src/core/subagentExecution.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: './subagentRuntimeSetup.js',
              message:
                'subagentExecution must not import from subagentRuntimeSetup. ' +
                'All runtime artifacts must be passed as parameters by the coordinator (subagent.ts). ' +
                'See project-plans/issue1581/README.md §Dependency Graph.',
            },
          ],
        },
      ],
    },
  },
  // ============================================================================
  // End Issue #1581
  // ============================================================================

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
      'custom/no-inline-deps': 'error',
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
