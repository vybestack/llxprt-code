/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// --- ESLint config severity and ceiling-threshold detection (#2189) ---

export const CEILING_RULES = new Set([
  'complexity',
  'max-lines',
  'max-lines-per-function',
  'max-statements',
  'max-params',
  'max-depth',
  'sonarjs/cognitive-complexity',
]);

export const SEVERITY_RANK = { off: 0, 0: 0, warn: 1, 1: 1, error: 2, 2: 2 };

// Centralized rule-id character class matching the full syntax of ESLint rule
// IDs. Accepts:
//   - Core rules: no-console, max-depth
//   - Plugin rules (slash-separated): sonarjs/cognitive-complexity
//   - Scoped plugin rules (npm-scope prefix): @typescript-eslint/no-explicit-any
//   - Scoped rules with multiple path segments: @scope/plugin/rule-name
export const RULE_ID_CHARS = '@a-zA-Z0-9/_-';

// Property keys that are clearly not rule names and common ESLint rule-option
// properties that appear inside rule config objects but are not rule keys
// themselves.
export const STRUCTURAL_KEYS = new Set([
  'files',
  'rules',
  'ignores',
  'settings',
  'plugins',
  'languageOptions',
  'linterOptions',
  'globals',
  'parserOptions',
  'reportUnusedDisableDirectives',
  'processor',
  'allow',
  'name',
  'message',
  'selector',
  'paths',
  'patterns',
  'group',
  'importNames',
  'max',
  'min',
  'maxDepth',
  'maxLen',
  'skipBlankLines',
  'skipComments',
  'IIFEs',
  'ignoreTopLevelFunctions',
  'ignorePattern',
  'ignorePatterns',
  'options',
  'properties',
  'property',
  'var',
  'before',
  'after',
  'level',
  'type',
  'value',
  'description',
  'mode',
  'limit',
  'count',
  'threshold',
  'severity',
  'depth',
  'env',
  'rulesdir',
  'extends',
  'overrides',
  'excludedFiles',
]);

// ESLint config property keys whose object value is a known non-rule container.
// A rules: property nested inside one of these is NOT the ESLint policy rules
// object — it is application data consumed by plugins/shared configs.
export const NON_RULE_CONTAINER_KEYS = new Set([
  'settings',
  'languageOptions',
  'plugins',
  'linterOptions',
  'processor',
  'globals',
  'parserOptions',
  'parser',
  'env',
  'extends',
  'overrides',
  'ecmaFeatures',
  'sourceType',
]);

export const DIRECTIVE_PATTERN =
  /eslint-(?:disable|enable)(?:-next-line|-line)?\b/;

// TypeScript suppression directives (@ts-ignore, @ts-expect-error, @ts-nocheck)
// are only effective when they appear at the START of the comment text (after
// optional whitespace).
export const TS_SUPPRESSION_START_PATTERN =
  /^\s*@(?:ts-ignore|ts-expect-error|ts-nocheck)\b/;

export const TYPE_ESCAPE_PATTERNS = [
  { pattern: /@ts-expect-error\b/, label: '@ts-expect-error' },
  { pattern: /@ts-ignore\b/, label: '@ts-ignore' },
  { pattern: /@ts-nocheck\b/, label: '@ts-nocheck' },
  { pattern: /\bas\s+any\b/, label: 'as any' },
  { pattern: /\bas\s+unknown\s+as\b/, label: 'as unknown as' },
];

export const CLI_TYPE_ESCAPE_ALLOWLIST = [];

// Directories excluded from all recursive source scans.
export const GENERATED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  'tmp',
]);

export const BINARY_EXTENSIONS = new Set([
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.pdf',
  '.png',
  '.webp',
  '.zip',
]);

export const SCOPE_DECLARATION_ARRAYS = new Set([
  'legacyDirectiveCleanupScopes',
  'completedDirectiveCleanupScopes',
]);

export const SCOPE_STRING_PATTERN = /'([^']+)'|"([^"]+)"|`([^`]+)`/;

// --- Git / diff constants ---

export const GIT_OUTPUT_BUFFER_BYTES = 64 * 1024 * 1024;

// A generous unified context (20 lines) ensures that common multiline rule
// config changes in eslint.config.js include the enclosing rules: { block
// and rule key context lines, so multiline severity/threshold detection works
// in production CI, not just in context-rich test fixtures.
export const DIFF_CONTEXT_LINES = '20';

export const POLICY_PATHS = ['.'];

export const DEFAULT_BASE = process.env.GITHUB_BASE_REF
  ? 'origin/' + process.env.GITHUB_BASE_REF
  : 'origin/main';

// --- Diff line classification helpers ---

export function isGeneratedGuardFixture(file) {
  return (
    file === 'scripts/check-eslint-guard.js' ||
    file === 'scripts/tests/eslint-guard.test.js'
  );
}

export function startsWithAddedContent(line) {
  return line.startsWith('+') && !line.startsWith('+++');
}

export function startsWithRemovedContent(line) {
  return line.startsWith('-') && !line.startsWith('---');
}

export function addedContent(line) {
  return line.slice(1);
}

export function removedContent(line) {
  return line.slice(1);
}

export function isAllowedPolicyOff(line) {
  return line.includes('eslint-policy-allow-off:');
}

export function isNewOffRule(line) {
  const isOffColon = /:\s*['"]off['"]/.test(line);
  const isZeroColon = /:\s*0\b/.test(line);
  const isOffArray = /\[\s*['"]off['"]/.test(line);
  const isZeroArray = /\[\s*0\b/.test(line);
  return isOffColon || isZeroColon || isOffArray || isZeroArray;
}

export function isCommentOnlyLine(line) {
  return line.trim().startsWith('//');
}
