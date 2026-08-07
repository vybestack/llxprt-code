/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { loadCuratedHeadline } from '../../release-notes/curated-headline.js';
import { createTempDirHelper, writeTempFile } from './fixtures.js';

const getDir = createTempDirHelper();

describe('loadCuratedHeadline', () => {
  it('returns null when the file does not exist', () => {
    const dir = getDir();
    const result = loadCuratedHeadline(dir, '0.11.0');
    expect(result).toBeNull();
  });

  it('returns file content when the file exists', () => {
    const dir = getDir();
    writeTempFile(dir, '0.11.0.md', '## Major release\nThis is a big one.');
    const result = loadCuratedHeadline(dir, '0.11.0');
    expect(result).toBe('## Major release\nThis is a big one.');
  });

  it('returns null for empty file', () => {
    const dir = getDir();
    writeTempFile(dir, '0.11.0.md', '');
    const result = loadCuratedHeadline(dir, '0.11.0');
    expect(result).toBeNull();
  });

  it('returns null for whitespace-only file', () => {
    const dir = getDir();
    writeTempFile(dir, '0.11.0.md', '   \n\n  ');
    const result = loadCuratedHeadline(dir, '0.11.0');
    expect(result).toBeNull();
  });

  it('rejects version with path traversal characters', () => {
    const dir = getDir();
    const result = loadCuratedHeadline(dir, '../../../etc/passwd');
    expect(result).toBeNull();
  });

  it('rejects version with non-alphanumeric characters', () => {
    const dir = getDir();
    const result = loadCuratedHeadline(dir, '0.11.0;rm -rf');
    expect(result).toBeNull();
  });
});
