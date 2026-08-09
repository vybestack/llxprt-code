/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Parser-boundary tests for the Windows installed-command relevance
 * classifier (issue #2693, finding 5).
 *
 * These prove the EXTERNAL PARSING BOUNDARY (parseFileEntry) rejects
 * malformed GitHub PR-files-API entries by returning null, rather than
 * silently normalizing missing/non-string status to 'modified' or dropping
 * malformed previous_filename. This causes a parsed-entry count mismatch
 * against the authoritative changed_files total, which fails closed
 * (relevant=true) in the pure classifier.
 *
 * Distinct from the remediation tests which cover the pure-classifier-level
 * validateEntryShape; these tests exercise the real parser that sits at the
 * untrusted external data boundary.
 */

import { describe, it, expect } from 'bun:test';
import {
  classifyWindowsRelevance,
  parseFileEntry,
  type WindowsChangedFileEntry,
} from '../windows-installed-command-relevance.ts';

const BASE_MANIFEST = JSON.stringify({
  name: '@vybestack/llxprt-code',
  version: '0.11.0',
  type: 'module',
  private: true,
  workspaces: ['packages/core', 'packages/cli'],
  scripts: {
    preinstall: 'node scripts/preinstall.cjs',
    postinstall: 'node scripts/postinstall.cjs',
  },
  dependencies: { bun: '1.3.14' },
});

describe('windows-relevance: external parser rejects malformed API entries', () => {
  it('returns null for missing status', () => {
    expect(parseFileEntry({ filename: 'docs/index.md' })).toBeNull();
  });

  it('returns null for non-string status', () => {
    expect(
      parseFileEntry({ filename: 'docs/index.md', status: 42 }),
    ).toBeNull();
  });

  it('returns null for unrecognized status', () => {
    expect(
      parseFileEntry({ filename: 'docs/index.md', status: 'bogus' }),
    ).toBeNull();
  });

  it('returns null for empty status', () => {
    expect(
      parseFileEntry({ filename: 'docs/index.md', status: '' }),
    ).toBeNull();
  });

  it('returns null for renamed entry without previous_filename', () => {
    expect(
      parseFileEntry({ filename: 'docs/new.md', status: 'renamed' }),
    ).toBeNull();
  });

  it('returns null for renamed entry with non-string previous_filename', () => {
    expect(
      parseFileEntry({
        filename: 'docs/new.md',
        status: 'renamed',
        previous_filename: 42,
      }),
    ).toBeNull();
  });

  it('returns null for renamed entry with empty previous_filename', () => {
    expect(
      parseFileEntry({
        filename: 'docs/new.md',
        status: 'renamed',
        previous_filename: '',
      }),
    ).toBeNull();
  });

  it('returns null for non-object raw (null, string, array)', () => {
    expect(parseFileEntry(null)).toBeNull();
    expect(parseFileEntry('not-an-object')).toBeNull();
    expect(parseFileEntry([1, 2, 3])).toBeNull();
  });

  it('returns null for missing or empty filename', () => {
    expect(parseFileEntry({ status: 'modified' })).toBeNull();
    expect(parseFileEntry({ filename: '', status: 'modified' })).toBeNull();
  });

  it('preserves a valid modified entry', () => {
    expect(
      parseFileEntry({ filename: 'docs/index.md', status: 'modified' }),
    ).toEqual({ filename: 'docs/index.md', status: 'modified' });
  });

  it('preserves a valid added entry', () => {
    expect(parseFileEntry({ filename: 'README.md', status: 'added' })).toEqual({
      filename: 'README.md',
      status: 'added',
    });
  });

  it('preserves a valid renamed entry with previous_filename', () => {
    expect(
      parseFileEntry({
        filename: 'docs/new.md',
        status: 'renamed',
        previous_filename: 'docs/old.md',
      }),
    ).toEqual({
      filename: 'docs/new.md',
      status: 'renamed',
      previous_filename: 'docs/old.md',
    });
  });

  it('preserves every recognized status', () => {
    for (const status of [
      'added',
      'removed',
      'modified',
      'renamed',
      'copied',
      'changed',
      'unchanged',
    ]) {
      const raw =
        status === 'renamed'
          ? {
              filename: 'docs/x.md',
              status,
              previous_filename: 'docs/old.md',
            }
          : { filename: 'docs/x.md', status };
      const result = parseFileEntry(raw);
      expect(result, `status '${status}'`).not.toBeNull();
      expect(result?.status).toBe(status);
    }
  });
});

describe('windows-relevance: malformed entries cause count mismatch (fail closed)', () => {
  it('malformed status drops entry → count mismatch → relevant', () => {
    const rawEntries: unknown[] = [
      { filename: 'docs/index.md', status: 'modified' },
      { filename: 'docs/bad.md', status: 'bogus' },
    ];
    const parsed = rawEntries
      .map(parseFileEntry)
      .filter((e): e is WindowsChangedFileEntry => e !== null);
    expect(parsed.length).toBe(1);
    const result = classifyWindowsRelevance({
      event: 'pull_request',
      changedEntries: parsed,
      changedFilesCount: 2,
      baseManifest: BASE_MANIFEST,
      headManifest: BASE_MANIFEST,
    });
    expect(result.relevant).toBe(true);
    expect(result.reason).toContain('mismatch');
  });

  it('malformed rename drops entry → count mismatch → relevant', () => {
    const rawEntries: unknown[] = [
      {
        filename: 'docs/good.md',
        status: 'renamed',
        previous_filename: 'docs/old.md',
      },
      { filename: 'docs/bad.md', status: 'renamed' },
    ];
    const parsed = rawEntries
      .map(parseFileEntry)
      .filter((e): e is WindowsChangedFileEntry => e !== null);
    expect(parsed.length).toBe(1);
    const result = classifyWindowsRelevance({
      event: 'pull_request',
      changedEntries: parsed,
      changedFilesCount: 2,
      baseManifest: BASE_MANIFEST,
      headManifest: BASE_MANIFEST,
    });
    expect(result.relevant).toBe(true);
    expect(result.reason).toContain('mismatch');
  });
});
