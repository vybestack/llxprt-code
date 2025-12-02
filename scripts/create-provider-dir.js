#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const providerDir = join(
  __dirname,
  '..',
  'packages',
  'core',
  'src',
  'providers',
  'openai-vercel',
);

try {
  await mkdir(providerDir, { recursive: true });

  const placeholderPath = join(providerDir, '.gitkeep');
  await writeFile(placeholderPath, '');

  console.log(`[OK] Created directory: ${providerDir}`);
  process.exit(0);
} catch (error) {
  console.error(' Error creating directory:', error);
  process.exit(1);
}
