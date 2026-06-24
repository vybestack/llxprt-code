/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkCliSourcePolicy,
  checkCoreCentralBypassesInConfig,
  checkCoreDirectiveScopesInConfig,
  checkDiff,
  checkModuleCentralBypassesInConfig,
  checkModuleDirectiveScopesInConfig,
  extractScopeArray,
  formatViolations,
  scanCoreDirectives,
  scanModuleDirectives,
  scanPackageDirectives,
} from '../check-eslint-guard.js';

const repoRoot = process.cwd();
function diffFor(file, addedLine) {
  return [
    'diff --git a/' + file + ' b/' + file,
    'index 0000000..1111111 100644',
    '--- a/' + file,
    '+++ b/' + file,
    '@@ -1,0 +1,1 @@',
    '+' + addedLine,
  ].join('\n');
}

describe('check-eslint-guard', () => {
  it('rejects newly added inline ESLint disable directives', () => {
    const violations = checkDiff(
      diffFor(
        'packages/core/src/example.ts',
        '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
      ),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain(
      'Inline ESLint disable/enable directives are forbidden',
    );
  });

  it('rejects new eslint config off entries without explicit policy marker', () => {
    const violations = checkDiff(
      diffFor('eslint.config.js', "      'complexity': 'off',"),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('eslint-policy-allow-off');
  });

  it('allows explicitly documented eslint config off entries', () => {
    const violations = checkDiff(
      diffFor(
        'eslint.config.js',
        "      'sonarjs/os-command': 'off', // eslint-policy-allow-off: #2079",
      ),
    );

    expect(violations).toEqual([]);
  });

  it('rejects removing the inline-disable ban', () => {
    const diff = [
      'diff --git a/eslint.config.js b/eslint.config.js',
      'index 0000000..1111111 100644',
      '--- a/eslint.config.js',
      '+++ b/eslint.config.js',
      '@@ -1,1 +0,0 @@',
      "-      'eslint-comments/no-use': 'error',",
    ].join('\n');

    const violations = checkDiff(diff);

    expect(violations).toHaveLength(1);
    expect(formatViolations(violations)).toContain('inline-disable ban');
  });

  it('rejects removing max-warnings zero from lint ci', () => {
    const diff = [
      'diff --git a/package.json b/package.json',
      'index 0000000..1111111 100644',
      '--- a/package.json',
      '+++ b/package.json',
      '@@ -1,1 +0,0 @@',
      '-    "lint:ci": "eslint . --max-warnings 0",',
    ].join('\n');

    const violations = checkDiff(diff);

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('--max-warnings 0');
  });

  it('allows moving the inline-disable ban without weakening it', () => {
    const diff = [
      'diff --git a/eslint.config.js b/eslint.config.js',
      'index 0000000..1111111 100644',
      '--- a/eslint.config.js',
      '+++ b/eslint.config.js',
      '@@ -1,1 +1,1 @@',
      "-      'eslint-comments/no-use': ['error'],",
      "+      'eslint-comments/no-use': ['error'],",
    ].join('\n');

    expect(checkDiff(diff)).toEqual([]);
  });

  it('allows moving max-warnings zero without removing it', () => {
    const diff = [
      'diff --git a/package.json b/package.json',
      'index 0000000..1111111 100644',
      '--- a/package.json',
      '+++ b/package.json',
      '@@ -1,1 +1,1 @@',
      '-    "lint:ci": "eslint . --max-warnings 0",',
      '+    "lint:ci": "cross-env eslint . --max-warnings 0",',
    ].join('\n');

    expect(checkDiff(diff)).toEqual([]);
  });

  it('rejects inline ESLint disables in scripts', () => {
    const violations = checkDiff(
      diffFor('scripts/example.js', '// eslint-disable-line no-console'),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe('scripts/example.js');
  });

  it('rejects inline ESLint enable directives', () => {
    const violations = checkDiff(
      diffFor('packages/core/src/example.ts', '/* eslint-enable no-console */'),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('disable/enable');
  });

  it('rejects packages/cli entries added to eslint config', () => {
    const violations = checkDiff(
      diffFor('eslint.config.js', "  'packages/cli/src/**/*.{ts,tsx}',"),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain(
      'packages/cli directive cleanup scopes',
    );
  });

  it('allows packages/cli/src references inside config comments', () => {
    const violations = checkDiff(
      diffFor(
        'eslint.config.js',
        '      // Project-level assertion wrappers (see packages/cli/src/test-utils)',
      ),
    );

    expect(violations).toHaveLength(0);
  });

  it('keeps the checked-in cli source policy clean', () => {
    expect(checkCliSourcePolicy()).toEqual([]);
  });

  describe('#2115 packages/core directive ban', () => {
    it('reports violations when packages/core files contain directives', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-core-'));
      const subDir = join(tmpDir, 'src', 'utils');
      mkdirSync(subDir, { recursive: true });
      writeFileSync(
        join(subDir, 'example.ts'),
        [
          'export const x = 1;',
          '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
          'export const y: any = 2;',
        ].join('\n'),
      );

      const violations = scanCoreDirectives(tmpDir);

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('#2115');
      expect(violations[0].lineNumber).toBe(2);
    });

    it('reports violations in non-JS text files under packages/core', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-core-text-'));
      writeFileSync(
        join(tmpDir, 'fixture.md'),
        'This fixture must not contain eslint-disable-line directives.\n',
      );

      const violations = scanCoreDirectives(tmpDir);

      expect(violations).toHaveLength(1);
      expect(violations[0].lineNumber).toBe(1);
    });

    it('passes when packages/core files contain no directives', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-core-clean-'));
      writeFileSync(
        join(tmpDir, 'clean.ts'),
        ['export const x = 1;', 'export const y = 2;'].join('\n'),
      );

      expect(scanCoreDirectives(tmpDir)).toEqual([]);
    });

    it('flags packages/core entries left in legacyDirectiveCleanupScopes', () => {
      const config = [
        'const legacyDirectiveCleanupScopes = [',
        "  'packages/core/src/utils/example.ts', // remaining core cleanup",
        "  'packages/cli/src/foo.ts',",
        '];',
      ].join('\n');

      const violations = checkCoreDirectiveScopesInConfig(config);

      expect(violations).toHaveLength(1);
      expect(violations[0].file).toBe('eslint.config.js');
      expect(violations[0].message).toContain('#2115');
    });

    it('flags packages/core entries left in completedDirectiveCleanupScopes', () => {
      const config = [
        'const completedDirectiveCleanupScopes = [',
        "  'packages/core/src/utils/example.ts', // completed core cleanup",
        "  'packages/cli/src/foo.ts',",
        '];',
      ].join('\n');

      const violations = checkCoreDirectiveScopesInConfig(config);

      expect(violations).toHaveLength(1);
      expect(violations[0].file).toBe('eslint.config.js');
      expect(violations[0].message).toContain(
        'completedDirectiveCleanupScopes',
      );
    });

    it('flags single-line packages/core cleanup scope entries', () => {
      const config =
        "const legacyDirectiveCleanupScopes = ['packages/core/src/example.ts'];";

      const violations = checkCoreDirectiveScopesInConfig(config);

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('legacyDirectiveCleanupScopes');
    });

    it('passes when directive cleanup scopes have no packages/core entries', () => {
      const config = [
        'const legacyDirectiveCleanupScopes = [',
        "  'packages/cli/src/foo.ts',",
        '];',
        'const completedDirectiveCleanupScopes = [',
        "  'packages/providers/src/foo.ts',",
        '];',
      ].join('\n');

      expect(checkCoreDirectiveScopesInConfig(config)).toEqual([]);
    });
    it('flags packages/core central rule-off blocks', () => {
      const config = [
        '{',
        "  files: ['packages/core/src/example.ts'],",
        '  rules: {',
        "    'sonarjs/regular-expr': 'off',",
        '  },',
        '}',
      ].join('\n');

      const violations = checkCoreCentralBypassesInConfig(config);

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('rule-off');
    });

    it('flags packages/core multiline rule-off values', () => {
      const config = [
        '{',
        "  files: ['packages/core/src/example.ts'],",
        '  rules: {',
        "    'sonarjs/regular-expr': [",
        "      'off',",
        '    ],',
        "    'no-console': [",
        '      0,',
        '    ],',
        "    'no-unused-vars': [",
        "      'off', // inline comment",
        '    ],',
        "    'no-magic-numbers': [",
        '      0, // inline comment',
        '    ],',
        '  },',
        '}',
      ].join('\n');

      const violations = checkCoreCentralBypassesInConfig(config);

      expect(violations).toHaveLength(4);
      expect(formatViolations(violations)).toContain('rule-off');
    });

    it('flags packages/core central rule-off values in long blocks', () => {
      const config = [
        '{',
        "  files: ['packages/core/src/example.ts'],",
        ...Array.from(
          { length: 90 },
          (_, index) => `  settings${index}: { value: ${index} },`,
        ),
        '  rules: {',
        "    'sonarjs/regular-expr': [",
        "      'off',",
        '    ],',
        '  },',
        '}',
      ].join('\n');

      const violations = checkCoreCentralBypassesInConfig(config);

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('rule-off');
    });

    it('flags packages/core scoped ignores', () => {
      const config = [
        '{',
        "  files: ['packages/core/src/**/*.ts'],",
        "  ignores: ['**/*.test.ts'],",

        '  rules: {},',
        '}',
      ].join('\n');

      const violations = checkCoreCentralBypassesInConfig(config);

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('scoped ignore');
    });

    it('flags single-line packages/core scoped rule-off and ignores', () => {
      const config = [
        "{ files: ['packages/core/src/example.ts'], rules: { 'no-console': 'off' } },",
        "{ files: ['packages/core/src/example.ts'], ignores: ['**/*.test.ts'] },",
      ].join('\n');

      const violations = checkCoreCentralBypassesInConfig(config);

      expect(violations).toHaveLength(2);
      expect(formatViolations(violations)).toContain('rule-off');
      expect(formatViolations(violations)).toContain('scoped ignore');
    });

    it('flags packages/core global ignores and allow-list entries', () => {
      const config = [
        'export default [',
        '  {',
        '    ignores: [',
        "      'packages/core/src/prompts/*.d.ts',",
        '    ],',
        '  },',
        '  {',
        '    rules: {',
        "      'import/no-internal-modules': ['error', { allow: [",
        "        '**/packages/core/src/prompts/*.js',",
        '      ] }],',
        '    },',
        '  },',
        '];',
      ].join('\n');

      const violations = checkCoreCentralBypassesInConfig(config);

      expect(violations).toHaveLength(2);
      expect(formatViolations(violations)).toContain('allow-list');
      expect(formatViolations(violations)).toContain('ignore');
    });

    it('allows packages/core positive enforcement blocks', () => {
      const config = [
        '{',
        "  files: ['packages/core/src/example.ts'],",
        '  rules: {',
        "    'max-lines': ['error', { max: 800 }],",
        "    'no-restricted-imports': ['error', { name: 'x' }],",
        '  },',
        '}',
      ].join('\n');

      expect(checkCoreCentralBypassesInConfig(config)).toEqual([]);
    });
  });
});

describe('packages/storage directive cleanup (#2119)', () => {
  const storageSrcDir = join(repoRoot, 'packages', 'storage', 'src');

  it('has zero inline ESLint disable/enable directives', () => {
    const offenders = scanPackageDirectives(storageSrcDir, '2119').map(
      (v) => `${v.file}:${v.lineNumber}`,
    );
    expect(offenders, 'Found directives: ' + offenders.join(', ')).toEqual([]);
  });

  it('is locked in completedDirectiveCleanupScopes with a broad glob', () => {
    const completed = extractScopeArray('completedDirectiveCleanupScopes');
    expect(completed).toContain('packages/storage/src/**/*.{ts,tsx}');
  });

  it('is no longer in legacyDirectiveCleanupScopes', () => {
    const legacy = extractScopeArray('legacyDirectiveCleanupScopes');
    const storageEntries = legacy.filter((e) =>
      e.startsWith('packages/storage'),
    );
    expect(
      storageEntries,
      'Legacy storage entries: ' + storageEntries.join(', '),
    ).toEqual([]);
  });
});

describe('packages/auth directive cleanup (#2121)', () => {
  const authSrcDir = join(repoRoot, 'packages', 'auth', 'src');

  it('has zero inline ESLint disable/enable directives', () => {
    const offenders = scanPackageDirectives(authSrcDir, '2121').map(
      (v) => `${v.file}:${v.lineNumber}`,
    );
    expect(offenders, 'Found directives: ' + offenders.join(', ')).toEqual([]);
  });

  it('is locked in completedDirectiveCleanupScopes with a broad glob', () => {
    const completed = extractScopeArray('completedDirectiveCleanupScopes');
    expect(completed).toContain('packages/auth/src/**/*.{ts,tsx}');
  });

  it('is no longer in legacyDirectiveCleanupScopes', () => {
    const legacy = extractScopeArray('legacyDirectiveCleanupScopes');
    const authEntries = legacy.filter((e) => e.startsWith('packages/auth'));
    expect(
      authEntries,
      'Legacy auth entries: ' + authEntries.join(', '),
    ).toEqual([]);
  });
});

describe('packages/policy directive cleanup (#2122)', () => {
  const policySrcDir = join(repoRoot, 'packages', 'policy', 'src');

  describe('scanModuleDirectives', () => {
    it('reports violations when packages/policy files contain directives', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-policy-'));
      const subDir = join(tmpDir, 'src');
      mkdirSync(subDir, { recursive: true });
      writeFileSync(
        join(subDir, 'example.ts'),
        [
          'export const x = 1;',
          '// eslint-disable-next-line sonarjs/expression-complexity',
          'export const y = (a && b) || (c && d) ? e : f;',
        ].join('\n'),
      );

      const violations = scanModuleDirectives(
        'packages/policy',
        '2122',
        tmpDir,
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('#2122');
      expect(violations[0].message).toContain('packages/policy');
      expect(violations[0].lineNumber).toBe(2);
    });

    it('passes when packages/policy files contain no directives', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-policy-clean-'));
      writeFileSync(
        join(tmpDir, 'clean.ts'),
        ['export const x = 1;', 'export const y = 2;'].join('\n'),
      );

      expect(scanModuleDirectives('packages/policy', '2122', tmpDir)).toEqual(
        [],
      );
    });
  });

  describe('checkModuleDirectiveScopesInConfig', () => {
    it('flags packages/policy entries left in legacyDirectiveCleanupScopes', () => {
      const config = [
        'const legacyDirectiveCleanupScopes = [',
        "  'packages/policy/src/**/*.{ts,tsx}', // remaining policy cleanup",
        "  'packages/cli/src/foo.ts',",
        '];',
      ].join('\n');

      const violations = checkModuleDirectiveScopesInConfig(
        config,
        'packages/policy',
        '2122',
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].file).toBe('eslint.config.js');
      expect(violations[0].message).toContain('#2122');
      expect(violations[0].message).toContain('legacyDirectiveCleanupScopes');
    });

    it('allows packages/policy in completedDirectiveCleanupScopes (lock)', () => {
      const config = [
        'const legacyDirectiveCleanupScopes = [',
        "  'packages/cli/src/foo.ts',",
        '];',
        'const completedDirectiveCleanupScopes = [',
        "  'packages/policy/src/**/*.{ts,tsx}', // #2122",
        '];',
      ].join('\n');

      expect(
        checkModuleDirectiveScopesInConfig(
          config,
          'packages/policy',
          '2122',
          false,
        ),
      ).toEqual([]);
    });
  });

  describe('checkModuleCentralBypassesInConfig', () => {
    it('flags packages/policy central rule-off blocks', () => {
      const config = [
        '{',
        "  files: ['packages/policy/src/example.ts'],",
        '  rules: {',
        "    'sonarjs/expression-complexity': 'off',",
        '  },',
        '}',
      ].join('\n');

      const violations = checkModuleCentralBypassesInConfig(
        config,
        'packages/policy',
        '2122',
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('rule-off');
      expect(violations[0].message).toContain('#2122');
    });

    it('flags packages/policy scoped ignores', () => {
      const config = [
        '{',
        "  files: ['packages/policy/src/**/*.ts'],",
        "  ignores: ['**/*.test.ts'],",
        '  rules: {},',
        '}',
      ].join('\n');

      const violations = checkModuleCentralBypassesInConfig(
        config,
        'packages/policy',
        '2122',
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('scoped ignore');
    });

    it('allows packages/policy positive enforcement blocks', () => {
      const config = [
        '{',
        "  files: ['packages/policy/src/example.ts'],",
        '  rules: {',
        "    'max-lines': ['error', { max: 800 }],",
        '  },',
        '}',
      ].join('\n');

      expect(
        checkModuleCentralBypassesInConfig(config, 'packages/policy', '2122'),
      ).toEqual([]);
    });

    it('flags packages/policy multi-line files arrays with rule-off', () => {
      const config = [
        '{',
        '  files: [',
        "    'packages/policy/src/**/*.ts',",
        '  ],',
        '  rules: {',
        "    'sonarjs/expression-complexity': 'off',",
        '  },',
        '}',
      ].join('\n');

      const violations = checkModuleCentralBypassesInConfig(
        config,
        'packages/policy',
        '2122',
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('rule-off');
      expect(violations[0].message).toContain('#2122');
    });

    it('flags packages/policy multi-line files arrays with scoped ignores', () => {
      const config = [
        '{',
        '  files: [',
        "    'packages/policy/src/**/*.ts',",
        '  ],',
        "  ignores: ['**/*.test.ts'],",
        '  rules: {},',
        '}',
      ].join('\n');

      const violations = checkModuleCentralBypassesInConfig(
        config,
        'packages/policy',
        '2122',
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('scoped ignore');
    });

    it('ignores packages/policy references in trailing comments', () => {
      const config = [
        '{',
        "  files: ['packages/cli/src/example.ts'], // not packages/policy",
        '  rules: {',
        "    'sonarjs/expression-complexity': 'off',",
        '  },',
        '}',
      ].join('\n');

      expect(
        checkModuleCentralBypassesInConfig(config, 'packages/policy', '2122'),
      ).toEqual([]);
    });
    it('does not flag completedDirectiveCleanupScopes entries as central bypasses', () => {
      const config = [
        'const completedDirectiveCleanupScopes = [',
        "  'packages/policy/src/**/*.{ts,tsx}', // #2122",
        '];',
      ].join('\n');

      expect(
        checkModuleCentralBypassesInConfig(config, 'packages/policy', '2122'),
      ).toEqual([]);
    });

    it('does not flag legacyDirectiveCleanupScopes entries as central bypasses', () => {
      const config = [
        'const legacyDirectiveCleanupScopes = [',
        "  'packages/policy/src/**/*.ts',",
        '];',
      ].join('\n');

      expect(
        checkModuleCentralBypassesInConfig(config, 'packages/policy', '2122'),
      ).toEqual([]);
    });
  });

  it('has zero inline ESLint disable/enable directives in source', () => {
    const offenders = scanPackageDirectives(policySrcDir, '2122').map(
      (v) => `${v.file}:${v.lineNumber}`,
    );
    expect(offenders, 'Found directives: ' + offenders.join(', ')).toEqual([]);
  });

  it('is locked in completedDirectiveCleanupScopes with a broad glob', () => {
    const completed = extractScopeArray('completedDirectiveCleanupScopes');
    expect(completed).toContain('packages/policy/src/**/*.{ts,tsx}');
  });

  it('is no longer in legacyDirectiveCleanupScopes', () => {
    const legacy = extractScopeArray('legacyDirectiveCleanupScopes');
    const policyEntries = legacy.filter((e) => e.startsWith('packages/policy'));
    expect(
      policyEntries,
      'Legacy policy entries: ' + policyEntries.join(', '),
    ).toEqual([]);
  });
});

describe('packages/a2a-server directive cleanup (#2123)', () => {
  const a2aSrcDir = join(repoRoot, 'packages', 'a2a-server', 'src');

  it('has zero inline ESLint disable/enable directives', () => {
    const offenders = scanPackageDirectives(a2aSrcDir, '2123').map(
      (v) => `${v.file}:${v.lineNumber}`,
    );
    expect(offenders, 'Found directives: ' + offenders.join(', ')).toEqual([]);
  });

  it('is locked in completedDirectiveCleanupScopes with a broad glob', () => {
    const completed = extractScopeArray('completedDirectiveCleanupScopes');
    expect(completed).toContain('packages/a2a-server/src/**/*.{ts,tsx}');
  });

  it('is no longer in legacyDirectiveCleanupScopes', () => {
    const legacy = extractScopeArray('legacyDirectiveCleanupScopes');
    const a2aEntries = legacy.filter((e) =>
      e.startsWith('packages/a2a-server'),
    );
    expect(
      a2aEntries,
      'Legacy a2a-server entries: ' + a2aEntries.join(', '),
    ).toEqual([]);
  });
});
