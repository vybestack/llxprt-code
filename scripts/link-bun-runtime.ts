/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Installs the Bun binary that `npm ci --ignore-scripts` leaves unlinked
 * (issue #3930).
 *
 * The `bun` npm package ships a placeholder `bin/bun.exe` and relies on its
 * `postinstall` (`node install.js`) to replace it with the binary from the
 * matching `@oven/bun-<variant>` optional dependency. That script executes the
 * selected binary and, when the variant is missing, runs `npm install` or
 * downloads a tarball directly, which bypasses the lockfile's integrity
 * hashes. Privileged CI jobs (OIDC publish, registry login, write tokens) must
 * not run it.
 *
 * This script does the one useful thing that postinstall does, using only
 * files `npm ci` already extracted and verified against `package-lock.json`:
 * it copies `node_modules/@oven/bun-<variant>/bin/bun[.exe]` over
 * `node_modules/bun/bin/bun.exe` and hard-links `bunx.exe` to it. The
 * `node_modules/.bin/bun` and `bunx` entries npm created point at those two
 * paths already. No third-party code runs and nothing touches the network.
 *
 * Variant selection is shared with the launcher
 * (`packages/cli/src/launcher/oven-bun-variants.ts`). Run it with
 * `node scripts/link-bun-runtime.ts` (Node strips the types).
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OVEN_PACKAGE_VERSION,
  detectHostPlatform,
  selectOvenVariants,
  type HostPlatformInput,
} from '../packages/cli/src/launcher/oven-bun-variants.ts';

const EXECUTABLE_MODE = 0o755;

export interface LinkBunRuntimeOptions {
  /** Repository root that contains `node_modules`. */
  readonly repoRoot: string;
  /** Resolved host description; defaults to probing the current machine. */
  readonly host?: HostPlatformInput | null;
}

export interface LinkBunRuntimeResult {
  readonly source: string;
  readonly bunExe: string;
  readonly bunxExe: string;
}

function readPackageVersion(packageDir: string): string {
  const manifestPath = join(packageDir, 'package.json');
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Missing ${manifestPath}. Run "npm ci --ignore-scripts" first.`,
    );
  }
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const version =
    typeof manifest === 'object' && manifest !== null
      ? (manifest as { version?: unknown }).version
      : undefined;
  if (typeof version !== 'string') {
    throw new Error(`${manifestPath} has no version field.`);
  }
  return version;
}

function describeHost(host: HostPlatformInput): string {
  return `${host.os}/${host.arch}${host.abi ? `/${host.abi}` : ''}${
    host.avx2 ? ' (avx2)' : ''
  }`;
}

function findInstalledVariant(
  nodeModules: string,
  host: HostPlatformInput,
): { packageDir: string; executable: string } {
  const tried: string[] = [];
  for (const variant of selectOvenVariants(host)) {
    const packageDir = join(nodeModules, variant.packageName);
    for (const exeName of variant.exeNames) {
      const executable = join(packageDir, exeName);
      if (existsSync(executable)) {
        return { packageDir, executable };
      }
    }
    tried.push(variant.packageName);
  }
  throw new Error(
    `No @oven/bun-* package is installed for ${describeHost(host)}. ` +
      `Looked for: ${tried.length > 0 ? tried.join(', ') : '(no variant for this host)'}. ` +
      'The lockfile must list the matching optional dependency and npm ci must not run with --no-optional.',
  );
}

export function linkBunRuntime(
  options: LinkBunRuntimeOptions,
): LinkBunRuntimeResult {
  const host = options.host === undefined ? detectHostPlatform() : options.host;
  if (host === null) {
    throw new Error(
      'Unsupported host architecture for the Bun runtime (no @oven/bun-* variant).',
    );
  }

  const nodeModules = join(options.repoRoot, 'node_modules');
  const bunPackageDir = join(nodeModules, 'bun');
  const bunVersion = readPackageVersion(bunPackageDir);
  if (bunVersion !== OVEN_PACKAGE_VERSION) {
    throw new Error(
      `node_modules/bun is ${bunVersion} but the launcher pins ${OVEN_PACKAGE_VERSION}.`,
    );
  }

  const { packageDir, executable } = findInstalledVariant(nodeModules, host);
  const variantVersion = readPackageVersion(packageDir);
  if (variantVersion !== bunVersion) {
    throw new Error(
      `${packageDir} is ${variantVersion} but node_modules/bun is ${bunVersion}.`,
    );
  }

  const bunExe = join(bunPackageDir, 'bin', 'bun.exe');
  const bunxExe = join(bunPackageDir, 'bin', 'bunx.exe');
  // Remove first so a previous hard link never writes through into another
  // package's file.
  rmSync(bunExe, { force: true });
  rmSync(bunxExe, { force: true });
  copyFileSync(executable, bunExe);
  chmodSync(bunExe, EXECUTABLE_MODE);
  linkSync(bunExe, bunxExe);

  return { source: executable, bunExe, bunxExe };
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  return (
    entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)
  );
}

if (isEntryPoint()) {
  const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
  try {
    const { source, bunExe } = linkBunRuntime({ repoRoot });
    console.log(`Linked ${source} -> ${bunExe}`);
  } catch (error) {
    console.error(
      `link-bun-runtime: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
