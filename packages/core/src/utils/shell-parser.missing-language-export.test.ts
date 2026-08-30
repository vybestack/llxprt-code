/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, mock } from 'bun:test';

/**
 * Process-isolated evidence that a missing tree-sitter `Language` export is
 * recorded with its diagnostic (issue 2918 finding 1).
 *
 * The mock registry is process-wide, and the core runner gives every test file
 * its own `bun test` process, so this file can replace `web-tree-sitter`
 * with a usable `Parser` but no `Language` loader without denying any other
 * test a working parser. The real `shell-parser.js` module is imported
 * dynamically after the mock is registered, and every asserted value below is
 * produced by the real code path.
 */

void mock.module('web-tree-sitter', () => ({
  Parser: class {
    static async init(): Promise<void> {
      // No-op: reaching this point proves the guard is the missing Language
      // loader, not Parser.init().
    }
  },
}));

describe('shell-parser with a missing Language export', () => {
  it('records the missing-Language diagnostic and fails parsing', async () => {
    const {
      initializeParser,
      isParserAvailable,
      getInitializationError,
      parseShellCommand,
      resetParser,
    } = await import('./shell-parser.js');

    resetParser();

    const result = await initializeParser();

    expect(result).toBe(false);
    expect(isParserAvailable()).toBe(false);
    expect(getInitializationError()?.message).toContain(
      'Language export not found',
    );
    expect(parseShellCommand('ls')).toBeNull();
  });
});
