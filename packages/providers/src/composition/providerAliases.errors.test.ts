/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

import {
  getUserAliasDir,
  loadProviderAliasEntries,
} from './providerAliases.js';

const VALID_ALIAS = {
  baseProvider: 'openai',
  'base-url': 'https://ok.test/v1',
};

describe('loadProviderAliasEntries user alias errors', () => {
  let aliasDir: string;

  beforeEach(() => {
    aliasDir = getUserAliasDir();
    fs.rmSync(aliasDir, { recursive: true, force: true });
    fs.mkdirSync(aliasDir, { recursive: true });
    fs.writeFileSync(
      path.join(aliasDir, 'good.config'),
      JSON.stringify(VALID_ALIAS),
    );
  });

  afterEach(() => {
    if (process.platform !== 'win32' && fs.existsSync(aliasDir)) {
      fs.chmodSync(aliasDir, 0o755);
    }
    fs.rmSync(aliasDir, { recursive: true, force: true });
  });

  it('returns the valid user alias when every alias file parses', () => {
    const user = loadProviderAliasEntries().filter(
      (entry) => entry.source === 'user',
    );

    expect(user.map((entry) => entry.alias)).toStrictEqual(['good']);
  });

  it('treats a missing user alias directory as absence', () => {
    fs.rmSync(aliasDir, { recursive: true, force: true });

    const user = loadProviderAliasEntries().filter(
      (entry) => entry.source === 'user',
    );

    expect(user).toStrictEqual([]);
  });

  it('throws with the file path and the parse error as cause for a malformed alias file', () => {
    const badPath = path.join(aliasDir, 'bad.config');
    fs.writeFileSync(badPath, '{ not json');

    let thrown: unknown;
    try {
      loadProviderAliasEntries();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      `Invalid provider alias file ${badPath}`,
    );
    expect((thrown as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it('throws with the file path and the read error as cause for an unreadable alias file', () => {
    const unreadablePath = path.join(aliasDir, 'dangling.config');
    fs.symlinkSync(path.join(aliasDir, 'missing-target'), unreadablePath);

    let thrown: unknown;
    try {
      loadProviderAliasEntries();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      `Invalid provider alias file ${unreadablePath}`,
    );
    expect(((thrown as Error).cause as NodeJS.ErrnoException).code).toBe(
      'ENOENT',
    );
  });

  it('throws with the directory path when the alias directory is not a directory', () => {
    fs.rmSync(aliasDir, { recursive: true, force: true });
    fs.writeFileSync(aliasDir, 'a file where the directory should be');

    let thrown: unknown;
    try {
      loadProviderAliasEntries();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      `Cannot read provider alias directory ${aliasDir}`,
    );
    expect(((thrown as Error).cause as NodeJS.ErrnoException).code).toBe(
      'ENOTDIR',
    );
  });

  it.skipIf(process.platform === 'win32')(
    'throws with the directory path when the alias directory has no read permission',
    () => {
      fs.chmodSync(aliasDir, 0o000);

      let thrown: unknown;
      try {
        loadProviderAliasEntries();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe(
        `Cannot read provider alias directory ${aliasDir}`,
      );
      expect(((thrown as Error).cause as NodeJS.ErrnoException).code).toBe(
        'EACCES',
      );
    },
  );
});
