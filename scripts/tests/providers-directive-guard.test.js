/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..', '..');
const PROVIDERS_PACKAGE = join(REPO_ROOT, 'packages', 'providers');
const ESLINT_CONFIG_PATH = join(REPO_ROOT, 'eslint.config.js');

const ESLINT_PREFIX = 'eslint-';
const DIRECTIVE_PATTERN = new RegExp(
  ESLINT_PREFIX + 'disable(?:-next-line|-line)?|' + ESLINT_PREFIX + 'enable',
);
const PROVIDER_PATH = 'packages/providers/';
const SUPPRESSION_PATTERN =
  /\b(?:ignores|legacyDirectiveCleanupScopes|completedDirectiveCleanupScopes)\b|['"]off['"]|:\s*0\b/;

/**
 * @param {string} content
 * @param {number} index
 * @returns {{start: number, end: number}}
 */
function findEnclosingBraceBlock(content, index) {
  const stack = [];
  for (let i = 0; i <= index; i++) {
    if (content[i] === '{') {
      stack.push(i);
    } else if (content[i] === '}') {
      stack.pop();
    }
  }

  const start = stack.at(-1) ?? 0;
  let depth = 0;
  for (let i = start; i < content.length; i++) {
    if (content[i] === '{') {
      depth += 1;
    } else if (content[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return { start, end: i + 1 };
      }
    }
  }

  return { start, end: content.length };
}

/**
 * @param {string} content
 * @param {number} index
 * @returns {number}
 */
function getLineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

/**
 * Recursively collect all .ts/.tsx files under a directory.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function collectTypeScriptFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      if (
        entry === 'coverage' ||
        entry === 'dist' ||
        entry === 'node_modules'
      ) {
        continue;
      }
      results.push(...collectTypeScriptFiles(fullPath));
    } else if (stats.isFile() && /\.(?:[cm]?tsx?|[cm]?jsx?)$/.test(entry)) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('packages/providers inline ESLint directive guard (#2116)', () => {
  it('contains zero ESLint directive suppressions in providers package', () => {
    const files = collectTypeScriptFiles(PROVIDERS_PACKAGE);
    const violations = [];

    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (DIRECTIVE_PATTERN.test(lines[i])) {
          violations.push(
            relative(REPO_ROOT, filePath) +
              ':' +
              (i + 1) +
              ': ' +
              lines[i].trim(),
          );
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('eslint.config.js has no provider-specific central exclusions or rule-off blocks', () => {
    const configContent = readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    const violations = [];
    const providerPathPattern = new RegExp(PROVIDER_PATH, 'g');
    let match = providerPathPattern.exec(configContent);

    while (match !== null) {
      const block = findEnclosingBraceBlock(configContent, match.index);
      const context = configContent.slice(block.start, block.end);
      if (SUPPRESSION_PATTERN.test(context)) {
        const lineNumber = getLineNumber(configContent, match.index);
        violations.push(
          relative(REPO_ROOT, ESLINT_CONFIG_PATH) +
            ':' +
            lineNumber +
            ': provider ESLint suppression in config',
        );
      }
      match = providerPathPattern.exec(configContent);
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
