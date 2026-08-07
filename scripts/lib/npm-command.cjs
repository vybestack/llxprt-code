'use strict';

/**
 * Cross-platform npm/npx invocation resolver for Node spawn/spawnSync.
 *
 * On Windows, npm and npx are batch scripts (npm.cmd / npx.cmd). Node's
 * spawn/spawnSync without `shell: true` cannot reliably execute .cmd files —
 * it may fail with EINVAL or ENOENT depending on the Node version and Windows
 * build. Using `shell: true` would introduce shell-injection risk through
 * argv. Instead, on Windows we resolve npm's JavaScript CLI entry
 * (npm-cli.js) and spawn `process.execPath` (node.exe) with the CLI script as
 * the first argument, preserving argv boundaries without any shell.
 *
 * npm-cli.js is resolved from:
 *   1. process.env.npm_execpath — set by npm when running under it (e.g.
 *      during postinstall lifecycle scripts). Only used when it points to a
 *      real .js file that exists.
 *   2. <node-dir>/node_modules/npm/bin/npm-cli.js — the standard location in
 *      setup-node GitHub Actions runners and official Node installers. Only
 *      used when the file actually exists.
 *
 * If neither resolves to an existing .js file, resolveNpmCliJs throws an
 * actionable NpmCliNotFoundError instead of letting Node emit an opaque
 * MODULE_NOT_FOUND at spawn time.
 *
 * On POSIX, `npm` is a shebanged script that spawns directly, so we use it
 * as-is.
 *
 * All functions accept an optional options object (with platform/execPath/env,
 * and an injected existsSync for testing) so tests can validate command
 * selection without mutating global state or touching the filesystem.
 */

const path = require('node:path');
const fs = require('node:fs');

/**
 * Error thrown when npm-cli.js cannot be resolved on Windows. Includes the
 * attempted paths so callers get an actionable message rather than an opaque
 * Node MODULE_NOT_FOUND from a later spawn.
 */
class NpmCliNotFoundError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'NpmCliNotFoundError';
    this.code = 'LLXPRT_NPM_CLI_NOT_FOUND';
    this.details = details;
  }
}

/**
 * @typedef {{
 *   platform?: string;
 *   execPath?: string;
 *   env?: Record<string, string | undefined>;
 *   existsSync?: (p: string) => boolean;
 * }} InvocationOptions
 */

/**
 * @typedef {{ command: string; args: string[] }} Invocation
 */

function existsSyncOptional(options, p) {
  const fn = (options && options.existsSync) || fs.existsSync;
  return Boolean(fn(p));
}

/**
 * Resolves the path to npm's JavaScript CLI entry (npm-cli.js) on Windows.
 *
 * Resolution order:
 *   1. npm_execpath — only when it is a real .js path that exists.
 *   2. <node-dir>/node_modules/npm/bin/npm-cli.js — only when it exists.
 *   3. PATH — the first directory holding npm.cmd whose sibling
 *      node_modules/npm/bin/npm-cli.js exists. This is what finds npm when the
 *      running process is not node (e.g. Bun), where step 2 probes the wrong
 *      directory.
 *   4. NPM_CONFIG_PREFIX / APPDATA prefix candidates.
 *
 * Throws NpmCliNotFoundError when neither candidate exists, so the failure is
 * actionable instead of surfacing as an opaque Node MODULE_NOT_FOUND at spawn.
 *
 * @param {InvocationOptions} [options]
 * @returns {string}
 * @throws {NpmCliNotFoundError} when no existing npm-cli.js candidate is found.
 */
function resolveNpmCliJs(options) {
  const env = (options && options.env) || process.env;
  const probed = [];
  const cli =
    resolveFromNpmExecpath(env, options, probed) ||
    resolveFromNodeDir(options, probed) ||
    resolveFromPathNpmCmd(env, options, probed) ||
    resolveFromPrefixCandidates(env, options, probed);
  if (cli) {
    return cli;
  }
  throw createNpmCliNotFoundError(probed);
}

/**
 * Builds the NpmCliNotFoundError thrown when resolution fails, carrying the
 * probed paths so the caller gets an actionable message instead of an opaque
 * Node MODULE_NOT_FOUND at spawn time.
 *
 * @param {string[]} probed
 * @returns {NpmCliNotFoundError}
 */
function createNpmCliNotFoundError(probed) {
  return new NpmCliNotFoundError(
    `npm-cli.js could not be resolved on Windows (probed: ${probed.join(', ')}). ` +
      'Ensure npm is installed and accessible. This code checks the node.exe ' +
      'directory (setup-node / official installers), PATH (via npm.cmd, which ' +
      'is how npm is found when the current runtime is not node — e.g. Bun), ' +
      'NPM_CONFIG_PREFIX, and APPDATA locations (nvm-windows, Volta, global ' +
      'installs). If none apply, install Node via setup-node or an official ' +
      'installer that ships npm alongside node.exe, or verify that PATH / ' +
      'NPM_CONFIG_PREFIX / APPDATA point to a valid npm installation.',
    { probed },
  );
}

/**
 * Attempts to resolve npm-cli.js from npm_execpath.
 *
 * npm_execpath is set when running under npm and points to the CLI JS entry
 * (e.g. /path/to/node_modules/npm/bin/npm-cli.js). Only trust it when it is a
 * real .js file whose basename is npm-cli.js on an absolute path that exists —
 * pnpm and Yarn also set npm_execpath to their own CLI during lifecycle
 * scripts, so a generic .js+exists check could resolve the wrong package
 * manager. The basename is normalized across both separators so Windows-style
 * backslash paths are handled even when this code runs on POSIX.
 *
 * @param {Record<string, string | undefined>} env
 * @param {InvocationOptions} options
 * @param {string[]} probed
 * @returns {string | undefined}
 */
function resolveFromNpmExecpath(env, options, probed) {
  if (!env.npm_execpath || !env.npm_execpath.endsWith('.js')) {
    return undefined;
  }
  const normalizedBase = env.npm_execpath.replace(/\\/g, '/').split('/').pop();
  const isAbsolute =
    path.isAbsolute(env.npm_execpath) ||
    /^[A-Za-z]:[\\/]/.test(env.npm_execpath);
  if (
    normalizedBase === 'npm-cli.js' &&
    isAbsolute &&
    existsSyncOptional(options, env.npm_execpath)
  ) {
    return env.npm_execpath;
  }
  probed.push(env.npm_execpath);
  return undefined;
}

/**
 * Attempts to resolve npm-cli.js from the directory containing the Node (or
 * runtime) executable: <node-dir>/node_modules/npm/bin/npm-cli.js. This is the
 * standard layout for setup-node GitHub Actions runners and official Node
 * installers.
 *
 * @param {InvocationOptions} options
 * @param {string[]} probed
 * @returns {string | undefined}
 */
function resolveFromNodeDir(options, probed) {
  const nodeExe = (options && options.execPath) || process.execPath;
  const nodeDir = path.dirname(nodeExe);
  const fallback = path.join(
    nodeDir,
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js',
  );
  if (existsSyncOptional(options, fallback)) {
    return fallback;
  }
  probed.push(fallback);
  return undefined;
}

/**
 * Attempts to resolve npm-cli.js by locating npm.cmd on PATH.
 *
 * When this code runs under a non-Node runtime (e.g. Bun), process.execPath
 * is the runtime binary rather than node.exe, so the node-dir fallback probes
 * the wrong directory. The official Node Windows installer places npm.cmd
 * next to node.exe with its npm-cli.js at
 * <dir>/node_modules/npm/bin/npm-cli.js; locating npm.cmd on PATH (a pure
 * filesystem scan — no shell, no .cmd spawn) finds that layout regardless of
 * the invoking runtime.
 *
 * @param {Record<string, string | undefined>} env
 * @param {InvocationOptions} options
 * @param {string[]} probed
 * @returns {string | undefined}
 */
function resolveFromPathNpmCmd(env, options, probed) {
  const pathVar = env.PATH || env.Path || env.path;
  if (typeof pathVar !== 'string' || pathVar.length === 0) {
    return undefined;
  }
  const dirs = pathVar.split(path.delimiter).filter((dir) => dir.length > 0);
  for (const dir of dirs) {
    const npmCmd = path.join(dir, 'npm.cmd');
    if (!existsSyncOptional(options, npmCmd)) {
      continue;
    }
    const pathCli = path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (existsSyncOptional(options, pathCli)) {
      return pathCli;
    }
    probed.push(pathCli);
  }
  return undefined;
}

/**
 * Collects well-known npm-cli.js prefix candidates (NPM_CONFIG_PREFIX and
 * APPDATA / nvm-windows / global roaming install locations). NPM_CONFIG_PREFIX
 * is validated as an absolute path so a relative value does not silently
 * resolve against process.cwd(); both POSIX (/) and Windows (drive-letter:\)
 * forms are accepted so cross-platform unit tests that simulate Windows paths
 * on a POSIX host work correctly.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function collectPrefixCandidates(env) {
  const candidates = [];
  if (
    env.NPM_CONFIG_PREFIX &&
    (path.isAbsolute(env.NPM_CONFIG_PREFIX) ||
      /^[A-Za-z]:[\\/]/.test(env.NPM_CONFIG_PREFIX))
  ) {
    candidates.push(
      path.join(
        env.NPM_CONFIG_PREFIX,
        'node_modules',
        'npm',
        'bin',
        'npm-cli.js',
      ),
    );
  }
  if (env.APPDATA) {
    candidates.push(
      path.join(env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    );
  }
  return candidates;
}

/**
 * Attempts to resolve npm-cli.js from npm prefix locations for nvm-windows,
 * Volta, and global npm installs where npm is NOT alongside node.exe. These
 * are derived from well-known environment variables without spawning a shell
 * or npm.cmd.
 *
 * @param {Record<string, string | undefined>} env
 * @param {InvocationOptions} options
 * @param {string[]} probed
 * @returns {string | undefined}
 */
function resolveFromPrefixCandidates(env, options, probed) {
  const candidates = collectPrefixCandidates(env);
  for (const candidate of candidates) {
    if (existsSyncOptional(options, candidate)) {
      return candidate;
    }
    probed.push(candidate);
  }
  return undefined;
}

/**
 * Returns the npm invocation (command + args) for spawn/spawnSync.
 *
 * On Windows, spawns `node.exe <npm-cli.js> [args...]` so no .cmd file or
 * shell is involved. On POSIX, spawns `npm [args...]` directly.
 *
 * @param {readonly string[]} [args] - npm arguments (e.g. ['pack', '-w']).
 * @param {InvocationOptions} [options]
 * @returns {Invocation}
 * @throws {NpmCliNotFoundError} on Windows when npm-cli.js cannot be resolved
 *   (propagated from resolveNpmCliJs).
 */
function npmInvocation(args, options) {
  const platform = (options && options.platform) || process.platform;
  const cliArgs = args ? Array.from(args) : [];
  if (platform === 'win32') {
    const nodeExe = (options && options.execPath) || process.execPath;
    const npmCliPath = resolveNpmCliJs(options);
    return { command: nodeExe, args: [npmCliPath, ...cliArgs] };
  }
  return { command: 'npm', args: cliArgs };
}

/**
 * Returns the npx-equivalent invocation via `npm exec`.
 *
 * npx is a batch script on Windows (npx.cmd) with the same spawn limitation
 * as npm.cmd. Instead of spawning npx.cmd, we route through `npm exec`, which
 * the npm CLI supports on all platforms. The caller is responsible for adding
 * a `--` separator before the command if needed.
 *
 * @param {readonly string[]} [args] - arguments after `npm exec`.
 * @param {InvocationOptions} [options]
 * @returns {Invocation}
 * @throws {NpmCliNotFoundError} on Windows when npm-cli.js cannot be resolved
 *   (propagated from resolveNpmCliJs via npmInvocation).
 */
function npxInvocation(args, options) {
  const cliArgs = args ? Array.from(args) : [];
  return npmInvocation(['exec', ...cliArgs], options);
}

module.exports = {
  npmInvocation,
  npxInvocation,
  resolveNpmCliJs,
  NpmCliNotFoundError,
};
