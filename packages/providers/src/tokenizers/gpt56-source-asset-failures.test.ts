/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function observeFailure(mode: string): unknown {
  const directory = mkdtempSync(join(tmpdir(), 'source-probe-result-'));
  const output = join(directory, 'result.json');
  try {
    execFileSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            './gpt56-source-failure-probe.test-helper.ts',
            import.meta.url,
          ),
        ),
        mode,
        output,
      ],
      { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const result = readFileSync(output, 'utf8');
    if (result.includes('secret-private-prompt'))
      throw new Error('Prompt leaked in error metadata');
    return JSON.parse(result);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('source adapter readiness, assets and I/O cleanup', () => {
  it.each([
    'codec-init-missing',
    'codec-init-corrupt',
    'ranks-missing',
    'ranks-corrupt',
  ])(
    'maps %s filesystem failure to asset-unavailable while releasing the source lease',
    async (mode) => {
      expect(await observeFailure(mode)).toMatchObject({
        error: { code: 'asset-unavailable' },
        disposed: true,
        workspace: [],
        openFiles: [],
      });
    },
    30000,
  );

  it('closes an opened disk reader when a real read is interrupted by an I/O fault', () => {
    expect(observeFailure('reader-io')).toMatchObject({
      error: { code: 'tokenization-failed' },
      disposed: true,
      workspace: [],
      openFiles: [],
      openedReaders: 1,
    });
  }, 30000);

  it('closes opened disk readers on cancellation without leaving unlinked live handles', () => {
    const result = observeFailure('cancel-reader');
    expect(result).toMatchObject({
      error: { code: 'tokenization-failed' },
      disposed: true,
      workspace: [],
      openFiles: [],
      aborted: true,
    });
    if (
      typeof result !== 'object' ||
      result === null ||
      !('openedReaders' in result)
    )
      throw new Error('Reader evidence missing');
    expect(result.openedReaders).toBeGreaterThan(0);
  }, 30000);
});
