/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createKeepDecision } from './conflict-resolution.js';

describe('createKeepDecision review copies', () => {
  let baseDir: string;
  let emptySourceDir: string;
  // With no default file on disk the review timestamp falls back to the epoch.
  const reviewName = 'core.md.19700101T000000';

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-review-'));
    emptySourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-nodef-'));
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
    fs.rmSync(emptySourceDir, { recursive: true, force: true });
  });

  const keep = (createReviewCopy: boolean) =>
    createKeepDecision(
      baseDir,
      'core.md',
      'new default content',
      'user-modified',
      createReviewCopy,
      [emptySourceDir],
    );

  it('writes the new default next to the user file as a review copy', async () => {
    const decision = await keep(true);

    expect(decision.action).toBe('keep');
    expect(fs.readFileSync(path.join(baseDir, reviewName), 'utf8')).toBe(
      'new default content',
    );
  });

  it('reports a decision without writing a file when review copies are off', async () => {
    const decision = await keep(false);

    expect(decision.action).toBe('keep');
    expect(fs.existsSync(path.join(baseDir, reviewName))).toBe(false);
  });

  it('treats an existing review copy as already resolved and leaves it alone', async () => {
    const review = path.join(baseDir, reviewName);
    fs.writeFileSync(review, 'earlier review copy');

    const decision = await keep(true);

    expect(decision).toStrictEqual({ action: 'resolved' });
    expect(fs.readFileSync(review, 'utf8')).toBe('earlier review copy');
  });

  it('treats an existing review copy as resolved when review copies are off', async () => {
    fs.writeFileSync(path.join(baseDir, reviewName), 'earlier review copy');

    const decision = await keep(false);

    expect(decision).toStrictEqual({ action: 'resolved' });
  });

  it.skipIf(process.platform === 'win32')(
    'does not write through a dangling symlink planted at the review path',
    async () => {
      const elsewhere = path.join(baseDir, 'elsewhere.txt');
      fs.symlinkSync(elsewhere, path.join(baseDir, reviewName));

      const decision = await keep(true);

      expect(decision).toStrictEqual({ action: 'resolved' });
      expect(fs.existsSync(elsewhere)).toBe(false);
    },
  );
});
