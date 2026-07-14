/**
 * @plan:PLAN-20260608-ISSUE1585.P10
 * @requirement:REQ-BEHAVIORAL-TDD, REQ-TEST-FIXTURE-COUPLING
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tool Key Storage Behavioral Tests
 *
 * Verifies observable behavior of key storage utilities:
 * - maskKeyForDisplay: masks middle of keys correctly
 * - getSupportedToolNames: returns expected tool names
 * - isValidToolKeyName: validates tool names correctly
 * - IToolKeyStorage adapter round-trip: save → read
 * - IToolKeyStorage adapter deletion: delete → read returns null
 * - IToolKeyStorage resolveKey: returns keys in documented order
 *
 * Primary assertions are on observable string/collection/boolean output,
 * NOT on method call counts.
 *
 * Uses pre-extraction characterization fixtures to ensure
 * behavioral equivalence after the move.
 */

import { describe, it, expect } from 'vitest';
import {
  maskKeyForDisplay,
  getSupportedToolNames,
  isValidToolKeyName,
  getToolKeyEntry,
  TOOL_KEY_REGISTRY,
} from '../utils/tool-key-storage-types.js';
import { ToolKeyStorageFacade } from '../utils/tool-key-storage-facade.js';
import type { IToolKeyStorage } from '../interfaces/index.js';
import {
  MASK_KEY_FIXTURES,
  SUPPORTED_TOOL_NAMES_FIXTURE,
  VALID_KEY_CHECK_FIXTURES,
  KEY_ENTRY_FIXTURES,
} from './fixtures/key-storage-fixtures.js';

/**
 * In-memory fake IToolKeyStorage for adapter round-trip tests.
 * Primary assertions verify observable state changes, not method calls.
 */
function createInMemoryKeyStorage(): IToolKeyStorage {
  const store = new Map<string, string>();

  return {
    saveKey: async (toolName: string, key: string) => {
      store.set(toolName, key);
    },
    getKey: async (toolName: string) => store.get(toolName) ?? null,
    deleteKey: async (toolName: string) => {
      store.delete(toolName);
    },
    hasKey: async (toolName: string) => store.has(toolName),
    resolveKey: async (toolName: string) =>
      // Resolution order: direct storage → null
      store.get(toolName) ?? null,
    maskKeyForDisplay: (key: string) => maskKeyForDisplay(key),
    getSupportedToolNames: () => getSupportedToolNames(),
  };
}

describe('Tool Key Storage Behavioral Tests @plan:PLAN-20260608-ISSUE1585.P10', () => {
  describe('maskKeyForDisplay masks middle of keys correctly', () => {
    for (const fixture of MASK_KEY_FIXTURES) {
      it(`masks "${fixture.input}" to "${fixture.output}"`, () => {
        const result = maskKeyForDisplay(fixture.input);
        // Primary assertion: observable string output matches pre-extraction fixture
        expect(result).toBe(fixture.output);
      });
    }

    it('masks all but first 2 and last 2 characters for long keys', () => {
      const key = 'sk-1234567890abcdefghijklmn';
      const masked = maskKeyForDisplay(key);
      expect(masked).toBe(`sk${'*'.repeat(key.length - 4)}mn`);
      expect(masked).toContain('sk');
      expect(masked).toContain('mn');
    });

    it('fully masks keys of 8 characters or fewer', () => {
      for (const shortKey of ['abc', '12345678', '', 'x']) {
        const masked = maskKeyForDisplay(shortKey);
        if (shortKey.length <= 8) {
          expect(masked).toBe('*'.repeat(shortKey.length));
        }
      }
    });
  });

  describe('getSupportedToolNames returns expected tool names', () => {
    it('returns the names from the fixture', () => {
      const names = getSupportedToolNames();
      // Primary assertion: observable collection content matches fixture
      expect(names).toEqual(SUPPORTED_TOOL_NAMES_FIXTURE);
    });

    it('returns array containing exa', () => {
      const names = getSupportedToolNames();
      expect(names).toContain('exa');
    });
  });

  describe('isValidToolKeyName validates tool names correctly', () => {
    for (const fixture of VALID_KEY_CHECK_FIXTURES) {
      it(`isValidToolKeyName("${fixture.input}") returns ${fixture.isValid}`, () => {
        const result = isValidToolKeyName(fixture.input);
        // Primary assertion: observable boolean matches fixture
        expect(result).toBe(fixture.isValid);
      });
    }
  });

  describe('getToolKeyEntry returns correct entries', () => {
    for (const fixture of KEY_ENTRY_FIXTURES) {
      it(`getToolKeyEntry("${fixture.name}") returns correct entry`, () => {
        const entry = getToolKeyEntry(fixture.name);
        // Primary assertion: observable entry content matches fixture
        expect(entry).toEqual(fixture.entry);
      });
    }
  });

  describe('TOOL_KEY_REGISTRY has expected structure', () => {
    it('has exa entry with correct metadata', () => {
      const entry = TOOL_KEY_REGISTRY.get('exa');
      expect(entry).toBeDefined();
      expect(entry!.toolKeyName).toBe('exa');
      expect(entry!.displayName).toBe('Exa Search');
      expect(entry!.urlParamName).toBe('exaApiKey');
    });
  });

  describe('IToolKeyStorage adapter round-trip: save → read', () => {
    it('after saving a key, reading it back returns the same key', async () => {
      const storage = createInMemoryKeyStorage();

      await storage.saveKey('codesearch', 'sk-test-key-12345');

      // Primary assertion: observable round-trip (not just "saveKey was called")
      const key = await storage.getKey('codesearch');
      expect(key).toBe('sk-test-key-12345');
    });

    it('reading a key that was never saved returns null', async () => {
      const storage = createInMemoryKeyStorage();

      const key = await storage.getKey('never-saved');
      // Primary assertion: observable null return (not just "getKey was called")
      expect(key).toBeNull();
    });
  });

  describe('IToolKeyStorage adapter deletion: delete → read returns null', () => {
    it('after deleting a key, reading it returns null', async () => {
      const storage = createInMemoryKeyStorage();

      await storage.saveKey('codesearch', 'sk-key-to-delete');
      const beforeDelete = await storage.getKey('codesearch');
      expect(beforeDelete).toBe('sk-key-to-delete');

      await storage.deleteKey('codesearch');

      // Primary assertion: observable state change (not just "deleteKey was called")
      const afterDelete = await storage.getKey('codesearch');
      expect(afterDelete).toBeNull();
    });
  });

  describe('IToolKeyStorage resolveKey returns keys in documented resolution order', () => {
    it('resolveKey returns the key from direct storage', async () => {
      const storage = createInMemoryKeyStorage();

      await storage.saveKey('codesearch', 'sk-resolved-key');

      const resolved = await storage.resolveKey('codesearch');
      // Primary assertion: resolveKey returns stored key (observable value)
      expect(resolved).toBe('sk-resolved-key');
    });

    it('resolveKey returns null when key not stored anywhere', async () => {
      const storage = createInMemoryKeyStorage();

      const resolved = await storage.resolveKey('nonexistent');
      // Primary assertion: null return for unresolvable key (observable)
      expect(resolved).toBeNull();
    });
  });

  describe('IToolKeyStorage maskKeyForDisplay delegates to pure function', () => {
    it('storage.maskKeyForDisplay returns same result as pure maskKeyForDisplay', () => {
      const storage = createInMemoryKeyStorage();
      const testKey = 'sk-1234567890abcdef';

      const storageMasked = storage.maskKeyForDisplay(testKey);
      const pureMasked = maskKeyForDisplay(testKey);

      // Primary assertion: adapter delegates correctly (observable output match)
      expect(storageMasked).toBe(pureMasked);
      // Also verify fixture match
      const fixtureEntry = MASK_KEY_FIXTURES.find((f) => f.input === testKey);
      if (fixtureEntry) {
        expect(storageMasked).toBe(fixtureEntry.output);
      }
    });
  });

  describe('IToolKeyStorage getSupportedToolNames delegates to pure function', () => {
    it('storage.getSupportedToolNames returns same result as pure getSupportedToolNames', () => {
      const storage = createInMemoryKeyStorage();
      const storageNames = storage.getSupportedToolNames();
      const pureNames = getSupportedToolNames();

      // Primary assertion: observable collection content match
      expect(storageNames).toEqual(pureNames);
    });

    describe('ToolKeyStorageFacade validates names and delegates storage behavior', () => {
      it('saves and resolves a supported key through the injected storage boundary', async () => {
        const facade = new ToolKeyStorageFacade(createInMemoryKeyStorage());

        await facade.saveKey('exa', 'sk-facade-key');

        expect(await facade.getKey('exa')).toBe('sk-facade-key');
        expect(await facade.hasKey('exa')).toBe(true);
        expect(await facade.resolveKey('exa')).toBe('sk-facade-key');
      });

      it('rejects unsupported tool key names before touching storage', async () => {
        const facade = new ToolKeyStorageFacade(createInMemoryKeyStorage());

        await expect(facade.saveKey('unsupported', 'secret')).rejects.toThrow(
          'Unsupported tool key storage name: unsupported',
        );
      });

      it('uses tools-owned registry helpers for display metadata', () => {
        const facade = new ToolKeyStorageFacade(createInMemoryKeyStorage());

        expect(facade.getSupportedToolNames()).toEqual(getSupportedToolNames());
        expect(facade.getToolKeyEntry('exa')).toEqual(getToolKeyEntry('exa'));
        expect(facade.isValidToolKeyName('exa')).toBe(true);
        expect(facade.maskKeyForDisplay('sk-facade-secret')).toBe(
          maskKeyForDisplay('sk-facade-secret'),
        );
      });
    });
  });
});
