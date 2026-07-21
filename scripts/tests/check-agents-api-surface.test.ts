/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');
const checkerPath = join(repoRoot, 'scripts', 'check-agents-api-surface.mjs');

describe('agents API-surface checker process', () => {
  it('runs the repository TypeScript compiler without npm or npx on PATH', () => {
    const emptyPath = mkdtempSync(join(tmpdir(), 'agents-api-empty-path-'));

    try {
      const result = spawnSync(process.execPath, [checkerPath], {
        cwd: repoRoot,
        env: { ...process.env, PATH: emptyPath, Path: emptyPath },
        encoding: 'utf8',
        timeout: 130_000,
      });
      const diagnostics = [
        `status: ${String(result.status)}`,
        `error: ${result.error?.message ?? '<none>'}`,
        `stdout: ${result.stdout}`,
        `stderr: ${result.stderr}`,
      ].join('\n');

      expect(result.status, diagnostics).toBe(0);
      expect(result.stdout, diagnostics).toContain(
        'PASS: agents API-surface report matches expected snapshot.',
      );
    } finally {
      rmSync(emptyPath, { recursive: true, force: true });
    }
  }, 140_000);
});
