/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { BrowserProfileAssociationStore } from '../browser-profile-association-store.js';

interface InMemoryFs {
  files: Map<string, string>;
  modes: Map<string, number>;
}

function createInMemoryFs(initial: Record<string, string> = {}): InMemoryFs {
  return { files: new Map(Object.entries(initial)), modes: new Map() };
}

function createStore(fs: InMemoryFs): BrowserProfileAssociationStore {
  return new BrowserProfileAssociationStore(
    '/fake/path/oauth-browser-profiles.json',
    {
      exists: (p: string) => fs.files.has(p),
      readFile: (p: string) => {
        const content = fs.files.get(p);
        if (content === undefined) {
          const err: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`);
          err.code = 'ENOENT';
          throw err;
        }
        return content;
      },
      writeFile: (p: string, c: string, opts?: { mode?: number }) => {
        fs.files.set(p, c);
        if (opts?.mode !== undefined) {
          fs.modes.set(p, opts.mode);
        }
      },
      chmod: (p: string, mode: number) => {
        fs.modes.set(p, mode);
      },
      mkdir: (_p: string, _opts?: { recursive?: boolean }) => {
        /* no-op for in-memory fs */
      },
    },
  );
}

function createInMemoryFsMalformed(): InMemoryFs {
  return createInMemoryFs({
    '/fake/path/oauth-browser-profiles.json': 'not valid json {{{',
  });
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

    it('writes the association file with owner-only permissions', () => {
      const filePath = '/fake/path/oauth-browser-profiles.json';
      const fs = createInMemoryFs();
      const store = createStore(fs);

      store.setAssociation('anthropic', 'default', {
        browser: 'chrome',
        profileDirectory: 'Default',
      });
      expect(fs.modes.get(filePath)).toBe(0o600);

      fs.modes.set(filePath, 0o644);
      store.setAssociation('anthropic', 'work', {
        browser: 'chrome',
        profileDirectory: 'Profile 1',
      });
      expect(fs.modes.get(filePath)).toBe(0o600);
    });
  });

  describe('default bucket', () => {
    it('getAssociation returns the "default" bucket entry when no bucket is given', () => {
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

    it('returns undefined when only a non-default bucket exists', () => {
      const store = createStore(createInMemoryFs());

      store.setAssociation('anthropic', 'work', {
        browser: 'chrome',
        profileDirectory: 'Profile 1',
      });

      expect(store.getAssociation('anthropic')).toBeUndefined();
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
      expect(codexList).toContainEqual({
        bucket: 'default',
        browser: 'chrome',
        profileDirectory: 'Profile 2',
      });
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

    it('filters malformed entries while retaining valid entries', () => {
      const path = '/fake/path/oauth-browser-profiles.json';
      const originalContent = JSON.stringify({
        version: 1,
        associations: {
          'anthropic:default': { browser: 'chrome' },
          'anthropic:work': {
            browser: 'firefox',
            profileDirectory: 'work-profile',
            displayName: 'Work',
          },
          'anthropic:unsupported': {
            browser: 'unsupported',
            profileDirectory: 'Default',
          },
          'codex:default': {
            browser: 'chrome',
            profileDirectory: 'Default',
          },
        },
      });
      const fs = createInMemoryFs({ [path]: originalContent });
      const store = createStore(fs);

      expect(store.listAssociations('anthropic')).toStrictEqual([
        {
          bucket: 'work',
          browser: 'firefox',
          profileDirectory: 'work-profile',
          displayName: 'Work',
        },
      ]);
      expect(store.getAssociation('anthropic', 'default')).toBeUndefined();
      expect(store.getAssociation('codex')).toStrictEqual({
        browser: 'chrome',
        profileDirectory: 'Default',
      });
      expect(fs.files.get(path)).toBe(originalContent);
    });

    it('treats a malformed associations collection as empty without overwriting it', () => {
      const path = '/fake/path/oauth-browser-profiles.json';
      const originalContent = JSON.stringify({
        version: 1,
        associations: [],
      });
      const fs = createInMemoryFs({ [path]: originalContent });
      const store = createStore(fs);

      expect(store.listAssociations('anthropic')).toStrictEqual([]);
      expect(fs.files.get(path)).toBe(originalContent);

      store.setAssociation('anthropic', 'default', {
        browser: 'chrome',
        profileDirectory: 'Default',
      });
      expect(store.getAssociation('anthropic')).toStrictEqual({
        browser: 'chrome',
        profileDirectory: 'Default',
      });
    });

    it('rejects persisted data missing the required version field', () => {
      const path = '/fake/path/oauth-browser-profiles.json';
      const originalContent = JSON.stringify({
        associations: {
          'anthropic:default': {
            browser: 'chrome',
            profileDirectory: 'Default',
          },
        },
      });
      const fs = createInMemoryFs({ [path]: originalContent });
      const store = createStore(fs);

      // Without a numeric version the file does not satisfy the schema and
      // must be treated as empty rather than partially consumed.
      expect(store.getAssociation('anthropic', 'default')).toBeUndefined();
      // The invalid file must not be overwritten or corrupted by the read.
      expect(fs.files.get(path)).toBe(originalContent);
    });

    it('preserves an unsupported-version file and blocks mutations', () => {
      const path = '/fake/path/oauth-browser-profiles.json';
      const originalContent = JSON.stringify({
        version: 2,
        associations: {
          'anthropic:default': {
            browser: 'chrome',
            profileDirectory: 'Default',
            futureField: 'preserve-me',
          },
        },
      });
      const fs = createInMemoryFs({ [path]: originalContent });
      const store = createStore(fs);

      expect(store.getAssociation('anthropic')).toBeUndefined();
      expect(store.listAssociations('anthropic')).toStrictEqual([]);
      expect(() =>
        store.setAssociation('anthropic', 'work', {
          browser: 'firefox',
          profileDirectory: 'work',
        }),
      ).toThrow('unsupported file version');
      expect(() => store.clearAssociation('anthropic')).toThrow(
        'unsupported file version',
      );
      expect(fs.files.get(path)).toBe(originalContent);
    });
    it('rejects persisted data with an unsupported browser kind', () => {
      const path = '/fake/path/oauth-browser-profiles.json';
      const originalContent = JSON.stringify({
        version: 1,
        associations: {
          'anthropic:default': {
            browser: 'invalid-browser',
            profileDirectory: 'Default',
          },
        },
      });
      const fs = createInMemoryFs({ [path]: originalContent });
      const store = createStore(fs);

      // An unknown browser would fail later at launch time; the type guard
      // must reject it on read so callers never receive an invalid value.
      expect(store.getAssociation('anthropic', 'default')).toBeUndefined();
      expect(store.listAssociations('anthropic')).toStrictEqual([]);
      // The invalid file must not be overwritten or corrupted by the read.
      expect(fs.files.get(path)).toBe(originalContent);
    });
  });

  describe('key validation', () => {
    it('rejects empty or colon-delimited provider names', () => {
      const store = createStore(createInMemoryFs());
      const association = {
        browser: 'chrome' as const,
        profileDirectory: 'Default',
      };

      expect(() => store.setAssociation('', 'default', association)).toThrow(
        'Provider must be non-empty',
      );
      expect(() =>
        store.setAssociation('anthropic:extra', 'default', association),
      ).toThrow('must not contain colons');
      expect(() => store.listAssociations('')).toThrow(
        'Provider must be non-empty',
      );
    });

    it('rejects an empty bucket name', () => {
      const store = createStore(createInMemoryFs());

      expect(() =>
        store.setAssociation('anthropic', '', {
          browser: 'chrome',
          profileDirectory: 'Default',
        }),
      ).toThrow('Bucket must be non-empty');
      expect(() => store.getAssociation('anthropic', '')).toThrow(
        'Bucket must be non-empty',
      );
      expect(() => store.clearAssociation('anthropic', '')).toThrow(
        'Bucket must be non-empty',
      );
    });
  });

  it('rejects empty profile directories and control characters', () => {
    const store = createStore(createInMemoryFs());

    expect(() =>
      store.setAssociation('anthropic', 'default', {
        browser: 'chrome',
        profileDirectory: '',
      }),
    ).toThrow('Profile directory must be non-empty');
    expect(() =>
      store.setAssociation('anthropic', 'default', {
        browser: 'chrome',
        profileDirectory: 'Default',
        displayName: 'Work\u001B[31m',
      }),
    ).toThrow('Display name must not contain control characters');
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
      result!.profileDirectory = 'HACKED';

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
