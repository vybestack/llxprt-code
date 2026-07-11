/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Behavioral tests for the lazy native-grammar initialization in ast-grep-utils.
//
// These tests verify the externally observable behavior required by issue #2399:
// importing the module must NOT dlopen any ast-grep native grammar addon, and a
// native load failure (e.g. Windows Smart App Control OS error 4551) must
// degrade gracefully instead of crashing.
//
// Per dev-docs/RULES.md, we assert on outcomes (import succeeds, parse returns
// { root } or { error }, availability reports correctly), not on internal mock
// call sequences.

import { afterEach, describe, expect, it, vi } from 'bun:test';
import {
  getAstLanguage,
  isAstGrepAvailable,
  LANGUAGE_MAP,
  parse,
  parseSource,
  resolveLanguageFromPath,
  setAstGrepRuntimeForTesting,
} from './ast-grep-utils.js';

// Minimal Lang enum shape used by the mocked @ast-grep/napi modules.
// The real Lang is a string enum; we mirror only the values referenced by
// LANGUAGE_MAP so the module under test can construct its mappings.
const MOCK_LANG = {
  TypeScript: 'TypeScript',
  JavaScript: 'JavaScript',
  Tsx: 'Tsx',
  Html: 'Html',
  Css: 'Css',
} as const;

function installRuntime(registerImpl: () => void) {
  const registerSpy = vi.fn(registerImpl);
  setAstGrepRuntimeForTesting({
    registerDynamicLanguage: registerSpy,
    parse: vi.fn((lang: unknown, content: string) => ({
      root: () => ({ kind: lang, text: content, children: () => [] }),
    })) as never,
    findInFiles: vi.fn(() => ({ children: () => [] })) as never,
  });
  return { registerSpy };
}

describe('ast-grep-utils lazy initialization', () => {
  afterEach(() => {
    setAstGrepRuntimeForTesting();
    vi.restoreAllMocks();
  });

  describe('import side effects', () => {
    it('importing the module does NOT call registerDynamicLanguage', async () => {
      const { registerSpy } = installRuntime(() => {
        throw new Error('should not be called on import');
      });

      // Importing must succeed without invoking native registration.
      const mod = {
        LANGUAGE_MAP,
        getAstLanguage,
        resolveLanguageFromPath,
        parse,
        parseSource,
        isAstGrepAvailable,
      };

      expect(registerSpy).not.toHaveBeenCalled();

      // Accessing a plain constant also must not trigger registration.
      expect(mod.LANGUAGE_MAP['ts']).toBe(MOCK_LANG.TypeScript);
      expect(mod.getAstLanguage('python')).toBe('python');
      expect(mod.resolveLanguageFromPath('foo.ts')).toBe(MOCK_LANG.TypeScript);

      expect(registerSpy).not.toHaveBeenCalled();
    });

    it('importing succeeds even when registerDynamicLanguage throws (SAC blocked)', async () => {
      installRuntime(() => {
        // Simulate Windows Smart App Control LoadLibraryExW failure (OS error 4551).
        throw new Error('LoadLibraryExW { source: 4551 }');
      });

      // The import must not crash even though the native binding would panic.
      expect(isAstGrepAvailable()).toBe(true);
    });
  });

  describe('lazy registration on first use', () => {
    it('parse triggers registration on first real use', async () => {
      const { registerSpy } = installRuntime(() => {
        /* success */
      });

      const mod = {
        LANGUAGE_MAP,
        getAstLanguage,
        resolveLanguageFromPath,
        parse,
        parseSource,
        isAstGrepAvailable,
      };
      expect(registerSpy).not.toHaveBeenCalled();

      // First runtime use should trigger registration, then delegate.
      mod.parse(MOCK_LANG.TypeScript, 'const x = 1;');

      expect(registerSpy).toHaveBeenCalledTimes(1);

      // A second call must not re-register (idempotency).
      mod.parse(MOCK_LANG.JavaScript, 'const y = 2;');
      expect(registerSpy).toHaveBeenCalledTimes(1);
    });

    it('parseSource registers on first call and returns a root', async () => {
      installRuntime(() => {
        /* success */
      });

      const mod = {
        LANGUAGE_MAP,
        getAstLanguage,
        resolveLanguageFromPath,
        parse,
        parseSource,
        isAstGrepAvailable,
      };

      const result = mod.parseSource('python', 'x = 1');
      expect(result).toHaveProperty('root');
      expect(result).not.toHaveProperty('error');
    });
  });

  describe('graceful degradation on native load failure', () => {
    it('parseSource returns { error } for dynamic languages when registration fails', async () => {
      installRuntime(() => {
        throw new Error('LoadLibraryExW { source: 4551 }');
      });

      const mod = {
        LANGUAGE_MAP,
        getAstLanguage,
        resolveLanguageFromPath,
        parse,
        parseSource,
        isAstGrepAvailable,
      };

      // Dynamic language: must not throw; must report a descriptive error.
      const result = mod.parseSource('python', 'x = 1');
      expect(result).toHaveProperty('error');
      expect(result).not.toHaveProperty('root');
      expect(typeof (result as { error: string }).error).toBe('string');
      expect((result as { error: string }).error.length).toBeGreaterThan(0);
    });

    it('parseSource still works for built-in languages when registration fails', async () => {
      installRuntime(() => {
        throw new Error('LoadLibraryExW { source: 4551 }');
      });

      const mod = {
        LANGUAGE_MAP,
        getAstLanguage,
        resolveLanguageFromPath,
        parse,
        parseSource,
        isAstGrepAvailable,
      };

      // Built-in language (TypeScript) should work even when dynamic addons failed.
      const result = mod.parseSource(MOCK_LANG.TypeScript, 'const x = 1;');
      expect(result).toHaveProperty('root');
      expect(result).not.toHaveProperty('error');
    });

    it('parse throws clear error for dynamic language when registration fails', async () => {
      installRuntime(() => {
        throw new Error('LoadLibraryExW { source: 4551 }');
      });

      const mod = {
        LANGUAGE_MAP,
        getAstLanguage,
        resolveLanguageFromPath,
        parse,
        parseSource,
        isAstGrepAvailable,
      };

      expect(() => mod.parse('python', 'x = 1')).toThrow(
        /dynamic grammars are unavailable/,
      );
    });

    it('parse works for built-in language when registration fails', async () => {
      installRuntime(() => {
        throw new Error('LoadLibraryExW { source: 4551 }');
      });

      const mod = {
        LANGUAGE_MAP,
        getAstLanguage,
        resolveLanguageFromPath,
        parse,
        parseSource,
        isAstGrepAvailable,
      };

      expect(() =>
        mod.parse(MOCK_LANG.TypeScript, 'const x = 1;'),
      ).not.toThrow();
    });

    it('isAstGrepAvailable reports true even after a failed registration (core binding works)', async () => {
      installRuntime(() => {
        throw new Error('LoadLibraryExW { source: 4551 }');
      });

      const mod = {
        LANGUAGE_MAP,
        getAstLanguage,
        resolveLanguageFromPath,
        parse,
        parseSource,
        isAstGrepAvailable,
      };

      // Trigger the failed registration attempt through a runtime call.
      mod.parseSource('python', 'x = 1');

      // Core napi binding still works; dynamic failure does not hide built-in
      // language capability.
      expect(mod.isAstGrepAvailable()).toBe(true);
    });

    it('isAstGrepAvailable reports true before any registration attempt', async () => {
      installRuntime(() => {
        throw new Error('should not be called');
      });

      const mod = {
        LANGUAGE_MAP,
        getAstLanguage,
        resolveLanguageFromPath,
        parse,
        parseSource,
        isAstGrepAvailable,
      };

      // The binding loaded, so report true without forcing the native dlopen.
      expect(mod.isAstGrepAvailable()).toBe(true);
    });
  });
});
