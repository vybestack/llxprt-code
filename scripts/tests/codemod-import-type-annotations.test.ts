/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const SCRIPT = resolve(ROOT, 'scripts/codemod-import-type-annotations.ts');
const tempDirectories: string[] = [];

function runCodemod(source: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'import-type-codemod-'));
  tempDirectories.push(directory);
  const sourcePath = join(directory, 'fixture.ts');
  writeFileSync(sourcePath, source);
  const result = spawnSync(process.execPath, [SCRIPT, sourcePath], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  return readFileSync(sourcePath, 'utf8');
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('codemod-import-type-annotations', () => {
  it('adds a type-only specifier to an existing value import', () => {
    const output = runCodemod(
      "import { value } from './types';\nexport type Added = import('./types').Added;\nconsole.log(value);\n",
    );
    expect(output).toContain("import { value, type Added } from './types';");
  });

  it('does not redundantly mark a specifier inside an import type declaration', () => {
    const output = runCodemod(
      "import type { Existing } from './types';\nexport type Added = import('./types').Added;\n",
    );
    expect(output).toContain("import type { Existing, Added } from './types';");
    expect(output).not.toContain('Existing, type Added');
  });
});
