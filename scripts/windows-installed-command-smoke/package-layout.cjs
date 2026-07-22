'use strict';

/**
 * Package-layout discovery helpers: find the installed package root under a
 * global prefix, locate the bundled bun.exe, and build a TEMP probe fixture.
 */

const {
  existsSync,
  rmSync,
  cpSync,
  realpathSync,
  statSync,
} = require('node:fs');
const { join, normalize } = require('node:path');

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
          { cause: e },
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
  // Normalize src/dest so trailing slashes and . / .. segments do not
  // affect the copy or the filter logic.
  const srcNorm = normalize(src);
  const destNorm = normalize(dest);
  // Validate src is an existing DIRECTORY before copying. A missing source
  // or a non-directory source (e.g. a regular file) produces a clear error
  // rather than a partial-copy or wrong-type failure from cpSync.
  let srcStat;
  try {
    srcStat = statSync(srcNorm);
  } catch (e) {
    throw new Error(
      `copyTree: source does not exist or is inaccessible: ${src}: ${e.message}`,
      { cause: e },
    );
  }
  if (!srcStat.isDirectory()) {
    throw new Error(`copyTree: source is not a directory: ${src}`);
  }
  // Track whether dest pre-existed so we only remove it on failure if WE
  // created it. This avoids clobbering pre-existing dest data on a copy error.
  const destPreExisted = existsSync(destNorm);
  try {
    cpSync(srcNorm, destNorm, {
      recursive: true,
      // Exclude only the exact node_modules/.bin directory. Substring matching
      // would also exclude node_modules/.binaries or node_modules/.bin-test.
      // Normalize separators and the path itself (handles . and .. segments),
      // then split on / and check that the final two segments are
      // node_modules and .bin.
      filter: (s) => {
        const normalized = normalize(s.replace(/\\/g, '/'));
        const segments = normalized.split('/');
        if (segments.length >= 2) {
          const segCount = segments.length;
          if (
            segments[segCount - 1] === '.bin' &&
            segments[segCount - 2] === 'node_modules'
          ) {
            return false;
          }
        }
        return true;
      },
    });
  } catch (e) {
    // Clean up a partial copy we created, but do NOT remove pre-existing dest
    // data that we did not create.
    if (!destPreExisted) {
      try {
        rmSync(destNorm, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
    throw new Error(
      `copyTree: failed to copy ${src} -> ${dest}: ${e.message}`,
      { cause: e },
    );
  }
}

module.exports = {
  findInstalledPackageRoot,
  findBundledBun,
  samePath,
  copyTree,
};
