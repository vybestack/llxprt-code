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
  /^((?:\/\/[^=]+:)?_(?:authToken|auth|password)|\/\/[^=]+:username)\s*=/i;

type CredentialFinding = { line: number; setting: string };

function findCredentialSettings(contents: string): CredentialFinding[] {
  return contents.split('\n').flatMap((rawLine, index) => {
    const line = rawLine.trimStart();
    if (line.startsWith('#') || line.startsWith(';')) {
      return [];
    }

    const match = credentialSetting.exec(line);
    return match === null ? [] : [{ line: index + 1, setting: match[1] }];
  });
}

describe('npm credential detection', () => {
  it('detects credential settings with leading whitespace', () => {
    expect(
      findCredentialSettings(
        '  //registry.npmjs.org/:_authToken=fixture-secret',
      ),
    ).toStrictEqual([{ line: 1, setting: '//registry.npmjs.org/:_authToken' }]);
  });

  it('returns findings and diagnostics without credential values', () => {
    const findings = findCredentialSettings(
      '//registry.npmjs.org/:_authToken=literal-secret-value',
    );
    const diagnostic = findings
      .map(({ line, setting }) => `package/.npmrc:${line}: ${setting}`)
      .join('\n');

    expect(findings).toStrictEqual([
      { line: 1, setting: '//registry.npmjs.org/:_authToken' },
    ]);
    expect(JSON.stringify(findings)).not.toContain('literal-secret-value');
    expect(diagnostic).toContain(
      'package/.npmrc:1: //registry.npmjs.org/:_authToken',
    );
    expect(diagnostic).not.toContain('literal-secret-value');
  });

  it('ignores commented credential settings', () => {
    expect(
      findCredentialSettings(
        '# //registry.npmjs.org/:_authToken=commented-token\n;_password=commented-password',
      ),
    ).toStrictEqual([]);
  });
});

describe('tracked npm configuration', () => {
  it('does not store registry authentication credentials', () => {
    const trackedNpmrcFiles = execFileSync('git', ['ls-files', '*.npmrc'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((filePath) => filePath.length > 0);

    const credentialLines = trackedNpmrcFiles.flatMap((filePath) =>
      findCredentialSettings(
        readFileSync(resolve(repoRoot, filePath), 'utf8'),
      ).map(({ line, setting }) => `${filePath}:${line}: ${setting}`),
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
