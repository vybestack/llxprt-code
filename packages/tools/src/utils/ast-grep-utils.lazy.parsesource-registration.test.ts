/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Behavioral tests for the lazy native-grammar initialization in ast-grep-utils.
//
// This test verifies that parseSource specifically triggers registration on
// its first call (issue #2399). It is in its own file so the Bun orchestrator
// provides a fresh module graph — the previous test file triggers registration
// via parse(), so this file's import starts from a clean state.

import { describe, it, expect, vi } from 'bun:test';

const { registerSpy, mockLang } = (() => {
  const mockLang = {
    TypeScript: 'TypeScript',
    JavaScript: 'JavaScript',
    Tsx: 'Tsx',
    Html: 'Html',
    Css: 'Css',
  } as const;
  return {
    registerSpy: vi.fn(() => {
      /* success */
    }),
    mockLang,
  };
})();

void vi.mock('@ast-grep/napi', () => ({
  __esModule: true,
  Lang: mockLang,
  parse: vi.fn((lang: unknown, content: string) => ({
    root: () => ({
      kind: lang,
      text: content,
      children: () => [],
    }),
  })),
  findInFiles: vi.fn(() => ({
    children: () => [],
  })),
  registerDynamicLanguage: registerSpy,
}));

const emptyGrammar = { __esModule: true, default: {} };
void vi.mock('@ast-grep/lang-python', () => emptyGrammar);
void vi.mock('@ast-grep/lang-go', () => emptyGrammar);
void vi.mock('@ast-grep/lang-rust', () => emptyGrammar);
void vi.mock('@ast-grep/lang-java', () => emptyGrammar);
void vi.mock('@ast-grep/lang-cpp', () => emptyGrammar);
void vi.mock('@ast-grep/lang-c', () => emptyGrammar);
void vi.mock('@ast-grep/lang-json', () => emptyGrammar);
void vi.mock('@ast-grep/lang-ruby', () => emptyGrammar);

describe('ast-grep-utils lazy initialization — parseSource registration', () => {
  it('parseSource registers on first call and returns a root', async () => {
    const mod = await import('./ast-grep-utils.js');

    // parseSource with a dynamic language must trigger registration on its
    // first call — proving lazy registration fires on first parseSource use.
    expect(registerSpy).not.toHaveBeenCalled();
    const result = mod.parseSource('python', 'x = 1');
    expect(registerSpy).toHaveBeenCalledTimes(1);

    expect(result).toHaveProperty('root');
    expect(result).not.toHaveProperty('error');
  });
});
