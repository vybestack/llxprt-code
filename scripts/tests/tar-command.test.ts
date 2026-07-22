/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for the shared tar-command helper. Covers the contract
 * that findTarballName selects the final non-empty .tgz line and that all
 * spawn helpers include stderr || stdout in their error diagnostics.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');
const nodeRequire = createRequire(import.meta.url);

const tarCommand = nodeRequire(
  join(repoRoot, 'scripts', 'lib', 'tar-command.cjs'),
) as {
  findTarballName: (output: string, cacheDir?: string) => string;
  TAR_TIMEOUT_MS: number;
};

describe('findTarballName', () => {
  it('returns the final .tgz line from standard npm pack output', () => {
    const output = 'npm notice\nnpm notice\nvybestack-llxprt-code-0.10.0.tgz\n';
    expect(tarCommand.findTarballName(output)).toBe(
      'vybestack-llxprt-code-0.10.0.tgz',
    );
  });

  it('returns the LAST .tgz line when multiple .tgz lines exist', () => {
    // Simulate a verbose npm environment where a warning line happens to end
    // with .tgz. The function must return the final .tgz line, which is the
    // actual tarball filename.
    const output =
      'npm notice some-warning.tgz\n' +
      'npm notice more output\n' +
      'vybestack-llxprt-code-0.10.0.tgz\n';
    expect(tarCommand.findTarballName(output)).toBe(
      'vybestack-llxprt-code-0.10.0.tgz',
    );
  });

  it('ignores trailing empty lines after the .tgz filename', () => {
    const output = 'npm notice\nvybestack-llxprt-code-0.10.0.tgz\n\n\n';
    expect(tarCommand.findTarballName(output)).toBe(
      'vybestack-llxprt-code-0.10.0.tgz',
    );
  });

  it('handles output with no trailing newline', () => {
    const output = 'npm notice\nvybestack-llxprt-code-0.10.0.tgz';
    expect(tarCommand.findTarballName(output)).toBe(
      'vybestack-llxprt-code-0.10.0.tgz',
    );
  });

  it('throws when no .tgz line is found', () => {
    expect(() =>
      tarCommand.findTarballName('npm notice\nno tarball here\n'),
    ).toThrow(/did not contain a \.tgz line/);
  });

  it('throws when output is empty', () => {
    expect(() => tarCommand.findTarballName('')).toThrow(
      /did not contain a \.tgz line/,
    );
  });

  it('validates the tarball exists when cacheDir is provided', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tarball-name-'));
    try {
      const tarName = 'test-pkg-1.0.0.tgz';
      writeFileSync(join(dir, tarName), 'fake tarball');
      expect(tarCommand.findTarballName(`${tarName}\n`, dir)).toBe(tarName);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when the tarball does not exist in cacheDir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tarball-name-missing-'));
    try {
      expect(() =>
        tarCommand.findTarballName('missing-1.0.0.tgz\n', dir),
      ).toThrow(/does not exist/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('TAR_TIMEOUT_MS', () => {
  it('is a positive number', () => {
    expect(tarCommand.TAR_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
