/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  buildRipgrepArgs,
  type RipgrepIgnoreOptions,
} from '../tools/ripGrep.js';

const defaultIgnore: RipgrepIgnoreOptions = {
  respectGitIgnore: true,
  respectLlxprtIgnore: true,
  llxprtIgnoreFilePath: null,
};

function indexOfPair(args: readonly string[], flag: string): number {
  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] === flag) {
      return i;
    }
  }
  return -1;
}

function pairValue(args: readonly string[], flag: string): string | undefined {
  const idx = indexOfPair(args, flag);
  return idx === -1 ? undefined : args[idx + 1];
}

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

const PATTERN = 'needle';
const ABS_PATH = '/tmp/search-root';

describe('buildRipgrepArgs', () => {
  it('does not include --no-ignore when respectGitIgnore is true', () => {
    const args = buildRipgrepArgs(PATTERN, ABS_PATH, undefined, defaultIgnore);
    expect(hasFlag(args, '--no-ignore')).toBe(false);
  });

  it('includes --no-ignore when respectGitIgnore is false', () => {
    const args = buildRipgrepArgs(PATTERN, ABS_PATH, undefined, {
      ...defaultIgnore,
      respectGitIgnore: false,
    });
    expect(hasFlag(args, '--no-ignore')).toBe(true);
  });

  it('includes --ignore-file with the path when respectLlxprtIgnore is true and a path is provided', () => {
    const ignorePath = '/repo/.llxprtignore';
    const args = buildRipgrepArgs(PATTERN, ABS_PATH, undefined, {
      ...defaultIgnore,
      respectLlxprtIgnore: true,
      llxprtIgnoreFilePath: ignorePath,
    });
    expect(pairValue(args, '--ignore-file')).toBe(ignorePath);
  });

  it('does not include --ignore-file when respectLlxprtIgnore is false', () => {
    const args = buildRipgrepArgs(PATTERN, ABS_PATH, undefined, {
      ...defaultIgnore,
      respectLlxprtIgnore: false,
      llxprtIgnoreFilePath: '/repo/.llxprtignore',
    });
    expect(hasFlag(args, '--ignore-file')).toBe(false);
  });

  it('does not include --ignore-file when respectLlxprtIgnore is true but path is null', () => {
    const args = buildRipgrepArgs(PATTERN, ABS_PATH, undefined, {
      ...defaultIgnore,
      respectLlxprtIgnore: true,
      llxprtIgnoreFilePath: null,
    });
    expect(hasFlag(args, '--ignore-file')).toBe(false);
  });

  it('includes both --no-ignore and --ignore-file when respectGitIgnore=false and respectLlxprtIgnore=true with a path', () => {
    const ignorePath = '/repo/.llxprtignore';
    const args = buildRipgrepArgs(PATTERN, ABS_PATH, undefined, {
      respectGitIgnore: false,
      respectLlxprtIgnore: true,
      llxprtIgnoreFilePath: ignorePath,
    });
    expect(hasFlag(args, '--no-ignore')).toBe(true);
    expect(pairValue(args, '--ignore-file')).toBe(ignorePath);
  });

  it('always includes baseline --glob excludes regardless of ignore flags', () => {
    const args = buildRipgrepArgs(PATTERN, ABS_PATH, undefined, {
      respectGitIgnore: false,
      respectLlxprtIgnore: false,
      llxprtIgnoreFilePath: null,
    });
    const globValues = args.filter((_value, idx) => args[idx - 1] === '--glob');
    const expectedExcludes = [
      '!.git',
      '!node_modules',
      '!bower_components',
      '!*.log',
      '!*.tmp',
      '!build',
      '!dist',
      '!coverage',
    ];
    expectedExcludes.forEach((ex) => expect(globValues).toContain(ex));
  });

  it('includes the include glob when an include pattern is provided', () => {
    const args = buildRipgrepArgs(PATTERN, ABS_PATH, '*.ts', defaultIgnore);
    const positiveGlobs = args.filter(
      (_value, idx) => args[idx - 1] === '--glob' && !args[idx].startsWith('!'),
    );
    expect(positiveGlobs).toContain('*.ts');
  });

  it('does not add a positive include glob when include is undefined', () => {
    const args = buildRipgrepArgs(PATTERN, ABS_PATH, undefined, defaultIgnore);
    const positiveGlobs = args.filter(
      (_value, idx) => args[idx - 1] === '--glob' && !args[idx].startsWith('!'),
    );
    expect(positiveGlobs).toEqual([]);
  });

  it('places the pattern after --regexp', () => {
    const args = buildRipgrepArgs(PATTERN, ABS_PATH, undefined, defaultIgnore);
    expect(pairValue(args, '--regexp')).toBe(PATTERN);
  });

  it('appends the absolute path as the final positional argument', () => {
    const args = buildRipgrepArgs(PATTERN, ABS_PATH, undefined, defaultIgnore);
    expect(args[args.length - 1]).toBe(ABS_PATH);
  });
});
