/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Version resolution for the ACP agent identity (issue #3095).
 *
 * This mirrors packages/cli/src/utils/version.ts rather than importing it:
 * #3306 made zed-acp a peer package that the CLI depends on, so an import in
 * that direction would close a cycle. Core's getCoreVersion() is not a
 * substitute either -- it reports the core package version and honours neither
 * the CLI_VERSION environment variable nor the startup-stable caching that the
 * ACP initialize response is specified against.
 */

import { getPackageJson } from '@vybestack/llxprt-code-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Captured at module initialization (startup/import time), not read per call,
// so the version reported over ACP cannot change mid-session.
let startupEnvVersion = process.env['CLI_VERSION'];

let versionPromise: Promise<string> | undefined;

async function resolveVersion(): Promise<string> {
  if (startupEnvVersion) {
    return startupEnvVersion;
  }

  try {
    const pkgJson = await getPackageJson(__dirname);
    return pkgJson?.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function getCliVersion(): Promise<string> {
  versionPromise ??= resolveVersion();
  return versionPromise;
}

/**
 * Resets the cached version and re-captures the current CLI_VERSION env var.
 *
 * Test seam: Bun's test runner does not support module re-imports, so tests
 * that need to verify startup-stable semantics across different env values
 * call this instead of `vi.resetModules()` + dynamic `import()`.
 */
export function __resetVersionCacheForTesting(): void {
  startupEnvVersion = process.env['CLI_VERSION'];
  versionPromise = undefined;
}
