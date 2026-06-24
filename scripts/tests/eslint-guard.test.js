/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkDiff, formatViolations } from '../check-eslint-guard.js';

const repoRoot = resolve(__dirname, '..', '..');

function listTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (/\.(?:ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const eslintConfigPath = join(repoRoot, 'eslint.config.js');
const eslintConfigSource = readFileSync(eslintConfigPath, 'utf8');

function extractScopeArray(name) {
  const start = eslintConfigSource.indexOf('const ' + name + ' = [');
  if (start === -1) {
    throw new Error(
      'Could not find scope const declaration for "' +
        name +
        '" in eslint.config.js',
    );
  }
  const arrayStart = eslintConfigSource.indexOf('[', start);
  let depth = 0;
  let end = -1;
  for (let i = arrayStart; i < eslintConfigSource.length; i++) {
    const ch = eslintConfigSource[i];
    if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error(
      'Could not parse closing bracket for scope const "' +
        name +
        '" in eslint.config.js',
    );
  }
  const body = eslintConfigSource.slice(arrayStart + 1, end);
  const entries = [];
  const re = /'([^']+)'/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    entries.push(m[1]);
  }
  return entries;
}

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
      'Inline ESLint disable directives are forbidden',
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

  it('rejects regex-related inline ESLint disables instead of allowing policy bypasses', () => {
    const violations = checkDiff(
      diffFor(
        'packages/core/src/example.ts',
        '// eslint-disable-next-line sonarjs/regular-expr, sonarjs/slow-regex',
      ),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain(
      'Inline ESLint disable directives are forbidden',
    );
  });
});

describe('packages/agents directive cleanup (#2117)', () => {
  const agentsSrcDir = join(repoRoot, 'packages', 'agents', 'src');

  it('has zero inline ESLint disable/enable directives', () => {
    const directiveRe = /eslint-(?:disable|enable)(?:-next-line|-line)?\b/;
    const offenders = [];
    for (const file of listTsFiles(agentsSrcDir)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (directiveRe.test(line)) {
          offenders.push(file.replace(repoRoot + '/', '') + ':' + (idx + 1));
        }
      });
    }
    expect(offenders, 'Found directives: ' + offenders.join(', ')).toEqual([]);
  });

  it('is locked in completedDirectiveCleanupScopes with a broad glob', () => {
    const completed = extractScopeArray('completedDirectiveCleanupScopes');
    expect(completed).toContain('packages/agents/src/**/*.{ts,tsx}');
  });

  it('is no longer in legacyDirectiveCleanupScopes', () => {
    const legacy = extractScopeArray('legacyDirectiveCleanupScopes');
    const agentsEntries = legacy.filter((e) => e.startsWith('packages/agents'));
    expect(
      agentsEntries,
      'Legacy agents entries: ' + agentsEntries.join(', '),
    ).toEqual([]);
  });
});
