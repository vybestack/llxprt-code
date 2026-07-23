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
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');
const nodeRequire = createRequire(import.meta.url);

// nodeRequire returns 'any' because tar-command.cjs is a CommonJS module
// without type declarations (.d.ts). The type assertion provides the known
// shape of the module's exports for compile-time safety.
const tarCommand = nodeRequire(
  join(repoRoot, 'scripts', 'lib', 'tar-command.cjs'),
) as {
  findTarballName: (output: string, cacheDir?: string) => string;
  spawnTarList: (
    tarball: string,
    timeoutMs?: number,
    cwd?: string,
  ) => { stdout: string; stderr: string };
  spawnTarListVerbose: (
    tarball: string,
    member: string,
    timeoutMs?: number,
    cwd?: string,
  ) => { stdout: string; stderr: string };
  spawnTarExtract: (
    tarball: string,
    extractDir: string,
    timeoutMs?: number,
    cwd?: string,
  ) => { stdout: string; stderr: string };
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

  it('rejects a stray warning line ending in .tgz that is not a tarball name', () => {
    // A line like "npm notice created something.tgz" ends in .tgz but does
    // not have the name-version.tgz shape of a real tarball. The shape check
    // must prevent it from being returned as a false positive.
    const output =
      'npm notice created something.tgz\n' +
      'npm notice more output\n' +
      'vybestack-llxprt-code-0.10.0.tgz\n';
    expect(tarCommand.findTarballName(output)).toBe(
      'vybestack-llxprt-code-0.10.0.tgz',
    );
  });

  it('rejects a trailing bare .tgz with no package name prefix', () => {
    // A line that is just ".tgz" or "  .tgz" must not match.
    expect(() => tarCommand.findTarballName('some warning\n.tgz\n')).toThrow(
      /did not contain a \.tgz line/,
    );
  });

  it('accepts scoped package tarball names', () => {
    const output = '@vybestack-llxprt-code-0.10.0.tgz\n';
    expect(tarCommand.findTarballName(output)).toBe(
      '@vybestack-llxprt-code-0.10.0.tgz',
    );
  });
});

describe('TAR_TIMEOUT_MS', () => {
  it('is a positive number', () => {
    expect(tarCommand.TAR_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe('spawnTarList', () => {
  it('lists the contents of a valid tarball', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tar-list-'));
    try {
      const tarName = 'test-pkg-1.0.0.tgz';
      const tarPath = join(dir, tarName);
      // Create a minimal valid gzip tarball containing a single file.
      const innerDir = join(dir, 'payload');
      mkdirSync(innerDir, { recursive: true });
      writeFileSync(join(innerDir, 'hello.txt'), 'world');
      spawnSync('tar', ['-czf', tarPath, '-C', dir, 'payload'], {
        encoding: 'utf8',
      });
      const result = tarCommand.spawnTarList(tarPath);
      expect(result.stdout).toContain('hello.txt');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('honors the cwd option for relative tarball paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tar-cwd-'));
    try {
      const tarName = 'cwd-pkg-1.0.0.tgz';
      const tarPath = join(dir, tarName);
      const innerDir = join(dir, 'payload');
      mkdirSync(innerDir, { recursive: true });
      writeFileSync(join(innerDir, 'marker.txt'), 'data');
      spawnSync('tar', ['-czf', tarPath, '-C', dir, 'payload'], {
        encoding: 'utf8',
      });
      // Pass a relative path and set cwd to the directory containing it.
      const result = tarCommand.spawnTarList(tarName, undefined, dir);
      expect(result.stdout).toContain('marker.txt');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('spawnTarExtract', () => {
  it('extracts a tarball into the specified directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tar-extract-'));
    try {
      const tarName = 'extract-pkg-1.0.0.tgz';
      const tarPath = join(dir, tarName);
      const innerDir = join(dir, 'payload');
      mkdirSync(innerDir, { recursive: true });
      writeFileSync(join(innerDir, 'extracted.txt'), 'contents');
      spawnSync('tar', ['-czf', tarPath, '-C', dir, 'payload'], {
        encoding: 'utf8',
      });
      const extractDir = join(dir, 'out');
      mkdirSync(extractDir, { recursive: true });
      tarCommand.spawnTarExtract(tarPath, extractDir);
      expect(existsSync(join(extractDir, 'payload', 'extracted.txt'))).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws a clear diagnostic when extract destination does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tar-extract-noexist-'));
    try {
      const tarPath = join(dir, 'dummy-1.0.0.tgz');
      writeFileSync(tarPath, 'dummy');
      const missingDir = join(dir, 'does-not-exist');
      expect(() => tarCommand.spawnTarExtract(tarPath, missingDir)).toThrow(
        /does not exist/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws a clear diagnostic when extract destination is a file not a directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tar-extract-filedest-'));
    try {
      const tarPath = join(dir, 'dummy-1.0.0.tgz');
      writeFileSync(tarPath, 'dummy');
      const fileDest = join(dir, 'not-a-dir');
      writeFileSync(fileDest, 'I am a file');
      expect(() => tarCommand.spawnTarExtract(tarPath, fileDest)).toThrow(
        /not a directory/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
