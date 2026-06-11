#!/usr/bin/env node

/**
 * check-storage-package-cycle.mjs
 *
 * Validates that no dependency cycle includes @vybestack/llxprt-code-storage.
 * Reads package.json manifests for all workspace packages and checks
 * dependency graphs.
 *
 * Usage:
 *   node scripts/check-storage-package-cycle.mjs --production
 *   node scripts/check-storage-package-cycle.mjs --all-dependencies
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const STORAGE_PKG = '@vybestack/llxprt-code-storage';
const WORKSPACE_PREFIX = '@vybestack/llxprt-code-';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val =
        argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

function getWorkspacePackages(packagesDir) {
  const pkgs = {};
  let entries;
  try {
    entries = readdirSync(packagesDir, { withFileTypes: true });
  } catch {
    return pkgs;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = join(packagesDir, entry.name, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      if (pkg.name) {
        pkgs[pkg.name] = {
          name: pkg.name,
          dir: join(packagesDir, entry.name),
          dependencies: pkg.dependencies || {},
          devDependencies: pkg.devDependencies || {},
          optionalDependencies: pkg.optionalDependencies || {},
        };
      }
    } catch {
      /* skip invalid json */
    }
  }
  return pkgs;
}

function getDeps(pkg, productionOnly) {
  const deps = { ...pkg.dependencies, ...pkg.optionalDependencies };
  if (!productionOnly) {
    Object.assign(deps, pkg.devDependencies);
  }
  return Object.keys(deps);
}

function detectCycles(pkgs, storagePkgName, productionOnly) {
  // Check if storage package exists
  if (!pkgs[storagePkgName]) {
    console.log(
      `Package ${storagePkgName} not found — no cycle possible. PASS.`,
    );
    return { hasCycle: false, cycles: [] };
  }

  // BFS from storage to find cycles
  // Check: does any dependency of storage transitively depend on storage?
  const visited = new Set();
  const cycles = [];

  function dfs(pkgName, path) {
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
      // Check if storage transitively depends on this package, tracking the
      // full path so the reported cycle shows the real dependency chain.
      const visited2 = new Set();
      function dfs2(pName, trail) {
        if (pName === name) {
          // trail already begins with storagePkgName and ends with `name`.
          cycles.push([...trail, storagePkgName]);
          return;
        }
        if (visited2.has(pName)) return;
        if (!pName.startsWith(WORKSPACE_PREFIX)) return;
        visited2.add(pName);
        const p = pkgs[pName];
        if (!p) return;
        for (const d of getDeps(p, productionOnly)) {
          dfs2(d, [...trail, d]);
        }
      }
      for (const d of storageDeps) {
        visited2.clear();
        dfs2(d, [storagePkgName, d]);
      }
    }
  }

  return { hasCycle: cycles.length > 0, cycles };
}

function main() {
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

  const pkgs = getWorkspacePackages(packagesDir);
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
