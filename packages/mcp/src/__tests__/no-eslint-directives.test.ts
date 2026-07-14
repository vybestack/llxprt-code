/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const MCP_PACKAGE_DIR = join(import.meta.dirname, '..', '..');

const EXCLUDED_DIRS = new Set(['dist', 'node_modules', '.git']);

const DIRECTIVE_PREFIX = 'eslint-' + 'disable';
const DIRECTIVE_ENABLE = 'eslint-' + 'enable';
const DIRECTIVE_PATTERN = new RegExp(
  String.raw`${DIRECTIVE_PREFIX}(?:-next-line|-line)?\b|${DIRECTIVE_ENABLE}\b`,
);

function collectTypeScriptFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry)) {
        collectTypeScriptFiles(fullPath, files);
      }
    } else if (extname(fullPath) === '.ts' || extname(fullPath) === '.tsx') {
      files.push(fullPath);
    }
  }
  return files;
}

describe('mcp module ESLint directive guard (#2118)', () => {
  it(
    'contains zero inline ' +
      DIRECTIVE_PREFIX +
      ' or ' +
      DIRECTIVE_ENABLE +
      ' directives',
    () => {
      const violations: string[] = [];
      for (const file of collectTypeScriptFiles(MCP_PACKAGE_DIR)) {
        const lines = readFileSync(file, 'utf-8').split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (DIRECTIVE_PATTERN.test(lines[i])) {
            violations.push(`${file}:${i + 1}: ${lines[i].trim()}`);
          }
        }
      }
      expect(violations).toStrictEqual([]);
    },
  );
});
