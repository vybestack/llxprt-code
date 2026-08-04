/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Behavioral tests for the lazy native-grammar initialization in ast-grep-utils.
//
// These tests verify that a native load failure (e.g. Windows Smart App Control
// OS error 4551) degrades gracefully instead of crashing (issue #2399). Split
// into a separate file so the Bun orchestrator provides a fresh module graph
// (vi.resetModules is unsupported under Bun).

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
      // Simulate Windows Smart App Control LoadLibraryExW failure (OS error 4551).
      throw new Error('LoadLibraryExW { source: 4551 }');
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

describe('ast-grep-utils lazy initialization — graceful degradation on native load failure', () => {
  it('parseSource returns { error } for dynamic languages when registration fails', async () => {
    const mod = await import('./ast-grep-utils.js');

    // Dynamic language: must not throw; must report a descriptive error.
    const result = mod.parseSource('python', 'x = 1');
    expect(result).toHaveProperty('error');
    expect(result).not.toHaveProperty('root');
    expect(typeof (result as { error: string }).error).toBe('string');
    expect((result as { error: string }).error.length).toBeGreaterThan(0);
  });

  it('parseSource still works for built-in languages when registration fails', async () => {
    const mod = await import('./ast-grep-utils.js');

    // Built-in language (TypeScript) should work even when dynamic addons failed.
    const result = mod.parseSource(mockLang.TypeScript, 'const x = 1;');
    expect(result).toHaveProperty('root');
    expect(result).not.toHaveProperty('error');
  });

  it('parse throws clear error for dynamic language when registration fails', async () => {
    const mod = await import('./ast-grep-utils.js');

    expect(() => mod.parse('python', 'x = 1')).toThrow(
      /dynamic grammars are unavailable/,
    );
  });

  it('parse works for built-in language when registration fails', async () => {
    const mod = await import('./ast-grep-utils.js');

    expect(() => mod.parse(mockLang.TypeScript, 'const x = 1;')).not.toThrow();
  });

  it('isAstGrepAvailable reports true even after a failed registration (core binding works)', async () => {
    const mod = await import('./ast-grep-utils.js');

    // Trigger the failed registration attempt through a runtime call.
    mod.parseSource('python', 'x = 1');

    // Core napi binding still works; dynamic failure does not hide built-in
    // language capability.
    expect(mod.isAstGrepAvailable()).toBe(true);
  });
});
