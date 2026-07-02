#!/usr/bin/env bun

/**
 * check-storage-package-cycle.ts
 *
 * Validates that no dependency cycle includes @vybestack/llxprt-code-storage.
 * Reads package.json manifests for all workspace packages and checks
 * dependency graphs.
 *
 * Usage:
 *   bun scripts/check-storage-package-cycle.ts --production
 *   bun scripts/check-storage-package-cycle.ts --all-dependencies
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Dirent } from 'node:fs';
import { messageOf } from './utils/error-guards.ts';

const STORAGE_PKG = '@vybestack/llxprt-code-storage';
const WORKSPACE_PREFIX = '@vybestack/llxprt-code-';

interface WorkspacePackageInfo {
  name: string;
  dir: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
}

interface PackageJsonLike {
  name?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  optionalDependencies?: unknown;
}

type ParsedArgs = Record<string, boolean | string> & {
  production?: boolean | string;
  'all-dependencies'?: boolean | string;
};

interface CycleResult {
  hasCycle: boolean;
  cycles: string[][];
}

function dependencyMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  // package.json dependency specifiers are strings; malformed non-string entries
  // are outside this cycle check and are intentionally ignored here.
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const raw =
        argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = raw;
    }
  }
  return args;
}

function getWorkspacePackages(
  packagesDir: string,
): Record<string, WorkspacePackageInfo> {
  const pkgs: Record<string, WorkspacePackageInfo> = {};
  let entries: Dirent[];
  try {
    entries = readdirSync(packagesDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `Could not read packages directory ${packagesDir}: ${messageOf(error)}`,
    );
  }

  for (const entry of entries) {
    const pkgJsonPath = join(packagesDir, entry.name, 'package.json');
    if (!entry.isDirectory() || !existsSync(pkgJsonPath)) continue;
    try {
      const pkg = JSON.parse(
        readFileSync(pkgJsonPath, 'utf-8'),
      ) as PackageJsonLike;
      if (typeof pkg.name === 'string') {
        pkgs[pkg.name] = {
          name: pkg.name,
          dir: join(packagesDir, entry.name),
          dependencies: dependencyMap(pkg.dependencies),
          devDependencies: dependencyMap(pkg.devDependencies),
          optionalDependencies: dependencyMap(pkg.optionalDependencies),
        };
      }
    } catch (error) {
      console.warn(
        `Warning: could not parse ${pkgJsonPath}: ${messageOf(error)}`,
      );
    }
  }
  return pkgs;
}

function getDeps(pkg: WorkspacePackageInfo, productionOnly: boolean): string[] {
  const deps = new Set([
    ...Object.keys(pkg.dependencies),
    ...Object.keys(pkg.optionalDependencies),
  ]);
  if (!productionOnly) {
    for (const depName of Object.keys(pkg.devDependencies)) {
      deps.add(depName);
    }
  }
  return [...deps];
}

function findReverseStorageCycles(
  name: string,
  pkgs: Record<string, WorkspacePackageInfo>,
  storagePkgName: string,
  storageDeps: readonly string[],
  productionOnly: boolean,
): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();

  function dfs(pName: string, trail: string[]): void {
    if (pName === name) {
      cycles.push([...trail, storagePkgName]);
      return;
    }
    if (visited.has(pName) || !pName.startsWith(WORKSPACE_PREFIX)) return;
    visited.add(pName);
    const pkg = pkgs[pName];
    if (!pkg) return;
    for (const dep of getDeps(pkg, productionOnly)) {
      dfs(dep, [...trail, dep]);
    }
  }

  for (const dep of storageDeps) {
    visited.clear();
    dfs(dep, [storagePkgName, dep]);
  }

  return cycles;
}

function detectCycles(
  pkgs: Record<string, WorkspacePackageInfo>,
  storagePkgName: string,
  productionOnly: boolean,
): CycleResult {
  // Check if storage package exists
  if (!pkgs[storagePkgName]) {
    console.log(
      `Package ${storagePkgName} not found — no cycle possible. PASS.`,
    );
    return { hasCycle: false, cycles: [] };
  }

  // DFS from storage to find cycles
  // Check: does any dependency of storage transitively depend on storage?
  const visited = new Set<string>();
  const cycles: string[][] = [];

  function dfs(pkgName: string, path: string[]): void {
    if (pkgName === storagePkgName && path.length > 1) {
      cycles.push([...path, pkgName]);
      return;
    }
    if (visited.has(pkgName)) return;
    if (!pkgName.startsWith(WORKSPACE_PREFIX)) return; // only check workspace packages
    visited.add(pkgName);

    const pkg = pkgs[pkgName];
    if (!pkg) return;

    const deps = getDeps(pkg, productionOnly);
    for (const dep of deps) {
      dfs(dep, [...path, pkgName]);
    }
  }

  // Start from storage's dependencies, see if they lead back to storage
  const storageDeps = getDeps(pkgs[storagePkgName], productionOnly);
  for (const dep of storageDeps) {
    visited.clear();
    dfs(dep, [storagePkgName]);
  }

  // Also check if any workspace package that depends on storage
  // is transitively depended upon by storage
  for (const [name, pkg] of Object.entries(pkgs)) {
    if (name === storagePkgName) continue;
    const deps = getDeps(pkg, productionOnly);
    if (deps.includes(storagePkgName)) {
      cycles.push(
        ...findReverseStorageCycles(
          name,
          pkgs,
          storagePkgName,
          storageDeps,
          productionOnly,
        ),
      );
    }
  }

  return { hasCycle: cycles.length > 0, cycles };
}

function main(): void {
  const args = parseArgs(process.argv);
  const packagesDir = resolve('packages');
  const productionOnly = args.production === true;
  const allDeps = args['all-dependencies'] === true;

  if (!productionOnly && !allDeps) {
    console.error('ERROR: Specify --production or --all-dependencies');
    process.exit(1);
  }

  const mode = productionOnly ? 'production' : 'all-dependencies';
  console.log(
    `Checking for dependency cycles involving ${STORAGE_PKG} (${mode} mode)...`,
  );

  let pkgs: Record<string, WorkspacePackageInfo>;
  try {
    pkgs = getWorkspacePackages(packagesDir);
  } catch (error) {
    console.error(`Fatal: ${messageOf(error)}`);
    return process.exit(1);
  }
  console.log(`Found ${Object.keys(pkgs).length} workspace packages.`);

  // Check storage leaf constraint
  if (pkgs[STORAGE_PKG]) {
    const storageDeps = getDeps(pkgs[STORAGE_PKG], true);
    const workspaceDeps = storageDeps.filter((d) =>
      d.startsWith(WORKSPACE_PREFIX),
    );
    if (workspaceDeps.length > 0) {
      console.log(
        `FAIL: ${STORAGE_PKG} depends on workspace packages: ${workspaceDeps.join(', ')}`,
      );
      console.log(
        'Storage must be a leaf package with no workspace dependencies.',
      );
      process.exit(1);
    } else {
      console.log(
        `OK: ${STORAGE_PKG} has no workspace dependencies (leaf package).`,
      );
    }
  }

  const { hasCycle, cycles } = detectCycles(pkgs, STORAGE_PKG, productionOnly);

  if (hasCycle) {
    console.log(`\nFAIL: Dependency cycles found involving ${STORAGE_PKG}:`);
    for (const cycle of cycles) {
      console.log(`  ${cycle.join(' → ')}`);
    }
    process.exit(1);
  } else {
    console.log(`\nPASS: No dependency cycles involving ${STORAGE_PKG}.`);
    process.exit(0);
  }
}

main();
