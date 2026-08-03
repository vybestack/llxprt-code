/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Behavioral tests for the lazy native-grammar initialization in ast-grep-utils.
//
// These tests verify that the first runtime use triggers registration exactly
// once (issue #2399). Split into a separate file so the Bun orchestrator
// provides a fresh module graph (vi.resetModules is unsupported under Bun).

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
      /* success */
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

describe('ast-grep-utils lazy initialization — lazy registration on first use', () => {
  it('parse triggers registration on first real use', async () => {
    const mod = await import('./ast-grep-utils.js');
    expect(registerSpy).not.toHaveBeenCalled();

    // First runtime use should trigger registration, then delegate.
    mod.parse(mockLang.TypeScript, 'const x = 1;');

    expect(registerSpy).toHaveBeenCalledTimes(1);

    // A second call must not re-register (idempotency).
    mod.parse(mockLang.JavaScript, 'const y = 2;');
    expect(registerSpy).toHaveBeenCalledTimes(1);
  });
});
