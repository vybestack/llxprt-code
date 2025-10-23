/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');
const defaultsDir = path.join(root, 'packages/core/src/prompt-config/defaults');
const distDir = path.join(root, 'packages/core/dist/prompt-config/defaults');
const manifestFilename = 'default-prompts.json';

async function main() {
  const files = (
    await glob('**/*.md', {
      cwd: defaultsDir,
      nodir: true,
      dot: false,
      ignore: ['generated/**'],
      windowsPathsNoEscape: true,
    })
  ).sort();

  /** @type {{ [key: string]: string }} */
  const manifest = {};

  for (const relativePath of files) {
    const fullPath = path.join(defaultsDir, relativePath);
    const buffer = await readFile(fullPath);
    manifest[relativePath.replace(/\\/g, '/')] = buffer
      .toString('utf-8')
      .replace(/\r\n/g, '\n');
  }

  if (!existsSync(distDir)) {
    await mkdir(distDir, { recursive: true });
  }

  const outputPath = path.join(distDir, manifestFilename);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(outputPath, serialized, 'utf-8');
}

await main();
