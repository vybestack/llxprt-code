const eslintJs = require('@eslint/js');
const globals = require('globals');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const eslintComments = require('eslint-plugin-eslint-comments');
const sonarjs = require('eslint-plugin-sonarjs');
const reactPlugin = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const vitest = require('@vitest/eslint-plugin');

const tsTypeCheckedRules = tsPlugin.configs['recommended-type-checked'].rules;
const tsStylisticRules = tsPlugin.configs['stylistic-type-checked'].rules;

module.exports = [
  {
    ignores: ['dist', 'node_modules'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
        sourceType: 'module',
        ecmaVersion: 'latest',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: { ...globals.node },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'eslint-comments': eslintComments,
      sonarjs,
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...eslintJs.configs.recommended.rules,
      ...tsTypeCheckedRules,
      ...tsStylisticRules,
      ...eslintComments.configs.recommended.rules,
      ...sonarjs.configs.recommended.rules,

      // TypeScript strict rules
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': true,
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // Type-checked rules to catch LLM sloppiness
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
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
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-useless-constructor': 'error',
      '@typescript-eslint/no-empty-function': 'error',

      // General code quality
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'multi-line'],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'object-shorthand': 'error',
      'prefer-arrow-callback': 'error',
      'no-else-return': 'error',
      'no-lonely-if': 'error',
      'no-unneeded-ternary': 'error',
      'no-console': 'warn',

      // Disable sonarjs/function-return-type for React components - returning ReactNode is valid
      'sonarjs/function-return-type': 'off',

      // Complexity limits
      complexity: ['warn', 15],
      'max-lines': [
        'warn',
        { max: 800, skipBlankLines: false, skipComments: false },
      ],
      'max-lines-per-function': [
        'warn',
        { max: 80, skipBlankLines: false, skipComments: false },
      ],
      'sonarjs/cognitive-complexity': ['error', 30],

      // ESLint comments
      'eslint-comments/no-use': 'error',

      // React rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
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
  // Vitest test file rules - prevent mock theater and shallow tests
  {
    files: [
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      '**/__tests__/**/*.{ts,tsx}',
    ],
    plugins: {
      vitest,
    },
    rules: {
      ...vitest.configs.recommended.rules,

      // Prevent tests without real assertions
      'vitest/expect-expect': 'error',
      'vitest/no-standalone-expect': 'error',
      'vitest/valid-expect': 'error',

      // Prevent conditional/unreliable tests
      'vitest/no-conditional-expect': 'error',
      'vitest/no-conditional-in-test': 'error',
      'vitest/no-conditional-tests': 'error',

      // Require meaningful error checking
      'vitest/require-to-throw-message': 'error',

      // Prevent test pollution
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'warn',
      'vitest/no-commented-out-tests': 'warn',
      'vitest/no-identical-title': 'error',
      'vitest/no-duplicate-hooks': 'error',

      // Force stricter assertions
      'vitest/prefer-strict-equal': 'error',
      'vitest/prefer-to-be': 'error',
      'vitest/prefer-to-have-length': 'error',
      'vitest/prefer-comparison-matcher': 'error',
      'vitest/prefer-equality-matcher': 'error',

      // Prevent dynamic snapshots that always pass
      'vitest/no-interpolation-in-snapshots': 'error',

      // Structural rules
      'vitest/max-nested-describe': ['error', { max: 3 }],
      'vitest/require-top-level-describe': 'error',
      'vitest/prefer-hooks-on-top': 'error',

      // Discourage excessive mocking
      'vitest/no-mocks-import': 'warn',

      // Relax some rules that conflict with test patterns
      '@typescript-eslint/no-empty-function': 'off',
      'max-lines-per-function': 'off',
    },
  },
];
