/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { appendFile, writeFile } from 'node:fs/promises';
import { text } from 'node:stream/consumers';
import { z } from 'zod';

const [mode, output] = z
  .tuple([z.enum(['write', 'append']), z.string()])
  .parse(process.argv.slice(2));
const input = await text(process.stdin);
if (mode === 'append') {
  await appendFile(output, input + '\n', 'utf8');
} else {
  await writeFile(output, input, 'utf8');
}
