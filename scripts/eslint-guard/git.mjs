/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import {
  DEFAULT_BASE,
  DIFF_CONTEXT_LINES,
  GIT_OUTPUT_BUFFER_BYTES,
  POLICY_PATHS,
} from './constants.mjs';

export function parseArgs(argv) {
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

export function git(args, cwd) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: GIT_OUTPUT_BUFFER_BYTES,
    ...(cwd ? { cwd } : {}),
  }).trim();
}

export function resolveBase(base, head) {
  try {
    return git(['merge-base', base, head]);
  } catch {
    return base;
  }
}

export function diffFromGit(base, head) {
  const resolvedBase = resolveBase(base, head);

  if (head === 'HEAD') {
    return git([
      'diff',
      '--unified=' + DIFF_CONTEXT_LINES,
      '--no-ext-diff',
      resolvedBase,
      '--',
      ...POLICY_PATHS,
    ]);
  }

  return git([
    'diff',
    '--unified=' + DIFF_CONTEXT_LINES,
    '--no-ext-diff',
    resolvedBase + '...' + head,
    '--',
    ...POLICY_PATHS,
  ]);
}
