/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeFileSync } from 'node:fs';

const [url, marker] = process.argv.slice(2);
if (!url || !marker) throw new Error('Expected gate URL and marker path');
writeFileSync(`${marker}.pid`, String(process.pid));
process.stdout.write('waiting for shell owner gate\n');
const response = await fetch(url);
if ((await response.text()) === 'release') {
  writeFileSync(marker, 'released\n');
}
