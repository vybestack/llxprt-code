#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const DEFAULT_BASE = process.env.GITHUB_BASE_REF
  ? 'origin/' + process.env.GITHUB_BASE_REF
  : 'origin/main';

const POLICY_PATHS = ['.'];

function parseArgs(argv) {
  const args = {
    base: process.env.ESLINT_GUARD_BASE || DEFAULT_BASE,
    head: process.env.ESLINT_GUARD_HEAD || 'HEAD',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base') {
      args.base = argv[++i];
    } else if (arg === '--head') {
      args.head = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/check-eslint-guard.js [--base REF] [--head REF]',
      );
      process.exit(0);
    } else {
      throw new Error('Unknown argument: ' + arg);
    }
  }

  return args;
}

const GIT_OUTPUT_BUFFER_BYTES = 64 * 1024 * 1024;

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: GIT_OUTPUT_BUFFER_BYTES,
  }).trim();
}

function resolveBase(base, head) {
  try {
    return git(['merge-base', base, head]);
  } catch {
    return base;
  }
}

function diffFromGit(base, head) {
  const resolvedBase = resolveBase(base, head);

  if (head === 'HEAD') {
    return git([
      'diff',
      '--unified=0',
      '--no-ext-diff',
      resolvedBase,
      '--',
      ...POLICY_PATHS,
    ]);
  }

  return git([
    'diff',
    '--unified=0',
    '--no-ext-diff',
    resolvedBase + '...' + head,
    '--',
    ...POLICY_PATHS,
  ]);
}

function isGeneratedGuardFixture(file) {
  return (
    file === 'scripts/check-eslint-guard.js' ||
    file === 'scripts/tests/eslint-guard.test.js'
  );
}

function startsWithAddedContent(line) {
  return line.startsWith('+') && !line.startsWith('+++');
}

function startsWithRemovedContent(line) {
  return line.startsWith('-') && !line.startsWith('---');
}

function addedContent(line) {
  return line.slice(1);
}

function removedContent(line) {
  return line.slice(1);
}

function isAllowedPolicyOff(line) {
  return line.includes('eslint-policy-allow-off:');
}

function isNewOffRule(line) {
  return (
    /:\s*['"]off['"]/.test(line) ||
    /:\s*0\b/.test(line) ||
    /\[\s*['"]off['"]/.test(line)
  );
}

function isStandaloneOffRuleValue(line) {
  // Allows optional trailing inline comments, e.g. `'off', // comment` or `0, // x`
  return /^\s*(?:['"]off['"]|0),?\s*(?:\/\/.*)?$/.test(line);
}

function shouldCheckInlineDisable(file) {
  if (isGeneratedGuardFixture(file)) {
    return false;
  }
  return /\.(?:cjs|mjs|js|jsx|ts|tsx)$/.test(file);
}

function addViolation(violations, file, lineNumber, message, content) {
  violations.push({ file, lineNumber, message, content });
}

export function checkDiff(diff) {
  const violations = [];
  const policyState = {
    removedInlineDisableBan: null,
    addedInlineDisableBan: false,
    removedMaxWarnings: null,
    addedMaxWarnings: false,
  };
  let file = '';
  let newLine = 0;
  let oldLine = 0;

  for (const line of diff.split('\n')) {
    const fileMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (fileMatch) {
      file = fileMatch[2];
      newLine = 0;
      oldLine = 0;
      continue;
    }

    const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      continue;
    }

    if (!file) {
      continue;
    }

    if (startsWithAddedContent(line)) {
      const content = addedContent(line);
      const currentLine = newLine;

      if (
        shouldCheckInlineDisable(file) &&
        /eslint-disable(?:-next-line|-line)?\b/.test(content)
      ) {
        addViolation(
          violations,
          file,
          currentLine,
          'Inline ESLint disable directives are forbidden by #2079/#2080.',
          content,
        );
      }

      if (
        file === 'eslint.config.js' &&
        isNewOffRule(content) &&
        !isAllowedPolicyOff(content)
      ) {
        addViolation(
          violations,
          file,
          currentLine,
          'New ESLint off/0 entries must be explicitly justified with eslint-policy-allow-off.',
          content,
        );
      }

      if (
        file === 'eslint.config.js' &&
        content.includes('eslint-comments/no-use') &&
        !content.includes("'off'") &&
        !content.includes('"off"')
      ) {
        policyState.addedInlineDisableBan = true;
      }
      if (file === 'package.json' && content.includes('--max-warnings 0')) {
        policyState.addedMaxWarnings = true;
      }
      newLine += 1;
      continue;
    }

    if (startsWithRemovedContent(line)) {
      const content = removedContent(line);
      const currentLine = oldLine;
      if (
        file === 'eslint.config.js' &&
        content.includes('eslint-comments/no-use') &&
        !content.includes("'off'") &&
        !content.includes('"off"')
      ) {
        policyState.removedInlineDisableBan = {
          file,
          lineNumber: currentLine,
          content,
        };
      }
      if (file === 'package.json' && content.includes('--max-warnings 0')) {
        policyState.removedMaxWarnings = {
          file,
          lineNumber: currentLine,
          content,
        };
      }
      oldLine += 1;
      continue;
    }

    if (!line.startsWith('\\')) {
      oldLine += 1;
      newLine += 1;
    }
  }

  if (
    policyState.removedInlineDisableBan &&
    !policyState.addedInlineDisableBan
  ) {
    addViolation(
      violations,
      policyState.removedInlineDisableBan.file,
      policyState.removedInlineDisableBan.lineNumber,
      'Do not remove or weaken the inline-disable ban from eslint.config.js.',
      policyState.removedInlineDisableBan.content,
    );
  }
  if (policyState.removedMaxWarnings && !policyState.addedMaxWarnings) {
    addViolation(
      violations,
      policyState.removedMaxWarnings.file,
      policyState.removedMaxWarnings.lineNumber,
      'Do not remove --max-warnings 0 from lint:ci.',
      policyState.removedMaxWarnings.content,
    );
  }
  return violations;
}

const DIRECTIVE_PATTERN = /eslint-(?:disable|enable)(?:-next-line|-line)?\b/;

const GENERATED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
]);

const BINARY_EXTENSIONS = new Set([
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

function isScannableTextFile(fileName) {
  return !BINARY_EXTENSIONS.has(extname(fileName).toLowerCase());
}

function scanDirectoryForDirectives(rootDir) {
  const violations = [];
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && GENERATED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      violations.push(...scanDirectoryForDirectives(fullPath));
    } else if (entry.isFile() && isScannableTextFile(entry.name)) {
      violations.push(...scanFileForDirectives(fullPath));
    }
  }
  return violations;
}

function scanFileForDirectives(filePath) {
  const violations = [];
  const contents = readFileSync(filePath, 'utf8');
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (DIRECTIVE_PATTERN.test(line)) {
      violations.push({
        file: relative(process.cwd(), filePath),
        lineNumber: i + 1,
        message:
          'Inline ESLint disable/enable directives are forbidden in packages/core by #2115.',
        content: line,
      });
    }
  }
  return violations;
}

/**
 * Scans the packages/core directory for any inline ESLint disable/enable
 * directives. Returns a list of violations; an empty array means the policy is
 * satisfied. Issue #2115 requires zero such directives in packages/core.
 */
export function scanCoreDirectives(coreDir) {
  const target = coreDir || join(process.cwd(), 'packages', 'core');
  if (!existsSync(target)) {
    return [];
  }
  return scanDirectoryForDirectives(target);
}

/**
 * Inspects eslint.config.js source text and returns any directive cleanup scope
 * entries that reference packages/core. Issue #2115 requires packages/core to
 * be removed from both temporary and completed central directive lists.
 */
export function checkCoreDirectiveScopesInConfig(configSource) {
  const violations = [];
  const lines = configSource.split('\n');
  let currentScope = null;
  let currentStatement = '';
  let currentStartLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const scopeMatch =
      /^const\s+(legacyDirectiveCleanupScopes|completedDirectiveCleanupScopes)\s*=/.exec(
        line,
      );
    if (scopeMatch) {
      currentScope = scopeMatch[1];
      currentStatement = line;
      currentStartLine = i + 1;
    } else if (currentScope !== null) {
      currentStatement += '\n' + line;
    }

    if (currentScope !== null && /;\s*(?:\/\/.*)?$/.test(line)) {
      if (currentStatement.includes('packages/core')) {
        violations.push({
          file: 'eslint.config.js',
          lineNumber: currentStartLine,
          message: `packages/core must not remain in ${currentScope} (#2115).`,
          content: currentStatement,
        });
      }
      currentScope = null;
      currentStatement = '';
    }
  }
  return violations;
}

function isCommentOnlyLine(line) {
  return line.trim().startsWith('//');
}

function extractArrayStart(line) {
  const match = /^\s*(?:const\s+)?([A-Za-z0-9_$-]+)\s*(?::|=)\s*\[/.exec(line);
  if (match !== null) {
    return match[1];
  }
  const allowMatch = /\ballow\s*:\s*\[/.exec(line);
  return allowMatch === null ? null : 'allow';
}

function isCorePathLine(line) {
  return !isCommentOnlyLine(line) && line.includes('packages/core');
}

function hasCoreCentralBypassOnSingleLine(line) {
  if (!isCorePathLine(line)) {
    return null;
  }
  if (/\bignores\s*:/.test(line)) {
    return 'scoped ignore';
  }
  if (
    /\brules\s*:/.test(line) &&
    (isNewOffRule(line) || isStandaloneOffRuleValue(line))
  ) {
    return 'rule-off';
  }
  return null;
}

function coreCentralBypassMessage(kind) {
  return `packages/core must not be covered by central ESLint ${kind} entries (#2115).`;
}

function countBraceDelta(line) {
  let delta = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (quote === null && char === '/' && next === '/') {
      break;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote !== null) {
      if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === '{') {
      delta += 1;
    } else if (char === '}') {
      delta -= 1;
    }
  }

  return delta;
}

function countOpeningBraces(line) {
  let count = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (quote === null && char === '/' && next === '/') {
      break;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote !== null) {
      if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === '{') {
      count += 1;
    }
  }

  return count;
}

function enclosingObjectDepth(line, braceDepth) {
  const coreIndex = line.indexOf('packages/core');
  const openIndex = line.indexOf('{');
  if (openIndex !== -1 && openIndex < coreIndex) {
    return braceDepth + 1;
  }
  return braceDepth;
}

/**
 * Inspects eslint.config.js source text for packages/core central bypasses that
 * would reintroduce the old suppression pattern outside source files.
 */
export function checkCoreCentralBypassesInConfig(configSource) {
  const violations = [];
  const lines = configSource.split('\n');
  let currentArray = null;
  let braceDepth = 0;
  let coreObjectDepth = null;
  let rulesObjectDepth = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    const arrayStart = extractArrayStart(line);
    if (arrayStart !== null) {
      currentArray = arrayStart;
    }

    if (currentArray !== null && /^\s*\]/.test(line)) {
      currentArray = null;
    }

    const singleLineBypass = hasCoreCentralBypassOnSingleLine(line);
    if (singleLineBypass !== null) {
      violations.push({
        file: 'eslint.config.js',
        lineNumber,
        message: coreCentralBypassMessage(singleLineBypass),
        content: line,
      });
    }

    if (isCorePathLine(line)) {
      if (currentArray === 'ignores') {
        violations.push({
          file: 'eslint.config.js',
          lineNumber,
          message: coreCentralBypassMessage('ignore'),
          content: line,
        });
      } else if (currentArray === 'allow') {
        violations.push({
          file: 'eslint.config.js',
          lineNumber,
          message: coreCentralBypassMessage('allow-list'),
          content: line,
        });
      }
      coreObjectDepth = enclosingObjectDepth(line, braceDepth);
    }

    const inCoreObject =
      coreObjectDepth !== null && braceDepth >= coreObjectDepth;
    if (inCoreObject) {
      if (/^\s*ignores\s*:/.test(line)) {
        violations.push({
          file: 'eslint.config.js',
          lineNumber,
          message: coreCentralBypassMessage('scoped ignore'),
          content: line,
        });
      }
      if (/^\s*rules\s*:/.test(line)) {
        rulesObjectDepth = braceDepth + countOpeningBraces(line);
      }
      if (
        rulesObjectDepth !== null &&
        (isNewOffRule(line) || isStandaloneOffRuleValue(line))
      ) {
        violations.push({
          file: 'eslint.config.js',
          lineNumber,
          message: coreCentralBypassMessage('rule-off'),
          content: line,
        });
      }
    }

    braceDepth += countBraceDelta(line);
    if (rulesObjectDepth !== null && braceDepth < rulesObjectDepth) {
      rulesObjectDepth = null;
    }
    if (coreObjectDepth !== null && braceDepth < coreObjectDepth) {
      coreObjectDepth = null;
      rulesObjectDepth = null;
    }
  }

  return violations;
}

export function formatViolations(violations) {
  return violations
    .map((violation) => {
      const location = violation.file + ':' + violation.lineNumber;
      return (
        location + ' ' + violation.message + '\n  ' + violation.content.trim()
      );
    })
    .join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const diff = diffFromGit(args.base, args.head);
  const violations = checkDiff(diff);

  // Issue #2115 durable guard: packages/core must contain zero inline ESLint
  // disable/enable directives and must not be present in central directive
  // cleanup scope lists.
  const coreDirectiveViolations = scanCoreDirectives();
  violations.push(...coreDirectiveViolations);

  const configPath = join(process.cwd(), 'eslint.config.js');
  if (existsSync(configPath)) {
    const configSource = readFileSync(configPath, 'utf8');
    violations.push(...checkCoreDirectiveScopesInConfig(configSource));
    violations.push(...checkCoreCentralBypassesInConfig(configSource));
  }

  if (violations.length === 0) {
    console.log('ESLint policy guard passed.');
    return;
  }

  console.error('ESLint policy guard failed:');
  console.error(formatViolations(violations));
  process.exit(1);
}

if (import.meta.url === 'file://' + process.argv[1]) {
  main();
}
