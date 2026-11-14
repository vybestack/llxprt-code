/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');
const credentialSetting =
  /^(?:\/\/[^=]+:)?_(?:authToken|auth|password)\s*=|^\/\/[^=]+:username\s*=/i;

describe('tracked npm configuration', () => {
  it('does not store registry authentication credentials', () => {
    const trackedNpmrcFiles = execFileSync('git', ['ls-files', '*.npmrc'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((filePath) => filePath.length > 0);

    const credentialLines = trackedNpmrcFiles.flatMap((filePath) =>
      readFileSync(resolve(repoRoot, filePath), 'utf8')
        .split('\n')
        .map((line, index) => ({ filePath, line, lineNumber: index + 1 }))
        .filter(({ line }) => credentialSetting.test(line))
        .map(
          ({ filePath: path, lineNumber, line }) =>
            `${path}:${lineNumber}: ${line}`,
        ),
    );

    expect(credentialLines).toStrictEqual([]);
  });

  it('keeps the first-party registry and dependency cooldown settings', () => {
    const rootNpmrc = readFileSync(resolve(repoRoot, '.npmrc'), 'utf8');

    expect(rootNpmrc).toMatch(
      /^@vybestack:registry=https:\/\/registry\.npmjs\.org\/$/m,
    );
    expect(rootNpmrc).toMatch(/^min-release-age=3$/m);
  });
});
