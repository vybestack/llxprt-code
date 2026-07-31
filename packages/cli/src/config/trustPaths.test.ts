/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { normalizeTrustPathInput } from './trustPaths.js';

const MOCK_HOME = path.resolve('/mock/home/user');

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn(() => MOCK_HOME),
  };
});

describe('normalizeTrustPathInput', () => {
  it('A1: normalizes an absolute path resolving dot-dot segments', () => {
    const workingDirectory = path.resolve('/work');
    const input = path.join(path.resolve('/a'), 'b', '..', 'c');

    const result = normalizeTrustPathInput(input, workingDirectory);

    expect(result).toStrictEqual({
      ok: true,
      normalizedPath: path.resolve('/a', 'c'),
    });
  });

  it('A2: resolves a relative input against the supplied working directory', () => {
    const workingDirectory = path.resolve('/work/project');
    const input = path.join('sub', 'dir');

    const result = normalizeTrustPathInput(input, workingDirectory);

    expect(result).toStrictEqual({
      ok: true,
      normalizedPath: path.resolve(workingDirectory, 'sub', 'dir'),
    });
  });

  it('A3: expands a bare tilde to the home directory', () => {
    const workingDirectory = path.resolve('/work');

    const result = normalizeTrustPathInput('~', workingDirectory);

    expect(result).toStrictEqual({
      ok: true,
      normalizedPath: MOCK_HOME,
    });
  });

  it('A3: expands ~/sub to the home directory plus the subpath', () => {
    const workingDirectory = path.resolve('/work');

    const result = normalizeTrustPathInput('~/x', workingDirectory);

    expect(result).toStrictEqual({
      ok: true,
      normalizedPath: path.join(MOCK_HOME, 'x'),
    });
  });

  it('A3: leaves a ~user form literal (treated as a relative path segment)', () => {
    const workingDirectory = path.resolve('/work');

    const result = normalizeTrustPathInput('~user', workingDirectory);

    expect(result).toStrictEqual({
      ok: true,
      normalizedPath: path.resolve(workingDirectory, '~user'),
    });
  });

  it('A4: returns an explicit "path required" error for empty input', () => {
    const workingDirectory = path.resolve('/work');

    const result = normalizeTrustPathInput('', workingDirectory);

    expect(result).toStrictEqual({
      ok: false,
      reason: 'path-required',
    });
  });

  it('A4: returns an explicit "path required" error for whitespace-only input', () => {
    const workingDirectory = path.resolve('/work');

    const result = normalizeTrustPathInput('   \t  ', workingDirectory);

    expect(result).toStrictEqual({
      ok: false,
      reason: 'path-required',
    });
  });

  it('A4: never throws for empty input', () => {
    const workingDirectory = path.resolve('/work');

    expect(() => normalizeTrustPathInput('', workingDirectory)).not.toThrow();
  });

  it('A5: trims leading and trailing whitespace', () => {
    const workingDirectory = path.resolve('/work');

    const result = normalizeTrustPathInput(
      `  ${path.resolve('/a', 'b')}  `,
      workingDirectory,
    );

    expect(result).toStrictEqual({
      ok: true,
      normalizedPath: path.resolve('/a', 'b'),
    });
  });

  it('A5: strips a matched pair of surrounding double quotes', () => {
    const workingDirectory = path.resolve('/work');
    const target = path.resolve('/a', 'b');
    const input = `"${target}"`;

    const result = normalizeTrustPathInput(input, workingDirectory);

    expect(result).toStrictEqual({
      ok: true,
      normalizedPath: target,
    });
  });

  it('A5: strips a matched pair of surrounding single quotes', () => {
    const workingDirectory = path.resolve('/work');
    const target = path.resolve('/a', 'b');
    const input = `'${target}'`;

    const result = normalizeTrustPathInput(input, workingDirectory);

    expect(result).toStrictEqual({
      ok: true,
      normalizedPath: target,
    });
  });

  it('A5: does NOT strip a leading quote when the trailing character differs', () => {
    const workingDirectory = path.resolve('/work');
    const input = '"sub';

    const result = normalizeTrustPathInput(input, workingDirectory);

    expect(result).toStrictEqual({
      ok: true,
      normalizedPath: path.resolve(workingDirectory, '"sub'),
    });
  });

  it('A5: does NOT strip a trailing quote when the leading character differs', () => {
    const workingDirectory = path.resolve('/work');
    const input = 'sub"';

    const result = normalizeTrustPathInput(input, workingDirectory);

    expect(result).toStrictEqual({
      ok: true,
      normalizedPath: path.resolve(workingDirectory, 'sub"'),
    });
  });

  it('A5: does NOT strip mismatched surrounding quote types', () => {
    const workingDirectory = path.resolve('/work');
    const input = `"sub'`;

    const result = normalizeTrustPathInput(input, workingDirectory);

    expect(result).toStrictEqual({
      ok: true,
      normalizedPath: path.resolve(workingDirectory, `"sub'`),
    });
  });

  it('A5: treats a quoted relative path as relative against the working directory', () => {
    const workingDirectory = path.resolve('/work');
    const input = '"sub/dir"';

    const result = normalizeTrustPathInput(input, workingDirectory);

    expect(result).toStrictEqual({
      ok: true,
      normalizedPath: path.resolve(workingDirectory, 'sub', 'dir'),
    });
  });

  it('A5: trims whitespace found inside the surrounding quotes', () => {
    const workingDirectory = path.resolve('/work');
    const target = path.resolve('/a', 'b');

    const result = normalizeTrustPathInput(`" ${target} "`, workingDirectory);

    expect(result).toStrictEqual({
      ok: true,
      normalizedPath: target,
    });
  });

  it('A4: reports "path required" for an empty quoted string rather than silently selecting the working directory', () => {
    const workingDirectory = path.resolve('/work');

    const result = normalizeTrustPathInput('""', workingDirectory);

    expect(result).toStrictEqual({
      ok: false,
      reason: 'path-required',
    });
  });

  it('A4: reports "path required" for a quoted whitespace-only string', () => {
    const workingDirectory = path.resolve('/work');

    const result = normalizeTrustPathInput("'   '", workingDirectory);

    expect(result).toStrictEqual({
      ok: false,
      reason: 'path-required',
    });
  });
});
