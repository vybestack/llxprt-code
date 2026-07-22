#!/usr/bin/env node

/* eslint-env node */
'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const PACKAGE_NAME = '@vybestack/llxprt-code';
const BIN_NAME = 'llxprt';
const OWNERSHIP_SENTINEL =
  'LLXPRT_NATIVE_LAUNCHER owned by @vybestack/llxprt-code';
const LAUNCHER_ERROR_EXIT_CODE = 43;

// Reads a file, returning '' for ENOENT (missing) only. Other errors
// (EACCES, EISDIR, EIO) propagate so a protected or unreadable foreign shim
// is NOT silently treated as an empty/zero-byte file. This prevents
// canOverwriteLauncher from clobbering a protected shim whose ACLs prevent
// reading.
function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return '';
    }
    throw e;
  }
}

// Returns true when filePath is a regular FILE (not a directory, device, or
// other special type). Use this instead of bare existsSync so a directory
// named bun.exe or index.ts (from a corrupt install) is not treated as the
// expected file.
function isRegularFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function hasOwnershipSentinel(filePath) {
  if (!isRegularFile(filePath)) {
    return false;
  }
  return readFileSafe(filePath).includes(OWNERSHIP_SENTINEL);
}

function isWithinPackageRoot(resolvedPath, packageRoot) {
  const rel = path.relative(packageRoot, resolvedPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// npm cmd-shim wraps a shebanged target with an interpreter. For a
// #!/bin/sh target, the .cmd file references both "/bin/sh.exe" (the
// interpreter) and the real package target ("%dp0%\..\path\to\bin\llxprt").
// Only the package target must authorize overwriting; the interpreter
// reference must be ignored. Return every "%dp0%\<rel>" candidate so the
// caller can test each against the package boundary.
// cmd-shim uses backslashes on Windows, but accept forward slashes too for
// robustness against alternate shim generators.
function extractCmdShimTargets(content) {
  const targets = [];
  const seen = new Set();
  const re = /"%dp0%[/\\]([^"]+)"/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      targets.push(m[1]);
    }
  }
  return targets;
}

// npm cmd-shim ps1 files reference the interpreter ("$basedir//bin/sh$exe")
// and the real package target ("$basedir/../path/to/bin/llxprt"). npm
// cmd-shim emits forward slashes on all platforms, but some environments or
// future versions may emit backslashes on Windows. Accept both separators
// so the ownership check is robust. Return every "$basedir/<rel>" candidate
// so the caller can test each against the package boundary.
function extractPs1ShimTargets(content) {
  const targets = [];
  const seen = new Set();
  const re = /"\$basedir[/\\]([^"]+)"/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      targets.push(m[1]);
    }
  }
  return targets;
}

// Resolve a shim-relative reference using Windows path semantics, even when the
// postinstall unit test runs on POSIX. A reference like "..\prefix\lib\...\llxprt"
// must not be split on "/" (POSIX) when it represents a Windows wrapper path.
function resolveShimCandidate(binLinkDir, relativeTarget) {
  const normalized = relativeTarget.replace(/\//g, '\\');
  return path.win32.resolve(binLinkDir, normalized);
}

// Boundary check using Windows path semantics so backslash-separated resolved
// paths match packageRoot consistently.
function isWithinPackageRootWin(resolvedPath, packageRoot) {
  const rel = path.win32.relative(packageRoot, resolvedPath);
  return rel === '' || (!rel.startsWith('..') && !path.win32.isAbsolute(rel));
}

// Shared core: extract shim target candidates from content and return true if
// ANY candidate resolves within the exact packageRoot boundary. The interpreter
// reference (e.g. /bin/sh) resolves outside the package and is correctly
// ignored; the package target resolves inside and authorizes. Uses path.win32
// for both resolution and boundary check so Windows wrapper semantics
// (backslash separators) are applied consistently even when the postinstall
// unit test runs on POSIX.
function shimTargetWithinPackage(content, binLinkDir, packageRoot, shimType) {
  const candidates =
    shimType === 'ps1'
      ? extractPs1ShimTargets(content)
      : extractCmdShimTargets(content);
  if (candidates.length === 0) {
    return false;
  }
  for (const candidate of candidates) {
    const resolved = resolveShimCandidate(binLinkDir, candidate);
    if (isWithinPackageRootWin(resolved, packageRoot)) {
      return true;
    }
  }
  return false;
}

function pointsToOurPackage(filePath, binLinkDir, packageRoot, shimType) {
  const content = readFileSafe(filePath);
  // An empty file does NOT point to our package (it has no content). This is
  // intentionally different from canOverwriteLauncher, which returns true for
  // empty files to repair truncated launchers. The two functions answer
  // different questions: pointsToOurPackage asks "does this file reference
  // our package?" while canOverwriteLauncher asks "is it safe to replace?".
  if (!content) {
    return false;
  }
  return shimTargetWithinPackage(content, binLinkDir, packageRoot, shimType);
}

function canOverwriteLauncher(filePath, binLinkDir, packageRoot, shimType) {
  if (!isRegularFile(filePath)) {
    // If the path does not exist, overwrite is safe. If it is a directory
    // or special file, refuse to overwrite (a directory named llxprt.cmd
    // from a corrupt install should not be silently clobbered).
    return !fs.existsSync(filePath);
  }
  // Read the file once and reuse the content for both the ownership sentinel
  // check and the shim-target boundary check, avoiding a duplicate read.
  // A foreign shim that exists but is unreadable (EACCES, EISDIR, EIO) must
  // be treated as non-overwritable rather than crashing postinstall. The
  // presence of an unreadable file at the launcher path signals a protected
  // or unexpected state that should not be silently clobbered.
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      // Removed between isRegularFile and readFileSync: treat as missing.
      return true;
    }
    // EACCES, EISDIR, EIO, etc: do NOT overwrite an unreadable foreign shim.
    return false;
  }
  if (content.includes(OWNERSHIP_SENTINEL)) {
    return true;
  }
  // A zero-byte file cannot be a valid foreign shim (it has no interpreter
  // reference, no sentinel, and no target). Allowing overwrite here repairs
  // a truncated launcher left by a failed install without risking a foreign
  // shim.
  if (content.length === 0) {
    return true;
  }
  return shimTargetWithinPackage(content, binLinkDir, packageRoot, shimType);
}

function relativePath(fromDir, toPath) {
  return path.relative(fromDir, toPath).split(path.sep).join('\\');
}

function relativePathPosix(fromDir, toPath) {
  return path.relative(fromDir, toPath).split(path.sep).join('/');
}

function escapeForCmdQuote(value) {
  // Double internal double quotes (cmd's quoting rule) and double percent
  // signs so a literal % survives cmd.exe's batch parser. Inside a batch file,
  // %VAR% expands environment variables and %% is a literal %. The generated
  // launcher forwards args via %*, not %1..%9, so positional expansion does not
  // apply; doubling % ensures a literal percent is preserved verbatim.
  return value.replace(/"/g, '""').replace(/%/g, '%%');
}

// cmd cannot distinguish a CreateProcess launch failure (corrupt binary,
// access denied, not found) from a legitimate nonzero application exit after
// the process has returned: both surface as %ERRORLEVEL%. Remapping specific
// errorlevels (5, 193, 9009) would corrupt legitimate CLI exit codes that
// happen to collide with those values. Therefore the cmd launcher only
// preflights file existence (giving exit 43 for a missing bun/entry) and then
// preserves the child's exit code EXACTLY. The PowerShell launcher (ps1)
// uses try/catch to detect native launch exceptions for the diagnostic path.
function generateCmdLauncher(bunRelative, entryRelative) {
  const bunQuoted = escapeForCmdQuote(bunRelative);
  const entryQuoted = escapeForCmdQuote(entryRelative);
  return [
    '@echo off',
    `REM ${OWNERSHIP_SENTINEL}`,
    'setlocal enableextensions',
    `if not exist "%~dp0${bunQuoted}" goto :LLXPRT_NO_BUN`,
    `if not exist "%~dp0${entryQuoted}" goto :LLXPRT_NO_ENTRY`,
    `"%~dp0${bunQuoted}" "%~dp0${entryQuoted}" %*`,
    'exit /b %ERRORLEVEL%',
    '',
    ':LLXPRT_NO_BUN',
    'echo LLxprt Code: bundled Bun runtime was not found. 1>&2',
    'echo Reinstall the package with "npm install @vybestack/llxprt-code" 1>&2',
    'echo to restore the bundled Bun dependency, or visit https://bun.sh 1>&2',
    'exit /b ' + LAUNCHER_ERROR_EXIT_CODE,
    '',
    ':LLXPRT_NO_ENTRY',
    'echo LLxprt Code: TypeScript entry point ^(index.ts^) was not found. 1>&2',
    'echo Your installation may be corrupt; reinstall @vybestack/llxprt-code. 1>&2',
    'exit /b ' + LAUNCHER_ERROR_EXIT_CODE,
    '',
  ].join('\r\n');
}

function generatePs1Launcher(bunRelativePosix, entryRelativePosix) {
  const bunPs = bunRelativePosix.replace(/'/g, "''");
  const entryPs = entryRelativePosix.replace(/'/g, "''");
  return [
    '#!/usr/bin/env pwsh',
    `# ${OWNERSHIP_SENTINEL}`,
    '$basedir = Split-Path $MyInvocation.MyCommand.Definition -Parent',
    `$bunExe = Join-Path $basedir '${bunPs}'`,
    `$entry = Join-Path $basedir '${entryPs}'`,
    'if (-not (Test-Path $bunExe)) {',
    "  [Console]::Error.WriteLine('LLxprt Code: bundled Bun runtime was not found.')",
    '  [Console]::Error.WriteLine(\'Reinstall the package with "npm install @vybestack/llxprt-code"\')',
    "  [Console]::Error.WriteLine('to restore the bundled Bun dependency, or visit https://bun.sh')",
    '  exit ' + LAUNCHER_ERROR_EXIT_CODE,
    '}',
    'if (-not (Test-Path $entry)) {',
    "  [Console]::Error.WriteLine('LLxprt Code: TypeScript entry point (index.ts) was not found.')",
    "  [Console]::Error.WriteLine('Your installation may be corrupt; reinstall @vybestack/llxprt-code.')",
    '  exit ' + LAUNCHER_ERROR_EXIT_CODE,
    '}',
    '$allArgs = @($entry) + $args',
    // Wrap the native invocation so a launch failure (corrupt/missing binary,
    // access denied) is distinguished from a legitimate CLI nonzero exit.
    // PowerShell throws when the OS cannot start the process; we catch that
    // and exit 43 with the diagnostic. A normal nonzero exit from the CLI is
    // propagated unchanged via $LASTEXITCODE.
    'try {',
    '  if ($MyInvocation.ExpectingInput) {',
    '    $input | & $bunExe @allArgs',
    '  } else {',
    '    & $bunExe @allArgs',
    '  }',
    '} catch {',
    "  [Console]::Error.WriteLine('LLxprt Code: bundled Bun runtime could not be launched.')",
    "  [Console]::Error.WriteLine('The bundled bun.exe may be missing, corrupt, or inaccessible.')",
    '  [Console]::Error.WriteLine(\'Reinstall the package with "npm install @vybestack/llxprt-code"\')',
    "  [Console]::Error.WriteLine('or install Bun directly from https://bun.sh')",
    '  exit ' + LAUNCHER_ERROR_EXIT_CODE,
    '}',
    'exit $LASTEXITCODE',
    '',
  ].join('\r\n');
}

function writeOwnedLauncher(
  filePath,
  content,
  binLinkDir,
  packageRoot,
  shimType,
  log,
) {
  if (!canOverwriteLauncher(filePath, binLinkDir, packageRoot, shimType)) {
    return false;
  }
  // Re-validate the ownership sentinel immediately before the write to close
  // the TOCTOU window between canOverwriteLauncher and writeFileSync. If a
  // concurrent process replaced the file with a foreign shim after the initial
  // check, the sentinel re-check catches it and refuses the overwrite.
  if (fs.existsSync(filePath) && isRegularFile(filePath)) {
    let currentContent;
    try {
      currentContent = fs.readFileSync(filePath, 'utf8');
    } catch {
      // Unreadable file (EACCES/EIO): refuse to overwrite.
      return false;
    }
    if (
      currentContent.length > 0 &&
      !currentContent.includes(OWNERSHIP_SENTINEL)
    ) {
      // The file changed between the first check and now and is not our
      // sentinel or empty. It may now be a foreign shim; refuse to clobber.
      if (
        !shimTargetWithinPackage(
          currentContent,
          binLinkDir,
          packageRoot,
          shimType,
        )
      ) {
        return false;
      }
    }
  }
  // Wrap the write so a read-only directory, full disk, or other I/O error is
  // reported as skipped/nonfatal rather than crashing postinstall and leaving
  // the package in a partially installed state.
  try {
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (e) {
    if (log) {
      log(
        `[postinstall] Could not write launcher ${filePath} (non-fatal): ` +
          `${e.message}`,
      );
    }
    return false;
  }
  try {
    fs.chmodSync(filePath, 0o755);
  } catch (e) {
    // chmod is best-effort, especially on Windows where the launcher's
    // executability is governed by the file extension, not the mode bit.
    if (log) {
      log(
        `[postinstall] Could not chmod launcher ${filePath} ` +
          `(best-effort on Windows): ${e.message}`,
      );
    }
  }
  return true;
}

function resolveBunExe(packageRoot) {
  // Prefer the package-local Bun first. Since bun is a direct dependency in
  // packages/cli/package.json, the local node_modules/bun is the authoritative
  // install and should not be bypassed in favor of a hoisted copy that could
  // disappear when the hoisted dependency is removed.
  const localBunExe = path.join(
    packageRoot,
    'node_modules',
    'bun',
    'bin',
    'bun.exe',
  );
  if (isRegularFile(localBunExe)) {
    return localBunExe;
  }
  // Fall back to Node module resolution, which may find a hoisted Bun under a
  // package manager that deduplicates to the enclosing node_modules.
  const pkgRequire = createRequire(path.join(packageRoot, 'package.json'));
  let bunPkgJsonPath;
  try {
    bunPkgJsonPath = pkgRequire.resolve('bun/package.json');
  } catch {
    // Last resort: walk up parent directories. This covers edge-case layouts
    // where neither the local install nor Node resolution find the binary.
    let dir = packageRoot;
    while (dir !== path.dirname(dir)) {
      const candidate = path.join(dir, 'node_modules', 'bun', 'bin', 'bun.exe');
      if (isRegularFile(candidate)) {
        return candidate;
      }
      dir = path.dirname(dir);
    }
    return null;
  }
  const bunDir = path.dirname(bunPkgJsonPath);
  const bunExe = path.join(bunDir, 'bin', 'bun.exe');
  if (isRegularFile(bunExe)) {
    return bunExe;
  }
  return null;
}

function resolveEntry(packageRoot) {
  const entry = path.join(packageRoot, 'index.ts');
  if (isRegularFile(entry)) {
    return entry;
  }
  return null;
}

// Walk up from packageRoot to find the nearest enclosing "node_modules"
// directory and return its ".bin" sibling. For .../node_modules/pkg, the bin
// dir is .../node_modules/.bin. For .../node_modules/@scope/pkg, the bin dir
// is still .../node_modules/.bin (the scope is one level under node_modules).
// Returns null if no enclosing node_modules is found.
function nearestNodeModulesBin(packageRoot) {
  let dir = packageRoot;
  let parent = path.dirname(dir);
  while (dir !== parent) {
    if (path.basename(parent) === 'node_modules') {
      const candidate = path.join(parent, '.bin');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      // Found the node_modules dir but .bin does not exist yet; return the
      // canonical path anyway so the caller can decide (npm creates .bin
      // before running lifecycle scripts, but pnpm/Yarn may differ).
      return candidate;
    }
    dir = parent;
    parent = path.dirname(dir);
  }
  return null;
}

function findBinLinkDirs(packageRoot, env) {
  const dirs = [];
  const seen = new Set();
  function add(candidate) {
    if (candidate && fs.existsSync(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      dirs.push(candidate);
    }
  }

  // npm_config_global can be 'true', 'false', or undefined. Only 'true'
  // indicates a global install where shims go in the prefix root.
  const isGlobal = env.npm_config_global === 'true';

  if (isGlobal) {
    // Yarn and pnpm support overriding the global bin directory via
    // npm_config_bin_root (Yarn) / --global-bin-dir (pnpm). npm itself does
    // NOT define bin_root — for npm the global bin IS the prefix root. We
    // honor the env var anyway so non-npm package managers that set it are
    // handled, then fall back to npm_config_prefix for standard npm installs.
    const binRoot = env.npm_config_bin_root;
    if (binRoot) {
      add(binRoot);
    }
    const prefix = env.npm_config_prefix;
    if (prefix) {
      add(prefix);
    }
    return dirs;
  }

  // INIT_CWD is the consumer project root where `npm install` was invoked.
  // For npx cache installs, INIT_CWD may be unrelated to packageRoot, so we
  // also derive the bin dir from packageRoot's nearest node_modules ancestor.
  const initCwd = env.INIT_CWD;
  if (initCwd) {
    add(path.join(initCwd, 'node_modules', '.bin'));
  }

  // Derive from packageRoot: walk up to the nearest node_modules and use .bin.
  add(nearestNodeModulesBin(packageRoot));

  return dirs;
}

function installNativeLaunchers(options) {
  const platform = options?.platform ?? process.platform;
  const log = options?.log ?? (() => {});
  const env = options?.env ?? process.env;

  if (platform !== 'win32') {
    return { written: [], skipped: [], error: null };
  }

  const packageRoot = options?.packageRoot ?? path.join(__dirname, '..');
  const bunExeAbs = resolveBunExe(packageRoot);
  const entryAbs = resolveEntry(packageRoot);

  if (!bunExeAbs) {
    log(
      `[postinstall] Could not resolve bundled Bun for ${PACKAGE_NAME}; ` +
        'skipping native launcher generation.',
    );
    return { written: [], skipped: [], error: 'bun-not-found' };
  }
  if (!entryAbs) {
    log(
      `[postinstall] Could not resolve entry point for ${PACKAGE_NAME}; ` +
        'skipping native launcher generation.',
    );
    return { written: [], skipped: [], error: 'entry-not-found' };
  }

  const binLinkDirs = findBinLinkDirs(packageRoot, env);
  const written = [];
  const skipped = [];

  for (const dir of binLinkDirs) {
    const cmdPath = path.join(dir, `${BIN_NAME}.cmd`);
    const ps1Path = path.join(dir, `${BIN_NAME}.ps1`);

    const bunRel = relativePath(dir, bunExeAbs);
    const entryRel = relativePath(dir, entryAbs);
    const bunRelPosix = relativePathPosix(dir, bunExeAbs);
    const entryRelPosix = relativePathPosix(dir, entryAbs);

    const cmdContent = generateCmdLauncher(bunRel, entryRel);
    const ps1Content = generatePs1Launcher(bunRelPosix, entryRelPosix);

    if (writeOwnedLauncher(cmdPath, cmdContent, dir, packageRoot, 'cmd', log)) {
      written.push(cmdPath);
    } else {
      log(
        `[postinstall] Skipped foreign/non-owned launcher at ${cmdPath} ` +
          '(ownership guard refused overwrite).',
      );
      skipped.push(cmdPath);
    }

    if (writeOwnedLauncher(ps1Path, ps1Content, dir, packageRoot, 'ps1', log)) {
      written.push(ps1Path);
    } else {
      log(
        `[postinstall] Skipped foreign/non-owned launcher at ${ps1Path} ` +
          '(ownership guard refused overwrite).',
      );
      skipped.push(ps1Path);
    }
  }

  if (written.length > 0) {
    log(
      `[postinstall] Wrote ${written.length} native launcher file` +
        (written.length === 1 ? '' : 's') +
        ` for ${PACKAGE_NAME}.`,
    );
  }

  return { written, skipped, error: null };
}

// This module is a postinstall entry point invoked by scripts/postinstall.cjs.
// It has no package export surface — it is never imported by the CLI runtime.
// The public API for the postinstall caller is installNativeLaunchers.
//
// Implementation-detail helpers (hasOwnershipSentinel, pointsToOurPackage,
// extractXxxShimTargets, etc.) are grouped under a private `_testing` namespace
// to keep the public surface narrow while remaining accessible to the
// behavioral unit tests in scripts/tests/.
module.exports = {
  // Public API (postinstall entry point).
  installNativeLaunchers,
  OWNERSHIP_SENTINEL,
  LAUNCHER_ERROR_EXIT_CODE,
  // Private test-only internals. These are NOT part of any package's public
  // API and may change without notice; they are exposed solely so the
  // behavioral tests can assert contracts directly.
  _testing: {
    generateCmdLauncher,
    generatePs1Launcher,
    hasOwnershipSentinel,
    pointsToOurPackage,
    canOverwriteLauncher,
    shimTargetWithinPackage,
    findBinLinkDirs,
    nearestNodeModulesBin,
    resolveBunExe,
    resolveEntry,
    isWithinPackageRoot,
    isWithinPackageRootWin,
    extractCmdShimTargets,
    extractPs1ShimTargets,
    resolveShimCandidate,
    relativePath,
    relativePathPosix,
    writeOwnedLauncher,
  },
};

if (require.main === module) {
  installNativeLaunchers();
}
