/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSyncWithFileCapture } from './sync-process.ts';

const generatorPath = fileURLToPath(
  new URL('../../memory/output-generator.ts', import.meta.url),
);
const repoRoot = resolve(generatorPath, '..', '..', '..');

// Under `bun test`, process.execPath is the bun binary running the tests —
// the portable interpreter, unlike Bun.which('bun').
const bunExecutable = process.execPath;

interface GeneratorResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runGenerator(args: readonly string[]): GeneratorResult {
  const result = spawnSyncWithFileCapture(
    join(repoRoot, 'tmp'),
    bunExecutable,
    [generatorPath, ...args],
    { cwd: repoRoot },
  );
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function validArgs(seed: string): readonly string[] {
  return ['--seed', seed, '--lines', '24', '--width', '80'];
}

const invalidCases: ReadonlyArray<{
  readonly name: string;
  readonly args: readonly string[];
  readonly diagnostic: string;
}> = [
  {
    name: 'a missing seed value',
    args: ['--seed'],
    diagnostic: 'missing value for --seed',
  },
  {
    name: 'a seed containing marker-breaking characters',
    args: ['--seed', 'bad seed', '--lines', '1', '--width', '1'],
    diagnostic: 'invalid value for --seed',
  },
  {
    name: 'zero lines',
    args: ['--seed', 'bad-lines', '--lines', '0', '--width', '1'],
    diagnostic: 'invalid value for --lines',
  },
  {
    name: 'fractional width',
    args: ['--seed', 'bad-width', '--lines', '1', '--width', '1.5'],
    diagnostic: 'invalid value for --width',
  },
  {
    name: 'a duplicate option',
    args: [
      '--seed',
      'duplicate',
      '--seed',
      'again',
      '--lines',
      '1',
      '--width',
      '1',
    ],
    diagnostic: '--seed may only be specified once',
  },
  {
    name: 'an unknown option',
    args: ['--seed', 'unknown', '--lines', '1', '--width', '1', '--extra'],
    diagnostic: 'unknown option: --extra',
  },
];

describe('issue #3386 deterministic output generator', () => {
  it('emits identical bytes for identical arguments and different bytes for different seeds', () => {
    const first = runGenerator(validArgs('baseline-a'));
    const repeated = runGenerator(validArgs('baseline-a'));
    const different = runGenerator(validArgs('baseline-b'));

    expect(first.exitCode, first.stderr).toBe(0);
    expect(repeated.exitCode, repeated.stderr).toBe(0);
    expect(different.exitCode, different.stderr).toBe(0);
    expect(repeated.stdout).toBe(first.stdout);
    expect(different.stdout).not.toBe(first.stdout);
  });

  it('emits the requested printable dimensions followed by the seed marker', () => {
    const result = runGenerator([
      '--seed',
      'dimensions-17',
      '--lines',
      '37',
      '--width',
      '113',
    ]);
    const lines = result.stdout.trimEnd().split('\n');
    const payload = lines.slice(0, -1);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(payload).toHaveLength(37);
    expect(payload.every((line) => line.length === 113)).toBe(true);
    expect(payload.every((line) => /^[\x21-\x7e]+$/.test(line))).toBe(true);
    expect(new Set(payload).size).toBe(payload.length);
    expect(new Set(payload.join('')).size).toBeGreaterThan(80);
    expect(lines.at(-1)).toBe('LLXPRT3386_OUTPUT_DONE_dimensions-17');
    expect(result.stdout.endsWith('\n')).toBe(true);
  });

  for (const invalidCase of invalidCases) {
    it(`rejects ${invalidCase.name} without emitting a payload`, () => {
      const result = runGenerator(invalidCase.args);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(invalidCase.diagnostic);
      expect(result.stderr).toContain(
        'Usage: bun scripts/memory/output-generator.ts',
      );
    });
  }
});
