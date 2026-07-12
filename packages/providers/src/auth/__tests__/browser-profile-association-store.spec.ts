/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { BrowserProfileAssociationStore } from '../browser-profile-association-store.js';

interface InMemoryFs {
  files: Map<string, string>;
}

function createInMemoryFs(initial: Record<string, string> = {}): InMemoryFs {
  return { files: new Map(Object.entries(initial)) };
}

function createStore(fs: InMemoryFs): BrowserProfileAssociationStore {
  return new BrowserProfileAssociationStore(
    '/fake/path/oauth-browser-profiles.json',
    {
      exists: (p: string) => fs.files.has(p),
      readFile: (p: string) => {
        const content = fs.files.get(p);
        if (content === undefined) {
          throw new Error(`ENOENT: ${p}`);
        }
        return content;
      },
      writeFile: (p: string, c: string) => {
        fs.files.set(p, c);
      },
      mkdir: () => {
        /* no-op for in-memory fs */
      },
    },
  );
}

describe('BrowserProfileAssociationStore', () => {
  describe('set/get round trip', () => {
    it('persists an association and reads it back', () => {
      const fs = createInMemoryFs();
      const store = createStore(fs);

      store.setAssociation('anthropic', 'default', {
        browser: 'chrome',
        profileDirectory: 'Profile 1',
        displayName: 'Work',
      });

      const result = store.getAssociation('anthropic', 'default');
      expect(result).toStrictEqual({
        browser: 'chrome',
        profileDirectory: 'Profile 1',
        displayName: 'Work',
      });
    });

    it('returns undefined for unset associations', () => {
      const fs = createInMemoryFs();
      const store = createStore(fs);

      expect(store.getAssociation('anthropic', 'default')).toBeUndefined();
    });

    it('persists across store instances (file-backed)', () => {
      const fs = createInMemoryFs();

      const store1 = createStore(fs);
      store1.setAssociation('codex', 'work', {
        browser: 'chrome',
        profileDirectory: 'Default',
      });

      // New store instance reads the same file
      const store2 = createStore(fs);
      const result = store2.getAssociation('codex', 'work');
      expect(result).toStrictEqual({
        browser: 'chrome',
        profileDirectory: 'Default',
      });
    });
  });

  describe('default bucket', () => {
    it('defaults bucket to "default" when not specified', () => {
      const fs = createInMemoryFs();
      const store = createStore(fs);

      store.setAssociation('anthropic', 'default', {
        browser: 'chrome',
        profileDirectory: 'Default',
      });

      // getAssociation without bucket should return the default
      expect(store.getAssociation('anthropic')).toStrictEqual({
        browser: 'chrome',
        profileDirectory: 'Default',
      });
    });
  });

  describe('clearAssociation', () => {
    it('removes an association', () => {
      const fs = createInMemoryFs();
      const store = createStore(fs);

      store.setAssociation('anthropic', 'default', {
        browser: 'chrome',
        profileDirectory: 'Profile 1',
      });
      store.clearAssociation('anthropic', 'default');

      expect(store.getAssociation('anthropic', 'default')).toBeUndefined();
    });

    it('does not throw when clearing a non-existent association', () => {
      const fs = createInMemoryFs();
      const store = createStore(fs);

      expect(() =>
        store.clearAssociation('anthropic', 'nonexistent'),
      ).not.toThrow();
    });
  });

  describe('listAssociations', () => {
    it('lists associations for one provider only', () => {
      const fs = createInMemoryFs();
      const store = createStore(fs);

      store.setAssociation('anthropic', 'default', {
        browser: 'chrome',
        profileDirectory: 'Default',
      });
      store.setAssociation('anthropic', 'work', {
        browser: 'chrome',
        profileDirectory: 'Profile 1',
      });
      store.setAssociation('codex', 'default', {
        browser: 'chrome',
        profileDirectory: 'Profile 2',
      });

      const anthropicList = store.listAssociations('anthropic');
      expect(anthropicList).toHaveLength(2);
      expect(anthropicList).toContainEqual({
        bucket: 'default',
        browser: 'chrome',
        profileDirectory: 'Default',
      });
      expect(anthropicList).toContainEqual({
        bucket: 'work',
        browser: 'chrome',
        profileDirectory: 'Profile 1',
      });

      const codexList = store.listAssociations('codex');
      expect(codexList).toHaveLength(1);
    });
  });

  describe('resilience', () => {
    it('treats missing file as empty on read', () => {
      const fs = createInMemoryFs();
      const store = createStore(fs);

      expect(store.getAssociation('anthropic', 'default')).toBeUndefined();
      expect(store.listAssociations('anthropic')).toStrictEqual([]);
    });

    it('treats malformed JSON as empty on read (does not overwrite)', () => {
      const fs = createInMemoryFsMalformed();
      const store = createStore(fs);

      expect(store.getAssociation('anthropic', 'default')).toBeUndefined();

      // The malformed file should NOT have been overwritten
      expect(fs.files.get('/fake/path/oauth-browser-profiles.json')).toBe(
        'not valid json {{{',
      );
    });

    it('rejects entries with a malformed shape (missing profileDirectory)', () => {
      const fs = createInMemoryFs({
        '/fake/path/oauth-browser-profiles.json': JSON.stringify({
          version: 1,
          associations: {
            'anthropic:default': { browser: 'chrome' },
          },
        }),
      });
      const store = createStore(fs);

      // The malformed entry must not be surfaced to consumers.
      expect(store.getAssociation('anthropic', 'default')).toBeUndefined();
      expect(store.listAssociations('anthropic')).toStrictEqual([]);
    });

    it('rejects persisted data missing the required version field', () => {
      const fs = createInMemoryFs({
        '/fake/path/oauth-browser-profiles.json': JSON.stringify({
          associations: {
            'anthropic:default': {
              browser: 'chrome',
              profileDirectory: 'Default',
            },
          },
        }),
      });
      const store = createStore(fs);

      // Without a numeric version the file does not satisfy the schema and
      // must be treated as empty rather than partially consumed.
      expect(store.getAssociation('anthropic', 'default')).toBeUndefined();
    });
  });

  describe('immutability', () => {
    it('mutating the returned association does not affect the store', () => {
      const fs = createInMemoryFs();
      const store = createStore(fs);

      store.setAssociation('anthropic', 'default', {
        browser: 'chrome',
        profileDirectory: 'Profile 1',
      });

      const result = store.getAssociation('anthropic', 'default');
      expect(result).toBeDefined();
      // Mutate the returned object
      (result as { profileDirectory: string }).profileDirectory = 'HACKED';

      // Store should be unaffected
      const result2 = store.getAssociation('anthropic', 'default');
      expect(result2?.profileDirectory).toBe('Profile 1');
    });

    it('mutating the input association does not affect the store', () => {
      const fs = createInMemoryFs();
      const store = createStore(fs);

      const input = {
        browser: 'chrome' as const,
        profileDirectory: 'Profile 1',
      };
      store.setAssociation('anthropic', 'default', input);

      // Mutate the input after storing
      input.profileDirectory = 'HACKED';

      const result = store.getAssociation('anthropic', 'default');
      expect(result?.profileDirectory).toBe('Profile 1');
    });
  });
});

function createInMemoryFsMalformed(): InMemoryFs {
  return createInMemoryFs({
    '/fake/path/oauth-browser-profiles.json': 'not valid json {{{',
  });
}
