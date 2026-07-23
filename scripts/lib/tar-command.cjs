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
const { existsSync, statSync } = require('node:fs');
const { join } = require('node:path');

/**
 * Default timeout for tar operations (listing, extracting).
 */
const TAR_TIMEOUT_MS = 30_000;

/**
 * Shared maxBuffer for tar spawn captures. Large tar listings or verbose
 * output can exceed Node's default 200KB stdio buffer, causing
 * ERR_CHILD_PROCESS_STDIO_MAXBUFFER or silent truncation of error
 * diagnostics. 64MB aligns with the project-wide convention used by the
 * issue-2603 smoke harness (install-helpers.cjs SPAWN_MAX_BUFFER).
 */
const TAR_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Builds the spawn options object shared by all tar spawn helpers.
 *
 * @param {number} timeoutMs - spawn timeout (falls back to TAR_TIMEOUT_MS).
 * @param {string} [cwd] - optional working directory for the tar process.
 * @returns {object} the spawnSync options.
 */
function tarSpawnOptions(timeoutMs, cwd) {
  const opts = {
    encoding: 'utf8',
    // Use nullish coalescing so an explicit timeoutMs of 0 (meaning
    // "no timeout" in Node's spawnSync) is honored instead of falling
    // back to the default.
    timeout: timeoutMs ?? TAR_TIMEOUT_MS,
    maxBuffer: TAR_MAX_BUFFER,
    // Suppress transient console windows on Windows CI runners, consistent
    // with the project-wide convention used in
    // windows-installed-command-smoke/*.cjs.
    windowsHide: true,
  };
  if (cwd != null) {
    opts.cwd = cwd;
  }
  return opts;
}

/**
 * Throws a clear diagnostic when a required path argument is missing or empty.
 * Without this, Node's spawnSync coerces undefined to the string 'undefined',
 * producing confusing tar errors like "tar: undefined: Cannot open".
 *
 * @param {string} name - the parameter name for the error message.
 * @param {unknown} value - the value to validate.
 * @returns {string} the validated non-empty string.
 * @throws {Error} when value is not a non-empty string.
 */
function requireNonEmptyPath(name, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `tar spawn helper requires a non-empty ${name}, got: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Spawns tar to list the contents of a tarball (-tzf). Throws on spawn error,
 * signal termination, or non-zero exit with stderr context.
 *
 * @param {string} tarball - path to the .tgz file.
 * @param {number} [timeoutMs] - optional spawn timeout (default 30s).
 * @param {string} [cwd] - optional working directory for the tar process.
 * @returns {{ stdout: string, stderr: string }}
 * @throws {Error} on spawn failure, signal, or non-zero exit.
 */
function spawnTarList(tarball, timeoutMs, cwd) {
  requireNonEmptyPath('tarball', tarball);
  const result = spawnSync(
    'tar',
    ['-tzf', tarball],
    tarSpawnOptions(timeoutMs, cwd),
  );
  if (result.error) {
    throw new Error(
      `Failed to spawn tar (is tar on PATH?): ${result.error.message}`,
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
 * @param {string} [cwd] - optional working directory for the tar process.
 * @returns {{ stdout: string, stderr: string }}
 * @throws {Error} on spawn failure, signal, or non-zero exit.
 */
function spawnTarListVerbose(tarball, member, timeoutMs, cwd) {
  requireNonEmptyPath('tarball', tarball);
  requireNonEmptyPath('member', member);
  const result = spawnSync(
    'tar',
    ['-tzvf', tarball, member],
    tarSpawnOptions(timeoutMs, cwd),
  );
  if (result.error) {
    throw new Error(
      `Failed to spawn tar (is tar on PATH?): ${result.error.message}`,
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
 * @param {string} [cwd] - optional working directory for the tar process.
 * @returns {{ stdout: string, stderr: string }}
 * @throws {Error} on spawn failure, signal, or non-zero exit.
 */
function spawnTarExtract(tarball, extractDir, timeoutMs, cwd) {
  requireNonEmptyPath('tarball', tarball);
  requireNonEmptyPath('extractDir', extractDir);
  // Pre-validate extractDir is a directory so a missing or non-directory path
  // produces a clear diagnostic instead of a generic tar error. Use a single
  // statSync wrapped in try/catch to avoid the TOCTOU gap between existsSync
  // and statSync, and to catch permission-denied or removed-between-calls
  // errors with the module's diagnostic style rather than a raw stack trace.
  let stat;
  try {
    stat = statSync(extractDir);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw new Error(`tar extract destination does not exist: ${extractDir}`);
    }
    throw new Error(
      `tar extract destination is not accessible: ${extractDir} (${e.message})`,
    );
  }
  if (!stat.isDirectory()) {
    throw new Error(
      `tar extract destination is not a directory: ${extractDir}`,
    );
  }
  const result = spawnSync(
    'tar',
    ['-xzf', tarball, '-C', extractDir],
    tarSpawnOptions(timeoutMs, cwd),
  );
  if (result.error) {
    throw new Error(
      `Failed to spawn tar (is tar on PATH?): ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `tar extract failed (exit ${result.status}, signal=${result.signal ?? 'none'}): ${result.stderr || result.stdout}`,
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * Locate the .tgz filename in npm pack output. npm pack prints the tarball
 * filename (ending in .tgz) as the final non-empty line. Earlier warnings or
 * progress lines ending in .tgz are ignored by scanning from the end.
 *
 * @param {string} packOutput - raw npm pack stdout.
 * @param {string} [cacheDir] - optional dir to validate the tarball exists in.
 * @returns {string} the tarball filename.
 * @throws {Error} when no .tgz line is found, or when cacheDir is provided and
 *   the file does not exist.
 */
function findTarballName(packOutput, cacheDir) {
  const lines = packOutput.split(/\r?\n/);
  let tarName = '';
  // A valid npm pack tarball name has the shape <name>-<version>.tgz where
  // name is a non-empty npm package name and version is a non-empty semver-ish
  // string. Validate without a regex to avoid any backtracking risk: split on
  // the last dash before .tgz and check both halves are non-empty.
  function looksLikeTarballName(s) {
    if (!s.endsWith('.tgz')) {
      return false;
    }
    const base = s.slice(0, -4);
    const dashIdx = base.lastIndexOf('-');
    if (dashIdx <= 0) {
      return false;
    }
    return dashIdx < base.length - 1;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.endsWith('.tgz') && looksLikeTarballName(trimmed)) {
      tarName = trimmed;
      break;
    }
  }
  if (!tarName) {
    // Truncate to the last 10 lines so large npm pack outputs with many
    // warnings do not produce unwieldy error messages.
    const tail = lines.slice(-10).join('\n');
    throw new Error(
      `npm pack output did not contain a .tgz line (showing last 10 lines):\n${tail}`,
    );
  }
  if (cacheDir != null) {
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
  requireNonEmptyPath,
  TAR_TIMEOUT_MS,
};
