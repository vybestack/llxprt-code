#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';

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

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
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
