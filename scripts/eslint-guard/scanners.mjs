/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import {
  BINARY_EXTENSIONS,
  DIRECTIVE_PATTERN,
  GENERATED_DIRECTORIES,
} from './constants.mjs';
import {
  hasInlineEslintDirective,
  hasTypeScriptSuppressionInState,
  scanTemplateLiteralState,
} from './directive-scanner.mjs';
import { git } from './git.mjs';

export function addViolation(violations, file, lineNumber, message, content) {
  violations.push({ file, lineNumber, message, content });
}

function scanDirectoryForDirectives(rootDir, modulePath, issueNumber) {
  const violations = [];
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && GENERATED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      violations.push(
        ...scanDirectoryForDirectives(fullPath, modulePath, issueNumber),
      );
    } else if (entry.isFile() && isScannableTextFile(entry.name)) {
      violations.push(
        ...scanFileForDirectives(fullPath, modulePath, issueNumber),
      );
    }
  }
  return violations;
}

function scanFileForDirectives(filePath, modulePath, issueNumber) {
  const violations = [];
  const contents = readFileSync(filePath, 'utf8');
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (hasInlineEslintDirective(line)) {
      violations.push({
        file: relative(process.cwd(), filePath),
        lineNumber: i + 1,
        message: `Inline ESLint disable/enable directives are forbidden in ${modulePath} by #${issueNumber}.`,
        content: line,
      });
    }
  }
  return violations;
}

function isScannableTextFile(fileName) {
  return !BINARY_EXTENSIONS.has(extname(fileName).toLowerCase());
}

/**
 * Scans a named package directory for any inline ESLint disable/enable
 * directives. Returns a list of violations; an empty array means the policy is
 * satisfied. The modulePath (e.g. "packages/core") and issueNumber are used to
 * build descriptive violation messages.
 */
export function scanModuleDirectives(modulePath, issueNumber, baseDir) {
  const target = baseDir || join(process.cwd(), ...modulePath.split('/'));
  if (!existsSync(target)) {
    return [];
  }
  return scanDirectoryForDirectives(target, modulePath, issueNumber);
}

/**
 * Scans the packages/core directory for any inline ESLint disable/enable
 * directives. Returns a list of violations; an empty array means the policy is
 * satisfied. Issue #2115 requires zero such directives in packages/core.
 */
export function scanCoreDirectives(coreDir) {
  if (coreDir) {
    return scanDirectoryForDirectives(coreDir, 'packages/core', '2115');
  }
  return scanModuleDirectives('packages/core', '2115');
}

/**
 * Recursively lists all TypeScript source files under rootDir, excluding
 * generated directories (node_modules, dist, coverage, .git).
 */
export function listTsFiles(rootDir) {
  const results = [];
  if (!existsSync(rootDir)) {
    return results;
  }
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && GENERATED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listTsFiles(fullPath));
    } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Recursively lists all checked source files (same extensions as
 * shouldCheckTypeScriptSuppression) under rootDir, excluding generated
 * directories (node_modules, dist, coverage, .git). Used by
 * scanPackageTypeScriptSuppressions so the full-tree durable scan covers the
 * same file extensions as the diff-based checkDiff detection, not just
 * .ts/.tsx.
 */
export function listCheckedSourceFiles(rootDir) {
  const results = [];
  if (!existsSync(rootDir)) {
    return results;
  }
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && GENERATED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listCheckedSourceFiles(fullPath));
    } else if (
      entry.isFile() &&
      /\.(?:cjs|mjs|js|jsx|ts|tsx)$/.test(entry.name)
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Lists checked source files under rootDir that are tracked by git, so the
 * durable full-repo TS-suppression scan mirrors the diff-based coverage
 * universe (which only ever sees tracked files). Runs `git ls-files` scoped to
 * rootDir; when rootDir is not inside a git repository (e.g. a temporary test
 * fixture created with mkdtempSync) git exits non-zero and this falls back to
 * listCheckedSourceFiles, leaving behaviour unchanged outside a real checkout.
 *
 * Because `git ls-files` only reports files in the git index, gitignored and
 * untracked content is excluded automatically. This prevents local-only
 * vendored copies of upstream repositories (research/, .worktrees/, etc.) from
 * producing false-positive suppression violations in dirty worktrees (#2282).
 */
function listGitTrackedCheckedSourceFiles(rootDir) {
  let raw;
  try {
    raw = git(['ls-files'], rootDir);
  } catch {
    // git is unavailable (e.g. temp-dir test fixtures outside a repo) — fall
    // back to the filesystem walk so those tests keep working.
    return listCheckedSourceFiles(rootDir);
  }
  // git succeeded: filter to tracked files only. An empty result means the
  // root has no tracked checked sources (all gitignored or fresh repo), so
  // return an empty list rather than falling back to the unfiltered walk,
  // which would reintroduce the exact false positives this filter prevents.
  const tracked = new Set(raw.split(String.fromCharCode(10)).filter(Boolean));
  return listCheckedSourceFiles(rootDir).filter((file) => {
    const rel = relative(rootDir, file).replace(/\\/g, '/');
    return tracked.has(rel);
  });
}

/**
 * Returns true when a checked source file is a production file (not a test
 * or test-helper file). Covers the same extensions as
 * shouldCheckTypeScriptSuppression (.js/.jsx/.ts/.tsx/.mjs/.cjs) and preserves
 * the test-file exclusions of isCliProductionTypeScriptFile (which only
 * handles .ts/.tsx). Used by scanPackageTypeScriptSuppressions so the
 * full-tree durable scan covers the same checked source extensions as the
 * diff-based checkDiff detection.
 */
const PRODUCTION_EXCLUDED_DIRS = ['__tests__', 'test-utils'];

const PRODUCTION_EXCLUDED_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.test.js',
  '.test.jsx',
  '.test.mjs',
  '.test.cjs',
  '.spec.ts',
  '.spec.tsx',
  '.spec.js',
  '.spec.jsx',
  '.spec.mjs',
  '.spec.cjs',
  '-test-helpers.ts',
  '-test-helpers.tsx',
  '-test-helpers.js',
  '-test-helpers.jsx',
  'test-setup.ts',
  'test-setup.tsx',
  'test-setup.js',
  'test-setup.jsx',
  'test-setup.mjs',
  'test-setup.cjs',
];

export function isProductionCheckedSourceFile(filePath) {
  if (!/\.(?:cjs|mjs|js|jsx|ts|tsx)$/.test(filePath)) {
    return false;
  }
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const fileName = parts[parts.length - 1];
  const isExcludedDir = PRODUCTION_EXCLUDED_DIRS.some((dir) =>
    parts.includes(dir),
  );
  const isExcludedFile = PRODUCTION_EXCLUDED_SUFFIXES.some((suffix) =>
    fileName.endsWith(suffix),
  );
  return !isExcludedDir && !isExcludedFile;
}

/**
 * Scans an arbitrary package source directory for inline ESLint disable/enable
 * directives. Each violation references the supplied issueNumber so guard test
 * failures point at the originating cleanup issue.
 */
export function scanPackageDirectives(packageDir, issueNumber) {
  const target = packageDir;
  if (!existsSync(target)) {
    return [];
  }
  const files = listTsFiles(target);
  const violations = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(String.fromCharCode(10));
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (DIRECTIVE_PATTERN.test(line)) {
        violations.push({
          file: relative(process.cwd(), file),
          lineNumber: i + 1,
          message: `Inline ESLint disable/enable directives are forbidden in this module (#${issueNumber}).`,
          content: line,
        });
      }
    }
  }
  return violations;
}

/**
 * Durable full-tree scan for TypeScript suppression directives
 * (@ts-ignore, @ts-expect-error, @ts-nocheck) in protected package source.
 * Unlike the diff-based checkDiff detection, this scans the entire checked-in
 * tree so that pre-existing suppressions are also caught. Returns violations
 * referencing the supplied issueNumber.
 *
 * Covers the same checked source extensions (.js/.jsx/.ts/.tsx/.mjs/.cjs) as
 * the diff-based shouldCheckTypeScriptSuppression so a JS file with a TS
 * suppression directive is caught by the full-tree scan, not just by
 * diff-based detection.
 *
 * Test files are excluded because @ts-expect-error is a legitimate testing
 * pattern (asserting that invalid types are rejected by the compiler). This
 * matches the production-only approach of scanCliProductionTypeEscapes.
 *
 * Template literal state is carried across lines within each file (using
 * hasTypeScriptSuppressionInState plus scanTemplateLiteralState), mirroring the
 * diff-based checkDiff detection. This avoids false positives on inert
 * documentation text inside a multiline template literal body (where // or
 * directive text is just template text, not a real comment) while still
 * flagging a real suppression comment after a closed template or inside a
 * template ${ ... } expression (#2189 review finding).
 */
export function scanPackageTypeScriptSuppressions(packageDir, issueNumber) {
  const target = packageDir;
  if (!existsSync(target)) {
    return [];
  }
  const files = listCheckedSourceFiles(target);
  const violations = [];
  for (const file of files) {
    const relativePath = relative(process.cwd(), file).replace(/\\/g, '/');
    if (!isProductionCheckedSourceFile(relativePath)) {
      continue;
    }
    const lines = readFileSync(file, 'utf8').split(String.fromCharCode(10));
    let templateLiteralState = { inTemplate: false, exprDepth: 0 };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (hasTypeScriptSuppressionInState(line, templateLiteralState)) {
        violations.push({
          file: relativePath,
          lineNumber: i + 1,
          message: `TypeScript suppression directives (@ts-ignore/@ts-expect-error/@ts-nocheck) are forbidden in this module (#${issueNumber}).`,
          content: line,
        });
      }
      templateLiteralState = scanTemplateLiteralState(
        line,
        templateLiteralState,
      );
    }
  }
  return violations;
}

/**
 * Durable full-tree scan for TypeScript suppression directives
 * (@ts-ignore, @ts-expect-error, @ts-nocheck) across the entire repository
 * root, mirroring the diff-based checkDiff coverage universe (POLICY_PATHS is
 * '.'). This closes the gap where scanPackageTypeScriptSuppressions only
 * scanned selected packages src directories: checkDiff rejects newly-added
 * real TS suppressions anywhere in the repo, so the durable scan must also
 * cover root-level scripts, config files, and other top-level source to keep
 * the durable guard as strong as the diff-based acceptance criteria (#2189
 * review finding).
 *
 * Coverage:
 *   - Same checked source extensions as shouldCheckTypeScriptSuppression
 *     (.js/.jsx/.ts/.tsx/.mjs/.cjs).
 *   - Excludes generated directories (node_modules, dist, coverage, .git) and
 *     gitignored/untracked content via listGitTrackedCheckedSourceFiles, so
 *     local vendored repos (research/, .worktrees/) cannot produce false
 *     positives (#2282).
 *   - Does NOT exempt the guard implementation/test fixture files:
 *     hasTypeScriptSuppressionInState skips string, template, and regex
 *     literals, so directive text used as fixture data cannot trigger a false
 *     positive. This matches shouldCheckTypeScriptSuppression, which also
 *     does not call isGeneratedGuardFixture.
 *   - Excludes test/spec/helper files via isProductionCheckedSourceFile,
 *     matching scanPackageTypeScriptSuppressions, because @ts-expect-error is
 *     a legitimate testing pattern.
 *
 * Template literal state is carried across lines within each file (using
 * hasTypeScriptSuppressionInState plus scanTemplateLiteralState), mirroring
 * scanPackageTypeScriptSuppressions and the diff-based checkDiff detection.
 */
export function scanRootTypeScriptSuppressions(rootDir, issueNumber) {
  const target = rootDir;
  if (!existsSync(target)) {
    return [];
  }
  // Only inspect git-tracked files so gitignored/untracked vendored content
  // (research/, .worktrees/) cannot produce false positives (#2282).
  const files = listGitTrackedCheckedSourceFiles(target);
  const violations = [];
  for (const file of files) {
    const relativePath = relative(target, file).replace(/\\/g, '/');
    if (!isProductionCheckedSourceFile(relativePath)) {
      continue;
    }
    const lines = readFileSync(file, 'utf8').split(String.fromCharCode(10));
    let templateLiteralState = { inTemplate: false, exprDepth: 0 };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (hasTypeScriptSuppressionInState(line, templateLiteralState)) {
        violations.push({
          file: relativePath,
          lineNumber: i + 1,
          message: `TypeScript suppression directives (@ts-ignore/@ts-expect-error/@ts-nocheck) are forbidden in checked source (#${issueNumber}).`,
          content: line,
        });
      }
      templateLiteralState = scanTemplateLiteralState(
        line,
        templateLiteralState,
      );
    }
  }
  return violations;
}
