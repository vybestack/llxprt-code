'use strict';

/**
 * Package-layout discovery helpers: find the installed package root under a
 * global prefix, locate the bundled bun.exe, and build a TEMP probe fixture.
 */

const { existsSync, rmSync, cpSync, realpathSync } = require('node:fs');
const { join } = require('node:path');

function findInstalledPackageRoot(prefix) {
  const candidates = [
    join(prefix, 'node_modules', '@vybestack', 'llxprt-code'),
    join(prefix, 'Lib', 'node_modules', '@vybestack', 'llxprt-code'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'package.json'))) return c;
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

/**
 * Compares two filesystem paths for equality after canonicalization.
 *
 * Canonicalization uses realpathSync.native to resolve 8.3 short paths,
 * symlinks, and junctions to their canonical long form. If the path does not
 * exist (realpath throws ENOENT), the original path is preserved so that
 * missing-path comparisons remain useful for diagnostics. Other realpath
 * errors (EACCES, ELOOP, EIO, ENOTDIR) are propagated as unexpected
 * filesystem conditions rather than silently masked.
 *
 * After realpath, backslashes are normalized to forward slashes, trailing
 * slashes are stripped, and the comparison is case-insensitive (Windows
 * filesystem semantics).
 *
 * @param {string} a - first path.
 * @param {string} b - second path.
 * @param {{ realpathSync?: (p: string) => string }} [options] - injection
 *   seam for deterministic testing. When omitted, the native realpathSync is
 *   used, which requires paths to exist on the host filesystem.
 * @returns {boolean} true if both paths canonicalize to the same value.
 */
function samePath(a, b, options) {
  const realpath =
    options && typeof options.realpathSync === 'function'
      ? options.realpathSync
      : realpathSync.native;
  const norm = (p) => {
    let resolved = String(p);
    try {
      resolved = realpath(resolved);
    } catch (e) {
      const code = e && typeof e.code === 'string' ? e.code : '';
      // ENOENT (path does not exist) is the expected, benign case for
      // missing-path comparisons: preserve the original path. Other errors
      // (EACCES, ELOOP, EIO, ENOTDIR) indicate an unexpected filesystem
      // condition that should not be silently masked.
      if (code !== 'ENOENT') {
        throw new Error(
          `samePath: realpath failed for ${JSON.stringify(p)}: ${e.message}`,
        );
      }
    }
    let s = resolved.replace(/\\/g, '/');
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
  // Track whether dest pre-existed so we only remove it on failure if WE
  // created it. This avoids clobbering pre-existing dest data on a copy error.
  const destPreExisted = existsSync(dest);
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
    // Clean up a partial copy we created, but do NOT remove pre-existing dest
    // data that we did not create.
    if (!destPreExisted) {
      try {
        rmSync(dest, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
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
