/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Behavioral test for the lazy native-grammar initialization in ast-grep-utils.
//
// This test verifies that `isAstGrepAvailable` reports true before any
// registration attempt (issue #2399). Split into a separate file so the Bun
// orchestrator provides a fresh module graph (vi.resetModules is unsupported
// under Bun). The parent file's tests trigger registration before checking
// availability, so this assertion needs its own clean import.

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

describe('ast-grep-utils lazy initialization — availability before registration', () => {
  it('isAstGrepAvailable reports true before any registration attempt', async () => {
    const mod = await import('./ast-grep-utils.js');

    // The binding loaded, so report true without forcing the native dlopen.
    expect(mod.isAstGrepAvailable()).toBe(true);
    expect(registerSpy).not.toHaveBeenCalled();
  });
});
