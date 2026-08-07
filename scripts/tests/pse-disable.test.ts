/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';

const ROOT = resolve(import.meta.dirname, '../..');
const SCRIPT = resolve(ROOT, 'scripts/codemods/pse-disable.ts');
const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('pse-disable ESLint report parsing', () => {
  it('accepts null rule IDs and applies only the requested rule', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pse-disable-'));
    tempDirectories.push(directory);
    const sourcePath = join(directory, 'fixture.ts');
    const reportPath = join(directory, 'report.json');
    writeFileSync(sourcePath, 'const first = 1;\nconst second = 2;\n');
    writeFileSync(
      reportPath,
      JSON.stringify([
        {
          filePath: sourcePath,
          messages: [
            { ruleId: null, line: 1 },
            { ruleId: 'vitest/no-conditional-in-test', line: 2 },
          ],
        },
      ]),
    );

    const result = spawnSync(
      process.execPath,
      [SCRIPT, reportPath, 'vitest/no-conditional-in-test', 'fixture'],
      { cwd: ROOT, encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(sourcePath, 'utf8')).toBe(
      'const first = 1;\n// eslint-disable-next-line vitest/no-conditional-in-test -- fixture\nconst second = 2;\n',
    );
  });
});
