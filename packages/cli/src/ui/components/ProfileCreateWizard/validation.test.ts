/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { tmpdir as osTmpdir } from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

// The home directory is an OS boundary, so it is the one thing redirected here.
// Bun resolves node:os `homedir()` once at process start and never rereads
// $HOME, so pointing the env var at a temp dir cannot move it; the module is
// redirected instead. Every other node:os export is passed through untouched so
// the temp-dir helper below keeps using the real tmpdir().
const realOs = { ...(await import('node:os')) };
let homeDirOverride: string | undefined;

void vi.mock('node:os', () => {
  const patched = {
    ...realOs,
    homedir: (): string => homeDirOverride ?? realOs.homedir(),
  };
  return { ...patched, default: patched };
});

import {
  PARAM_VALIDATORS,
  validateBaseUrl,
  validateKeyFile,
  validateProfileName,
} from './validation.js';

/**
 * Shared temp-dir lifecycle. Registers beforeEach/afterEach that provision a
 * throwaway directory under the OS temp dir and always remove it afterwards.
 * Returns a lazy accessor for the directory path for the current test.
 */
function useTempDir(): () => string {
  let dir: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(osTmpdir(), 'wizard-keyfile-'));
  });

  afterEach(() => {
    homeDirOverride = undefined;
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  return () => dir as string;
}

describe('validateBaseUrl', () => {
  it('rejects empty and whitespace-only URLs with the required message', () => {
    for (const url of ['', '   ']) {
      expect(validateBaseUrl(url)).toEqual({
        valid: false,
        error: 'Base URL is required',
      });
    }
  });

  it('rejects URLs whose protocol is not http or https', () => {
    expect(validateBaseUrl('ftp://host')).toEqual({
      valid: false,
      error: 'URL must use http:// or https://',
    });
  });

  it('rejects strings that are not valid URLs', () => {
    expect(validateBaseUrl('not a url')).toEqual({
      valid: false,
      error: 'Invalid URL format',
    });
  });

  it('accepts http and https URLs', () => {
    expect(validateBaseUrl('http://localhost:1234')).toEqual({ valid: true });
    expect(validateBaseUrl('https://api.example.com/v1')).toEqual({
      valid: true,
    });
  });
});

describe('validateProfileName', () => {
  it('rejects empty and whitespace-only names', async () => {
    for (const name of ['', '   ']) {
      expect(await validateProfileName(name, [])).toEqual({
        valid: false,
        error: 'Profile name cannot be empty',
      });
    }
  });

  it('rejects names containing path separators', async () => {
    for (const name of ['a/b', 'a\\b']) {
      expect(await validateProfileName(name, [])).toEqual({
        valid: false,
        error: 'Profile name cannot contain path separators',
      });
    }
  });

  it('rejects a name that already exists', async () => {
    expect(await validateProfileName('dupe', ['dupe'])).toEqual({
      valid: false,
      error: 'Profile name already exists',
    });
  });

  it('accepts a fresh name without mutating the existing list', async () => {
    const existing = ['alpha', 'beta'];
    const snapshot = [...existing];
    await expect(validateProfileName('gamma', existing)).resolves.toEqual({
      valid: true,
    });
    expect(existing).toEqual(snapshot);
  });
});

describe('validateKeyFile', () => {
  const keyFileDir = useTempDir();

  it('accepts an existing readable key file', async () => {
    const dir = keyFileDir();
    const filePath = path.join(dir, 'key.json');
    fs.writeFileSync(filePath, '{}', { mode: 0o600 });
    await expect(validateKeyFile(filePath)).resolves.toEqual({ valid: true });
  });

  it('reports a missing file with the error echoing the original path', async () => {
    const dir = keyFileDir();
    const missing = path.join(dir, 'nope.json');
    const result = await validateKeyFile(missing);
    expect(result).toEqual({
      valid: false,
      error: `File not found: ${missing}`,
    });
  });

  it('expands a tilde-prefixed path against the home directory', async () => {
    // The key file only exists inside the redirected home, so this resolves
    // only if expandTilde() really substitutes homedir() for the leading `~`.
    // Without expansion, `~/tilde-key.txt` resolves relative to the cwd and
    // reports not-found instead.
    const dir = keyFileDir();
    homeDirOverride = dir;
    fs.writeFileSync(path.join(dir, 'tilde-key.txt'), '{}');

    await expect(validateKeyFile('~/tilde-key.txt')).resolves.toEqual({
      valid: true,
    });
  });

  it('treats a bare tilde exactly like the literal home directory path', async () => {
    // expandTilde has a separate branch for a bare `~`. Asserting that `~` and
    // the literal home path get the SAME verdict pins that branch without
    // asserting anything about what the verdict for a directory ought to be —
    // validateKeyFile currently only checks read access, so it accepts a
    // directory, and that is a separate question (filed as #3402) that this
    // coverage-only test must not enshrine either way.
    const dir = keyFileDir();
    homeDirOverride = dir;

    const bareTilde = await validateKeyFile('~');
    const literalHome = await validateKeyFile(dir);
    expect(bareTilde.valid).toBe(literalHome.valid);
  });

  it('reports not-found for a tilde path whose target is absent from the home directory', async () => {
    const dir = keyFileDir();
    homeDirOverride = dir;

    await expect(validateKeyFile('~/absent-key.txt')).resolves.toEqual({
      valid: false,
      error: 'File not found: ~/absent-key.txt',
    });
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'reports a permission error for a file without read access',
    async () => {
      const dir = keyFileDir();
      const filePath = path.join(dir, 'locked.json');
      fs.writeFileSync(filePath, '{}');
      fs.chmodSync(filePath, 0o000);
      const result = await validateKeyFile(filePath);
      expect(result).toEqual({
        valid: false,
        error: `Permission denied: ${filePath}`,
      });
    },
  );
});

describe('PARAM_VALIDATORS', () => {
  describe('temperature', () => {
    it('rejects values outside the 0.0 to 2.0 range', () => {
      for (const value of [-0.1, 2.1]) {
        expect(PARAM_VALIDATORS.temperature(value)).toEqual({
          valid: false,
          error: 'Must be between 0.0 and 2.0',
        });
      }
    });

    it('accepts values within the 0.0 to 2.0 range, inclusive', () => {
      for (const value of [0, 1, 2]) {
        expect(PARAM_VALIDATORS.temperature(value)).toEqual({ valid: true });
      }
    });
  });

  describe('maxTokens', () => {
    it('rejects non-positive or non-integer token counts', () => {
      for (const value of [0, -1, 1.5]) {
        expect(PARAM_VALIDATORS.maxTokens(value)).toEqual({
          valid: false,
          error: 'Must be a positive integer',
        });
      }
    });

    it('rejects token counts above the maximum', () => {
      expect(PARAM_VALIDATORS.maxTokens(1_000_001)).toEqual({
        valid: false,
        error: 'Maximum value is 1,000,000',
      });
    });

    it('accepts token counts at the boundaries', () => {
      expect(PARAM_VALIDATORS.maxTokens(1)).toEqual({ valid: true });
      expect(PARAM_VALIDATORS.maxTokens(1_000_000)).toEqual({ valid: true });
    });
  });

  describe('contextLimit', () => {
    it('rejects non-positive or non-integer context limits', () => {
      for (const value of [0, -1, 2.5]) {
        expect(PARAM_VALIDATORS.contextLimit(value)).toEqual({
          valid: false,
          error: 'Must be a positive integer',
        });
      }
    });

    it('accepts a positive integer context limit', () => {
      expect(PARAM_VALIDATORS.contextLimit(1)).toEqual({ valid: true });
    });
  });
});
