/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getPackageJson } from '@vybestack/llxprt-code-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Capture env version at module initialization (startup/import time)
const startupEnvVersion = process.env['CLI_VERSION'];

let versionPromise: Promise<string> | undefined;

async function resolveVersion(): Promise<string> {
  // Use the startup-captured env version, not dynamically reading env
  if (startupEnvVersion) {
    return startupEnvVersion;
  }

  try {
    const pkgJson = await getPackageJson(__dirname);
    return pkgJson?.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function getCliVersion(): Promise<string> {
  if (versionPromise === undefined) {
    versionPromise = resolveVersion();
  }
  return versionPromise;
}
