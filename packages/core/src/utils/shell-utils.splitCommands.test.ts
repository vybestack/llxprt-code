/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, describe, it, beforeEach, afterEach, vi } from 'vitest';
import { splitCommands } from './shell-utils.js';

describe('splitCommands', () => {
  it('should keep 2>&1 redirection within a single command segment', () => {
    const result = splitCommands('ls nonexistent 2>&1');
    expect(result).toStrictEqual(['ls nonexistent 2>&1']);
  });

  it('should split && chains while preserving 2>&1 redirection in each segment', () => {
    const result = splitCommands('ls nonexistent 2>&1 && echo done');
    expect(result).toStrictEqual(['ls nonexistent 2>&1', 'echo done']);
  });

  it('should keep >&2 redirection within a single command segment', () => {
    const result = splitCommands('echo hello >&2');
    expect(result).toStrictEqual(['echo hello >&2']);
  });

  it('should split && chains while preserving >&2 redirection in each segment', () => {
    const result = splitCommands('echo hello >&2 && echo world');
    expect(result).toStrictEqual(['echo hello >&2', 'echo world']);
  });

  it('should handle multiple chained commands each with redirections', () => {
    const result = splitCommands('cmd1 2>&1 && cmd2 2>&1');
    expect(result).toStrictEqual(['cmd1 2>&1', 'cmd2 2>&1']);
  });

  it('should handle a single command without chaining', () => {
    const result = splitCommands('echo hello');
    expect(result).toStrictEqual(['echo hello']);
  });

  it('should split on semicolons correctly', () => {
    const result = splitCommands('echo a; echo b');
    expect(result).toStrictEqual(['echo a', 'echo b']);
  });

  it('should keep &>file (bash redirect-both) within a single command segment', () => {
    const result = splitCommands('cmd1 &>output.log && cmd2');
    expect(result).toStrictEqual(['cmd1 &>output.log', 'cmd2']);
  });

  it('should keep &>>file (bash append redirect-both) within a single command segment', () => {
    const result = splitCommands('cmd1 &>>output.log && cmd2');
    expect(result).toStrictEqual(['cmd1 &>>output.log', 'cmd2']);
  });

  it('should still split on standalone & (background job separator)', () => {
    const result = splitCommands('cmd1 & cmd2');
    expect(result).toStrictEqual(['cmd1', 'cmd2']);
  });

  // Default behavior: split on pipes (for security/allowlist checks)
  it('should split on pipes by default (for security checks)', () => {
    const result = splitCommands('cat file | grep foo');
    expect(result).toStrictEqual(['cat file', 'grep foo']);
  });

  it('should split complex pipelines by default', () => {
    const result = splitCommands('cat file | grep foo | sort | uniq');
    expect(result).toStrictEqual(['cat file', 'grep foo', 'sort', 'uniq']);
  });

  // With splitOnPipes: false (for instrumentation - pipelines stay intact)
  it('should keep pipe operator within a single command when splitOnPipes: false', () => {
    const result = splitCommands('cat file | grep foo', {
      splitOnPipes: false,
    });
    expect(result).toStrictEqual(['cat file | grep foo']);
  });

  it('should keep complex pipelines as a single command when splitOnPipes: false', () => {
    const result = splitCommands('cat file | grep foo | sort | uniq', {
      splitOnPipes: false,
    });
    expect(result).toStrictEqual(['cat file | grep foo | sort | uniq']);
  });

  it('should split on && but preserve pipes within each segment when splitOnPipes: false', () => {
    const result = splitCommands('cat file | grep foo && echo done', {
      splitOnPipes: false,
    });
    expect(result).toStrictEqual(['cat file | grep foo', 'echo done']);
  });

  it('should split on || but preserve pipes within each segment when splitOnPipes: false', () => {
    const result = splitCommands('cat file | grep foo || echo not found', {
      splitOnPipes: false,
    });
    expect(result).toStrictEqual(['cat file | grep foo', 'echo not found']);
  });

  it('should handle multiple chained pipelines when splitOnPipes: false', () => {
    const result = splitCommands(
      'cat file1 | grep foo && cat file2 | grep bar',
      { splitOnPipes: false },
    );
    expect(result).toStrictEqual([
      'cat file1 | grep foo',
      'cat file2 | grep bar',
    ]);
  });

  it('should handle pipe with 2>&1 redirection when splitOnPipes: false', () => {
    const result = splitCommands('cmd 2>&1 | grep error', {
      splitOnPipes: false,
    });
    expect(result).toStrictEqual(['cmd 2>&1 | grep error']);
  });
});

describe('splitCommands regex fallback', () => {
  // Test the regex fallback path by mocking isParserAvailable to return false
  beforeEach(() => {
    vi.doMock('./shell-parser.js', () => ({
      isParserAvailable: () => false,
      parseShellCommand: () => null,
      extractCommandNames: () => [],
      hasCommandSubstitution: () => false,
      splitCommandsWithTree: () => [],
      parseCommandDetails: () => null,
    }));
  });

  afterEach(() => {
    vi.doUnmock('./shell-parser.js');
  });

  it('should keep 2>&1 redirection within a single command segment (regex path)', async () => {
    const { splitCommands: splitCommandsRegex } = await import(
      './shell-utils.js'
    );
    const result = splitCommandsRegex('ls nonexistent 2>&1');
    expect(result).toStrictEqual(['ls nonexistent 2>&1']);
  });

  it('should split && chains while preserving 2>&1 (regex path)', async () => {
    const { splitCommands: splitCommandsRegex } = await import(
      './shell-utils.js'
    );
    const result = splitCommandsRegex('ls nonexistent 2>&1 && echo done');
    expect(result).toStrictEqual(['ls nonexistent 2>&1', 'echo done']);
  });

  it('should keep &>file within a single command segment (regex path)', async () => {
    const { splitCommands: splitCommandsRegex } = await import(
      './shell-utils.js'
    );
    const result = splitCommandsRegex('cmd1 &>output.log && cmd2');
    expect(result).toStrictEqual(['cmd1 &>output.log', 'cmd2']);
  });

  it('should keep &>>file within a single command segment (regex path)', async () => {
    const { splitCommands: splitCommandsRegex } = await import(
      './shell-utils.js'
    );
    const result = splitCommandsRegex('cmd1 &>>output.log && cmd2');
    expect(result).toStrictEqual(['cmd1 &>>output.log', 'cmd2']);
  });

  it('should still split on standalone & (regex path)', async () => {
    const { splitCommands: splitCommandsRegex } = await import(
      './shell-utils.js'
    );
    const result = splitCommandsRegex('cmd1 & cmd2');
    expect(result).toStrictEqual(['cmd1', 'cmd2']);
  });

  // Default behavior: split on pipes (for security)
  it('should split on pipes by default (regex path)', async () => {
    const { splitCommands: splitCommandsRegex } = await import(
      './shell-utils.js'
    );
    const result = splitCommandsRegex('cat file | grep foo');
    expect(result).toStrictEqual(['cat file', 'grep foo']);
  });

  it('should split complex pipelines by default (regex path)', async () => {
    const { splitCommands: splitCommandsRegex } = await import(
      './shell-utils.js'
    );
    const result = splitCommandsRegex('cat file | grep foo | sort | uniq');
    expect(result).toStrictEqual(['cat file', 'grep foo', 'sort', 'uniq']);
  });

  // With splitOnPipes: false (for instrumentation)
  it('should keep pipe operator within a single command when splitOnPipes: false (regex path)', async () => {
    const { splitCommands: splitCommandsRegex } = await import(
      './shell-utils.js'
    );
    const result = splitCommandsRegex('cat file | grep foo', {
      splitOnPipes: false,
    });
    expect(result).toStrictEqual(['cat file | grep foo']);
  });

  it('should keep complex pipelines as a single command when splitOnPipes: false (regex path)', async () => {
    const { splitCommands: splitCommandsRegex } = await import(
      './shell-utils.js'
    );
    const result = splitCommandsRegex('cat file | grep foo | sort | uniq', {
      splitOnPipes: false,
    });
    expect(result).toStrictEqual(['cat file | grep foo | sort | uniq']);
  });

  it('should split on && but preserve pipes within each segment when splitOnPipes: false (regex path)', async () => {
    const { splitCommands: splitCommandsRegex } = await import(
      './shell-utils.js'
    );
    const result = splitCommandsRegex('cat file | grep foo && echo done', {
      splitOnPipes: false,
    });
    expect(result).toStrictEqual(['cat file | grep foo', 'echo done']);
  });
});
