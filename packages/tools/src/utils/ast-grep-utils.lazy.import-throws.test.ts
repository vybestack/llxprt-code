/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Behavioral test for the lazy native-grammar initialization in ast-grep-utils.
//
// This test verifies that importing the module succeeds even when
// registerDynamicLanguage throws (e.g. Windows Smart App Control blocking).
// Split into a separate file so the Bun orchestrator provides a fresh module
// graph (vi.resetModules is unsupported under Bun). The import-effects parent
// file also checks that import does NOT call registerDynamicLanguage; this
// file specifically tests import survival when the registration spy is rigged
// to throw, which requires a different mock configuration.

import { describe, it, expect, vi } from 'bun:test';

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
      throw new Error('registration blocked by Smart App Control');
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

describe('ast-grep-utils lazy initialization — import survival', () => {
  it('importing succeeds even when registerDynamicLanguage throws (SAC blocked)', async () => {
    // The import must not crash even though the native binding would panic.
    await expect(import('./ast-grep-utils.js')).resolves.toBeDefined();
  });
});
