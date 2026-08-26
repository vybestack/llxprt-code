/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the pure helper functions extracted into cliSandbox.ts
 * (#2378 review remediation). These test the OBSERVABLE input→output
 * transformation of each pure helper without touching process spawning or
 * the full sandbox hop.
 */

import { describe, expect, it } from 'bun:test';
import {
  resolveContainerMemoryMB,
  findFirstPositionalArgIndex,
  injectStdinIntoArgs,
} from './cliSandbox.js';

function restoreEnvironmentVariable(
  name: 'LLXPRT_SANDBOX_MEMORY' | 'SANDBOX_MEMORY' | 'SANDBOX_FLAGS',
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe('resolveContainerMemoryMB', () => {
  it('returns undefined when no memory env vars are set', () => {
    const oldMem = process.env.LLXPRT_SANDBOX_MEMORY;
    const oldSb = process.env.SANDBOX_MEMORY;
    const oldFlags = process.env.SANDBOX_FLAGS;
    delete process.env.LLXPRT_SANDBOX_MEMORY;
    delete process.env.SANDBOX_MEMORY;
    delete process.env.SANDBOX_FLAGS;

    try {
      expect(resolveContainerMemoryMB()).toBeUndefined();
    } finally {
      restoreEnvironmentVariable('LLXPRT_SANDBOX_MEMORY', oldMem);
      restoreEnvironmentVariable('SANDBOX_MEMORY', oldSb);
      restoreEnvironmentVariable('SANDBOX_FLAGS', oldFlags);
    }
  });

  it('returns undefined when memory env var is an empty string', () => {
    const oldMem = process.env.LLXPRT_SANDBOX_MEMORY;
    process.env.LLXPRT_SANDBOX_MEMORY = '';

    try {
      expect(resolveContainerMemoryMB()).toBeUndefined();
    } finally {
      restoreEnvironmentVariable('LLXPRT_SANDBOX_MEMORY', oldMem);
    }
  });

  it('parses LLXPRT_SANDBOX_MEMORY in human-readable units', () => {
    const oldMem = process.env.LLXPRT_SANDBOX_MEMORY;
    process.env.LLXPRT_SANDBOX_MEMORY = '2g';

    try {
      const result = resolveContainerMemoryMB();
      expect(result).toBe(2048);
    } finally {
      restoreEnvironmentVariable('LLXPRT_SANDBOX_MEMORY', oldMem);
    }
  });

  it('parses --memory=value from SANDBOX_FLAGS when memory env vars are absent', () => {
    const oldMem = process.env.LLXPRT_SANDBOX_MEMORY;
    const oldSb = process.env.SANDBOX_MEMORY;
    const oldFlags = process.env.SANDBOX_FLAGS;
    delete process.env.LLXPRT_SANDBOX_MEMORY;
    delete process.env.SANDBOX_MEMORY;
    process.env.SANDBOX_FLAGS = '--cpu-shares=512 --memory=512m';

    try {
      const result = resolveContainerMemoryMB();
      expect(result).toBe(512);
    } finally {
      restoreEnvironmentVariable('LLXPRT_SANDBOX_MEMORY', oldMem);
      restoreEnvironmentVariable('SANDBOX_MEMORY', oldSb);
      restoreEnvironmentVariable('SANDBOX_FLAGS', oldFlags);
    }
  });

  it('parses --memory value (space-separated) from SANDBOX_FLAGS', () => {
    const oldMem = process.env.LLXPRT_SANDBOX_MEMORY;
    const oldSb = process.env.SANDBOX_MEMORY;
    const oldFlags = process.env.SANDBOX_FLAGS;
    delete process.env.LLXPRT_SANDBOX_MEMORY;
    delete process.env.SANDBOX_MEMORY;
    process.env.SANDBOX_FLAGS = '--memory 1024m';

    try {
      const result = resolveContainerMemoryMB();
      expect(result).toBe(1024);
    } finally {
      restoreEnvironmentVariable('LLXPRT_SANDBOX_MEMORY', oldMem);
      restoreEnvironmentVariable('SANDBOX_MEMORY', oldSb);
      restoreEnvironmentVariable('SANDBOX_FLAGS', oldFlags);
    }
  });
});

describe('findFirstPositionalArgIndex', () => {
  it('returns -1 when there are no positional arguments', () => {
    expect(
      findFirstPositionalArgIndex(['node', 'cli.tsx', '--prompt', 'hello']),
    ).toBe(-1);
  });

  it('returns the index of the first positional argument after node and script', () => {
    expect(
      findFirstPositionalArgIndex(['node', 'cli.tsx', 'write', 'a', 'haiku']),
    ).toBe(2);
  });

  it('skips flags that consume the next value', () => {
    expect(
      findFirstPositionalArgIndex([
        'node',
        'cli.tsx',
        '--prompt',
        'hello',
        'positional',
      ]),
    ).toBe(4);
  });

  it('treats equals-form flags as not consuming the next token', () => {
    expect(
      findFirstPositionalArgIndex([
        'node',
        'cli.tsx',
        '--prompt=hello',
        'positional',
      ]),
    ).toBe(3);
  });

  it('returns -1 when only flags are present starting from index 2', () => {
    expect(
      findFirstPositionalArgIndex(['node', 'cli.tsx', '--flag', '--other']),
    ).toBe(-1);
  });
});

describe('injectStdinIntoArgs', () => {
  it('returns args unchanged when stdinData is empty', () => {
    const args = ['node', 'cli.tsx', '--prompt', 'hello'];
    expect(injectStdinIntoArgs(args, undefined)).toStrictEqual(args);
  });

  it('returns args unchanged when stdinData is empty string', () => {
    const args = ['node', 'cli.tsx', '--prompt', 'hello'];
    expect(injectStdinIntoArgs(args, '')).toStrictEqual(args);
  });

  it('prepends stdin to the --prompt flag value', () => {
    const args = ['node', 'cli.tsx', '--prompt', 'original'];
    const result = injectStdinIntoArgs(args, 'piped data');

    expect(result[2]).toBe('--prompt');
    expect(result[3]).toContain('piped data');
    expect(result[3]).toContain('original');
  });

  it('prepends stdin to the first positional argument when no --prompt flag', () => {
    const args = ['node', 'cli.tsx', 'write', 'a', 'haiku'];
    const result = injectStdinIntoArgs(args, 'piped data');

    expect(result[2]).toContain('piped data');
    expect(result[2]).toContain('write');
    expect(result[3]).toBe('a');
    expect(result[4]).toBe('haiku');
  });

  it('appends stdin as a new positional argument when none exists', () => {
    const args = ['node', 'cli.tsx', '--flag'];
    const result = injectStdinIntoArgs(args, 'piped data');

    expect(result[result.length - 1]).toBe('piped data');
  });

  it('does not mutate the original args array', () => {
    const args = ['node', 'cli.tsx', '--prompt', 'original'];
    const original = [...args];
    injectStdinIntoArgs(args, 'piped data');

    expect(args).toStrictEqual(original);
  });
});
