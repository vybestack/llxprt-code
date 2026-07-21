'use strict';

/**
 * Package-layout discovery helpers: find the installed package root under a
 * global prefix, locate the bundled bun.exe, and build a TEMP probe fixture.
 */

const { existsSync, rmSync, cpSync } = require('node:fs');
const { join } = require('node:path');

function findInstalledPackageRoot(prefix) {
  const candidates = [
    join(prefix, 'node_modules', '@vybestack', 'llxprt-code'),
    join(prefix, 'Lib', 'node_modules', '@vybestack', 'llxprt-code'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'package.json'))) return c;
  }
  const globRoot = join(prefix, 'node_modules');
  if (existsSync(globRoot)) {
    const scoped = join(globRoot, '@vybestack');
    if (existsSync(scoped)) {
      const direct = join(scoped, 'llxprt-code');
      if (existsSync(join(direct, 'package.json'))) return direct;
    }
  }
  throw new Error(`could not find installed package root under ${prefix}`);
}

function findBundledBun(packageRoot) {
  const candidates = [
    join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
    join(packageRoot, 'node_modules', '.bin', 'bun.exe'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`bundled bun.exe not found under ${packageRoot}`);
}

function samePath(a, b) {
  const norm = (p) => {
    let s = String(p).replace(/\\/g, '/');
    while (s.endsWith('/')) {
      s = s.slice(0, -1);
    }
    return s.toLowerCase();
  };
  return norm(a) === norm(b);
}

function copyTree(src, dest) {
  // Validate src exists before copying so a missing source produces a clear
  // error rather than a partial-copy failure from cpSync.
  if (!existsSync(src)) {
    throw new Error(`copyTree: source does not exist: ${src}`);
  }
  try {
    cpSync(src, dest, {
      recursive: true,
      // Separator-neutral .bin exclusion: cpSync may pass paths with either
      // forward or backslash separators on Windows, so normalize before
      // checking.
      filter: (s) => {
        const normalized = s.replace(/\\/g, '/');
        return !normalized.includes('node_modules/.bin');
      },
    });
  } catch (e) {
    // Clean up any partial copy so a failed run does not leave a corrupt dest.
    try {
      rmSync(dest, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    throw new Error(`copyTree: failed to copy ${src} -> ${dest}: ${e.message}`);
  }
}

module.exports = {
  findInstalledPackageRoot,
  findBundledBun,
  samePath,
  copyTree,
};
