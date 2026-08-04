/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Behavioral tests for the lazy native-grammar initialization in ast-grep-utils.
//
// These tests verify that importing the module does NOT trigger
// registerDynamicLanguage (issue #2399). Split into a separate file so the
// Bun orchestrator provides a fresh module graph (vi.resetModules is
// unsupported under Bun).

import { describe, it, expect, vi } from 'vitest';

const { registerSpy, mockLang } = vi.hoisted(() => {
  const mockLang = {
    TypeScript: 'TypeScript',
    JavaScript: 'JavaScript',
    Tsx: 'Tsx',
    Html: 'Html',
    Css: 'Css',
  } as const;
  return {
    registerSpy: vi.fn(() => {
      throw new Error('should not be called on import');
    }),
    mockLang,
  };
});

vi.mock('@ast-grep/napi', () => ({
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
vi.mock('@ast-grep/lang-python', () => emptyGrammar);
vi.mock('@ast-grep/lang-go', () => emptyGrammar);
vi.mock('@ast-grep/lang-rust', () => emptyGrammar);
vi.mock('@ast-grep/lang-java', () => emptyGrammar);
vi.mock('@ast-grep/lang-cpp', () => emptyGrammar);
vi.mock('@ast-grep/lang-c', () => emptyGrammar);
vi.mock('@ast-grep/lang-json', () => emptyGrammar);
vi.mock('@ast-grep/lang-ruby', () => emptyGrammar);

describe('ast-grep-utils lazy initialization — import side effects', () => {
  it('importing the module does NOT call registerDynamicLanguage', async () => {
    // Importing must succeed without invoking native registration.
    const mod = await import('./ast-grep-utils.js');

    expect(registerSpy).not.toHaveBeenCalled();

    // Accessing a plain constant also must not trigger registration.
    expect(mod.LANGUAGE_MAP['ts']).toBe(mockLang.TypeScript);
    expect(mod.getAstLanguage('python')).toBe('python');
    expect(mod.resolveLanguageFromPath('foo.ts')).toBe(mockLang.TypeScript);

    expect(registerSpy).not.toHaveBeenCalled();
  });
});
