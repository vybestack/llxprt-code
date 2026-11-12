/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

describe('prepared Homebrew release tarball', () => {
  it('calculates the formula checksum from the prepared package artifact', () => {
    const work = mkdtempSync(
      join(tmpdir(), 'llxprt-homebrew-prepared-tarball-'),
    );
    const tarball = join(work, 'llxprt-code-1.2.3.tgz');
    const contents = 'prepared release package bytes';
    const expectedSha = createHash('sha256').update(contents).digest('hex');

    try {
      writeFileSync(tarball, contents);
      const result = spawnSync(
        'bun',
        ['scripts/update-homebrew-formula.ts', '1.2.3', tarball],
        {
          cwd: ROOT,
          encoding: 'utf8',
          env: { ...process.env, DRY_RUN: 'true' },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`Using prepared tarball at ${tarball}`);
      expect(result.stdout).toContain(`SHA256: ${expectedSha}`);
      expect(result.stdout).toContain(`sha256 "${expectedSha}"`);
      expect(result.stdout).not.toContain('Downloading tarball from');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
