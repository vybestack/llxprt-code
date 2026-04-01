/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getPackageJson } from './package.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Returns the version of the @vybestack/llxprt-code-core package.
 * Falls back to 'unknown' if the package.json cannot be read.
 */
export async function getCoreVersion(): Promise<string> {
  const pkgJson = await getPackageJson(__dirname);
  return pkgJson?.version ?? 'unknown';
}
