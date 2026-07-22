'use strict';

/**
 * Shared tar spawn helpers for issue #2603 test scripts.
 *
 * Multiple test files (issue-2603-install.test.ts, issue-2603-release-pack.cjs,
 * issue-2603-release-install-smoke.cjs) duplicate near-identical tar spawn
 * logic with spawn-error diagnostics. This module centralizes that logic so a
 * fix or diagnostic improvement applies everywhere.
 *
 * GitHub Windows runners ship bsdtar, but a spawn failure (ENOENT) must
 * produce a clear diagnostic rather than an opaque null status.
 */

const { spawnSync } = require('node:child_process');

/**
 * Default timeout for tar operations (listing, extracting).
 */
const TAR_TIMEOUT_MS = 30_000;

/**
 * Spawns tar to list the contents of a tarball (-tzf). Throws on spawn error,
 * signal termination, or non-zero exit with stderr context.
 *
 * @param {string} tarball - path to the .tgz file.
 * @param {number} [timeoutMs] - optional spawn timeout (default 30s).
 * @returns {{ stdout: string, stderr: string }}
 * @throws {Error} on spawn failure, signal, or non-zero exit.
 */
function spawnTarList(tarball, timeoutMs) {
  const result = spawnSync('tar', ['-tzf', tarball], {
    encoding: 'utf8',
    timeout: timeoutMs || TAR_TIMEOUT_MS,
  });
  if (result.error) {
    throw new Error(
      `Failed to spawn tar (is it on PATH? GitHub Windows has bsdtar): ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `tar list failed (exit ${result.status}, signal=${result.signal ?? 'none'}): ${result.stderr || result.stdout}`,
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * Spawns tar to list verbose info for a specific member (-tzvf). Throws on
 * spawn error, signal termination, or non-zero exit with stderr context.
 *
 * @param {string} tarball - path to the .tgz file.
 * @param {string} member - the tar member path to inspect.
 * @param {number} [timeoutMs] - optional spawn timeout (default 30s).
 * @returns {{ stdout: string, stderr: string }}
 * @throws {Error} on spawn failure, signal, or non-zero exit.
 */
function spawnTarListVerbose(tarball, member, timeoutMs) {
  const result = spawnSync('tar', ['-tzvf', tarball, member], {
    encoding: 'utf8',
    timeout: timeoutMs || TAR_TIMEOUT_MS,
  });
  if (result.error) {
    throw new Error(
      `Failed to spawn tar (is it on PATH? GitHub Windows has bsdtar): ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `tar list-verbose failed (exit ${result.status}, signal=${result.signal ?? 'none'}): ${result.stderr || result.stdout}`,
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * Spawns tar to extract a tarball (-xzf). Throws on spawn error, signal
 * termination, or non-zero exit with stderr context.
 *
 * @param {string} tarball - path to the .tgz file.
 * @param {string} extractDir - directory to extract into.
 * @param {number} [timeoutMs] - optional spawn timeout (default 30s).
 * @returns {{ stdout: string, stderr: string }}
 * @throws {Error} on spawn failure, signal, or non-zero exit.
 */
function spawnTarExtract(tarball, extractDir, timeoutMs) {
  const result = spawnSync('tar', ['-xzf', tarball, '-C', extractDir], {
    encoding: 'utf8',
    timeout: timeoutMs || TAR_TIMEOUT_MS,
  });
  if (result.error) {
    throw new Error(
      `Failed to spawn tar (is it on PATH? GitHub Windows has bsdtar): ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `tar extract failed (exit ${result.status}, signal=${result.signal ?? 'none'}): ${result.stderr}`,
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * Locate the .tgz filename in npm pack output. npm pack prints the tarball
 * filename (ending in .tgz) on its own line, but the output may include
 * warnings/progress lines. Find the .tgz line and optionally validate the
 * file exists.
 *
 * @param {string} packOutput - raw npm pack stdout.
 * @param {string} [cacheDir] - optional dir to validate the tarball exists in.
 * @returns {string} the tarball filename.
 * @throws {Error} when no .tgz line is found, or when cacheDir is provided and
 *   the file does not exist.
 */
function findTarballName(packOutput, cacheDir) {
  const lines = packOutput.split(/\r?\n/);
  const tgzLines = lines.filter((l) => l.trim().endsWith('.tgz'));
  if (tgzLines.length === 0) {
    throw new Error(
      `npm pack output did not contain a .tgz line:\n${packOutput}`,
    );
  }
  const tarName = tgzLines[tgzLines.length - 1].trim();
  if (cacheDir) {
    const { existsSync } = require('node:fs');
    const { join } = require('node:path');
    const tarPath = join(cacheDir, tarName);
    if (!existsSync(tarPath)) {
      throw new Error(
        `npm pack reported tarball ${tarName} but it does not exist at ${tarPath}`,
      );
    }
  }
  return tarName;
}

module.exports = {
  spawnTarList,
  spawnTarListVerbose,
  spawnTarExtract,
  findTarballName,
  TAR_TIMEOUT_MS,
};
