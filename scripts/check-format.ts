/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import {
  compilerEmittedSiblings,
  emittedIgnoreEntries,
} from './compiler-emitted-siblings.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(join(root, 'tmp', 'format-emitted-'));
const ignore = join(temporary, '.prettierignore');
writeFileSync(
  ignore,
  emittedIgnoreEntries(root, ignore, compilerEmittedSiblings(root)),
);
try {
  await execa(
    resolve(root, 'node_modules/.bin/prettier'),
    [
      '--check',
      '.',
      '--ignore-path',
      '.gitignore',
      '--ignore-path',
      '.prettierignore',
      '--ignore-path',
      ignore,
    ],
    { cwd: root, stdio: 'inherit' },
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
