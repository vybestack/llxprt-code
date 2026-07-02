/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  CLI_TYPE_ESCAPE_ALLOWLIST,
  TYPE_ESCAPE_PATTERNS,
} from './constants.mjs';
import { checkModuleDirectiveScopesInConfig } from './bypass-detector.mjs';
import { listTsFiles, scanModuleDirectives } from './scanners.mjs';

const CLI_TEST_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
  '-test-helpers.ts',
  '-test-helpers.tsx',
];

function isCliProductionTypeScriptFile(filePath) {
  if (!/\.(?:ts|tsx)$/.test(filePath)) {
    return false;
  }
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const fileName = parts[parts.length - 1];
  const isTestDir = parts.includes('__tests__') || parts.includes('test-utils');
  const isTestFile = CLI_TEST_SUFFIXES.some((suffix) =>
    fileName.endsWith(suffix),
  );
  return !isTestDir && !isTestFile;
}

function detectTypeEscape(line) {
  for (const { pattern, label } of TYPE_ESCAPE_PATTERNS) {
    if (pattern.test(line)) {
      return label;
    }
  }
  return null;
}

function matchingCliTypeEscapeAllowlistEntry(relativePath, label, content) {
  return CLI_TYPE_ESCAPE_ALLOWLIST.find(
    (entry) =>
      entry.file === relativePath &&
      entry.label === label &&
      content.trim() === entry.content,
  );
}

export function scanCliProductionTypeEscapes(baseDir = process.cwd()) {
  const cliSource = join(baseDir, 'packages', 'cli', 'src');
  if (!existsSync(cliSource)) {
    return [];
  }
  const allowCounts = new Map();
  const violations = [];
  for (const file of listTsFiles(cliSource)) {
    const relativePath = relative(baseDir, file).replace(/\\/g, '/');
    if (!isCliProductionTypeScriptFile(relativePath)) {
      continue;
    }
    scanCliFileForTypeEscapes(file, relativePath, allowCounts, violations);
  }
  return violations;
}

function scanCliFileForTypeEscapes(
  file,
  relativePath,
  allowCounts,
  violations,
) {
  const lines = readFileSync(file, 'utf8').split(String.fromCharCode(10));
  for (let i = 0; i < lines.length; i++) {
    const content = lines[i];
    const label = detectTypeEscape(content);
    if (label === null) {
      continue;
    }
    const isAllowed = isWithinAllowLimit(
      relativePath,
      label,
      content,
      allowCounts,
    );
    if (!isAllowed) {
      pushTypeEscapeViolation(violations, relativePath, i + 1, label, content);
    }
  }
}

function isWithinAllowLimit(relativePath, label, content, allowCounts) {
  const allowEntry = matchingCliTypeEscapeAllowlistEntry(
    relativePath,
    label,
    content,
  );
  if (allowEntry === undefined) {
    return false;
  }
  const key = `${allowEntry.issue}:${allowEntry.file}:${allowEntry.content}`;
  const nextCount = (allowCounts.get(key) ?? 0) + 1;
  allowCounts.set(key, nextCount);
  return nextCount <= allowEntry.max;
}

function pushTypeEscapeViolation(violations, file, lineNumber, label, content) {
  violations.push({
    file,
    lineNumber,
    message:
      `Production CLI TypeScript escape hatch '${label}' is forbidden by #2174; ` +
      'use a real type, type guard, validator, or shared adapter.',
    content,
  });
}

export function checkCliSourcePolicy() {
  const violations = scanModuleDirectives('packages/cli/src', '2114');
  const configPath = join(process.cwd(), 'eslint.config.js');
  if (!existsSync(configPath)) {
    return violations;
  }

  const configSource = readFileSync(configPath, 'utf8');
  violations.push(
    ...checkModuleDirectiveScopesInConfig(
      configSource,
      'packages/cli/src',
      '2114',
    ),
  );
  return violations;
}
