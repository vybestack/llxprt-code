#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * packages/cli/bin/llxprt.mjs — the published `llxprt` bin entry (issue #2978).
 *
 * npm links ONLY the installed package's OWN bin entries on a global install; a
 * dependency's bin (e.g. the os-gated launcher packages) is never linked, so
 * `bin` must live on packages/cli itself or `npm i -g @vybestack/llxprt-code`
 * produces no `llxprt` command.
 *
 * This target MUST NOT use a `#!/bin/sh` shebang: npm's cmd-shim wraps a
 * sh-shebang target into a Windows `.cmd` that invokes `/bin/sh`, which does
 * not exist on Windows (the original #2978 bug). `#!/usr/bin/env node` makes
 * cmd-shim emit a working `.cmd`/`.ps1`, and on POSIX the file runs directly.
 *
 * The shim is self-sufficient: it resolves the bundled Bun binary from the
 * `@oven/bun-<variant>` optionalDependencies declared in packages/cli, resolves
 * the entry point, and execs Bun with stdio inherited. It deliberately does not
 * depend on the os-gated launcher packages, which may be retired independently.
 *
 * Unlike the `#!/bin/sh` launcher it replaced, this shim SPAWNS Bun instead of
 * exec'ing it, so file descriptors are not inherited automatically. The sandbox
 * credential transport hands the capability token to the CLI on fd 3 and names
 * it with LLXPRT_CAPABILITY_FD, so that descriptor must be forwarded explicitly
 * (issue #3389): a bare `stdio: 'inherit'` passes only fds 0-2, leaving the CLI
 * with the marker set and fd 3 either closed or reused by the runtime for an
 * unrelated file.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { closeSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// Matches LAUNCHER_FAILURE_EXIT documented in README.md / CONTRIBUTING.md and
// asserted by the launcher suites. Used for both missing-runtime and
// missing-entry failure modes.
const LAUNCHER_FAILURE_EXIT = 43;

// Marker naming the inherited capability descriptor. The sandbox entrypoint
// opens the credential-proxy capability token on fd 3 and exports this before
// exec'ing the CLI; the descriptor is the ONLY channel that carries the token
// (it is never in the child environment). See sandbox-entrypoint.ts and
// credential-store-factory.ts.
const CAPABILITY_FD_ENV = 'LLXPRT_CAPABILITY_FD';

// The only descriptor number the transport ever uses, and the only one
// consumeFd3Capability() accepts. Anything else is a corrupted or forged
// marker and must fail fast rather than cause an unrelated descriptor to be
// read and closed.
const CAPABILITY_FD_NUMBER = 3;

const MAX_INTERVAL_MS = 86_400_000;
const MAX_SNAPSHOT_HEAP_MB_LIMIT = 1_048_576;

const PROFILE_USAGE = `Usage: llxprt --memprofile[=<interval-ms>] [profile options] [llxprt args...]

  --memprofile                  enable memory profiling with the default interval
  --memprofile=<interval-ms>    enable memory profiling with a custom interval
  --memprofile-dir <run-dir>    write artifacts to the selected run directory
  --memprofile-snapshots        arm heap snapshots
  --memprofile-max-heap-mb <n>  set the snapshot heap guard`;

const PROFILE_UTILITY_USAGE = `Usage: llxprt memprofile <request|report|analyze> [args...]`;

// import.meta.url is the real path of this module (the published bin), so the
// package root is exactly one directory above the bin/ directory. Node's module
// resolution walks node_modules upward from here, finding the @oven optional
// dependencies that ship alongside the package.
const moduleRequire = createRequire(import.meta.url);
const shimDir = dirname(fileURLToPath(import.meta.url));
const pkgRoot = dirname(shimDir);
const isWin = process.platform === 'win32';

// The published `bun` package maps its bin entry to `bin/bun.exe` on EVERY
// platform (its postinstall copies the native binary to that name), so bun.exe
// is the canonical healthy-path candidate everywhere; `bun` is a tolerance
// fallback for layouts that retain the platform package's original name.
const BUN_BIN_CANDIDATES = ['bun.exe', 'bun'];

/**
 * True only for a regular file. A directory named `bun.exe` or `index.ts` from
 * a corrupt install must not be mistaken for the expected file.
 */
function isFile(thePath) {
  try {
    return statSync(thePath).isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Host detection + @oven/bun-<variant> selection.
//
// The platform table is transcribed verbatim from node_modules/bun/install.js
// (bun@1.3.14) and mirrors packages/cli/src/launcher/oven-bun-variants.ts and
// packages/cli/scripts/install-native-launchers.cjs. One deliberate deviation
// from upstream: on a musl host, musl variants are ordered FIRST with glibc as
// a last resort (upstream's postinstall already picked a binary, so its filter
// lets glibc sort ahead of musl — unsafe when several variants coexist here).
// ---------------------------------------------------------------------------

const PLATFORM_TABLE = [
  { os: 'darwin', arch: 'arm64', bin: 'bun-darwin-aarch64' },
  { os: 'darwin', arch: 'x64', avx2: true, bin: 'bun-darwin-x64' },
  { os: 'darwin', arch: 'x64', bin: 'bun-darwin-x64-baseline' },
  { os: 'linux', arch: 'arm64', bin: 'bun-linux-aarch64' },
  { os: 'linux', arch: 'x64', avx2: true, bin: 'bun-linux-x64' },
  { os: 'linux', arch: 'x64', bin: 'bun-linux-x64-baseline' },
  { os: 'linux', arch: 'arm64', abi: 'musl', bin: 'bun-linux-aarch64-musl' },
  {
    os: 'linux',
    arch: 'x64',
    abi: 'musl',
    avx2: true,
    bin: 'bun-linux-x64-musl',
  },
  { os: 'linux', arch: 'x64', abi: 'musl', bin: 'bun-linux-x64-musl-baseline' },
  {
    os: 'android',
    arch: 'arm64',
    abi: 'android',
    bin: 'bun-linux-aarch64-android',
  },
  { os: 'android', arch: 'x64', abi: 'android', bin: 'bun-linux-x64-android' },
  { os: 'freebsd', arch: 'arm64', bin: 'bun-freebsd-aarch64' },
  { os: 'freebsd', arch: 'x64', bin: 'bun-freebsd-x64' },
  { os: 'win32', arch: 'x64', avx2: true, bin: 'bun-windows-x64' },
  { os: 'win32', arch: 'x64', bin: 'bun-windows-x64-baseline' },
  { os: 'win32', arch: 'arm64', bin: 'bun-windows-aarch64' },
];

function normalizeArch(raw) {
  switch (raw) {
    case 'x64':
    case 'x86_64':
    case 'amd64':
      return 'x64';
    case 'arm64':
    case 'aarch64':
      return 'arm64';
    default:
      return null;
  }
}

function spawnOut(cmd, args) {
  try {
    const result = spawnSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { status: result.status, stdout: result.stdout ?? '' };
  } catch {
    return { status: null, stdout: '' };
  }
}

function isRosetta2() {
  const { status, stdout } = spawnOut('sysctl', [
    '-n',
    'sysctl.proc_translated',
  ]);
  return status === 0 && stdout.includes('1');
}

function detectAbi(os) {
  if (os === 'android') {
    return 'android';
  }
  if (os === 'linux' && existsSync('/etc/alpine-release')) {
    return 'musl';
  }
  return undefined;
}

function hostHasAvx2(os) {
  switch (os) {
    case 'linux':
      try {
        return readFileSync('/proc/cpuinfo', 'utf8').includes('avx2');
      } catch {
        return false;
      }
    case 'darwin': {
      const { status, stdout } = spawnOut('sysctl', ['-n', 'machdep.cpu']);
      return status === 0 && stdout.includes('AVX2');
    }
    case 'win32': {
      const command =
        '(Add-Type -MemberDefinition \'[DllImport("kernel32.dll")] ' +
        'public static extern bool IsProcessorFeaturePresent(int ' +
        "ProcessorFeature);' -Name 'Kernel32' -Namespace 'Win32' " +
        '-PassThru)::IsProcessorFeaturePresent(40)';
      const { status, stdout } = spawnOut('powershell', [
        '-NoProfile',
        '-Command',
        command,
      ]);
      return status === 0 && stdout.trim() === 'True';
    }
    default:
      return false;
  }
}

let hostVariantsCache = null;

/**
 * Selects the ordered list of `@oven/bun-<platform>` candidate package names
 * for this host. Mirrors the upstream filter + the musl-first/avx2 ordering so
 * the safe probe order is honoured. Memoized so detection subprocesses
 * (sysctl, /proc/cpuinfo, PowerShell) run at most once.
 */
function selectHostOvenVariants() {
  if (hostVariantsCache !== null) {
    return hostVariantsCache;
  }
  const os = process.platform;
  let arch = normalizeArch(process.arch);
  if (os === 'darwin' && arch === 'x64' && isRosetta2()) {
    arch = 'arm64';
  }
  if (arch === null) {
    hostVariantsCache = [];
    return hostVariantsCache;
  }
  const abi = detectAbi(os);
  const avx2 = arch === 'x64' && hostHasAvx2(os);

  const matched = PLATFORM_TABLE.filter((row) => {
    if (row.os !== os || row.arch !== arch) {
      return false;
    }
    // A non-avx2 host must never receive an avx2 package (SIGILL crash).
    if (row.avx2 === true && !avx2) {
      return false;
    }
    // abi filter: a row declaring an abi passes only on a matching host, EXCEPT
    // a musl host retains glibc rows as a last-resort fallback.
    if (row.abi === undefined) {
      return true;
    }
    return row.abi === abi;
  });

  const abiKey = (row) => {
    if (abi === 'musl') {
      return row.abi === 'musl' ? 0 : 1;
    }
    return 0;
  };
  const avx2Key = (row) => (row.avx2 === true ? 0 : 1);
  matched.sort((a, b) => abiKey(a) - abiKey(b) || avx2Key(a) - avx2Key(b));

  hostVariantsCache = matched.map((row) => `@oven/${row.bin}`);
  return hostVariantsCache;
}

/**
 * Exe names to probe per variant: the platform-native name first, then the
 * other name for robustness against alternate layouts.
 */
function ovenExeNames() {
  return isWin ? ['bin/bun.exe', 'bin/bun'] : ['bin/bun', 'bin/bun.exe'];
}

/** Yields each ancestor directory starting from `start` up to the root. */
function* ancestorDirs(start) {
  let dir = start;
  while (true) {
    yield dir;
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
}

/** Yields each ancestor directory literally named `node_modules`, from `start` up to the root. */
function* ancestorNodeModulesDirs(start) {
  for (const dir of ancestorDirs(start)) {
    if (basename(dir) === 'node_modules') {
      yield dir;
    }
  }
}

/**
 * Primary @oven path: Node module resolution from the shim location. createRequire
 * walks node_modules upward and matches npm/yarn/pnpm hoist layouts; resolving
 * `<variant>/package.json` keeps the package directory stable across layouts.
 * Detection runs lazily inside selectHostOvenVariants.
 */
function resolveOvenViaResolution() {
  const variants = selectHostOvenVariants();
  if (variants.length === 0) {
    return null;
  }
  const exeNames = ovenExeNames();
  for (const variant of variants) {
    let pkgDir = null;
    try {
      pkgDir = dirname(moduleRequire.resolve(`${variant}/package.json`));
    } catch {
      pkgDir = null;
    }
    if (pkgDir !== null) {
      for (const exe of exeNames) {
        const candidate = join(pkgDir, exe);
        if (isFile(candidate)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

/**
 * Fallback @oven path: explicit node_modules walk from the package root and each
 * enclosing ancestor, covering layouts where module resolution cannot see the
 * optional dependency (e.g. certain pnpm isolated installs).
 */
function resolveOvenViaNodeModulesWalk() {
  const variants = selectHostOvenVariants();
  if (variants.length === 0) {
    return null;
  }
  const exeNames = ovenExeNames();
  for (const ancestor of ancestorDirs(pkgRoot)) {
    const nodeModules = join(ancestor, 'node_modules');
    for (const variant of variants) {
      for (const exe of exeNames) {
        const candidate = join(nodeModules, variant, exe);
        if (isFile(candidate)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

/**
 * Resolves the bundled Bun binary. Tries the healthy path (bun's postinstall
 * moved the native binary into node_modules/bun/bin) first, then falls back to
 * the `@oven/bun-<variant>` optionalDependencies — which is the path that
 * actually materializes under npm v12's default-deny of install scripts.
 */
function resolveBun() {
  for (const name of BUN_BIN_CANDIDATES) {
    const candidate = join(pkgRoot, 'node_modules', 'bun', 'bin', name);
    if (isFile(candidate)) {
      return candidate;
    }
  }
  for (const nodeModules of ancestorNodeModulesDirs(shimDir)) {
    for (const name of BUN_BIN_CANDIDATES) {
      const candidate = join(nodeModules, 'bun', 'bin', name);
      if (isFile(candidate)) {
        return candidate;
      }
    }
  }
  const ovenResolved = resolveOvenViaResolution();
  if (ovenResolved !== null) {
    return ovenResolved;
  }
  return resolveOvenViaNodeModulesWalk();
}

/**
 * Resolves the entry point with the precedence used by the POSIX sh launcher
 * and the native Windows launchers: the LLXPRT_FORCE_SOURCE_ENTRY escape hatch
 * wins, otherwise the prebuilt bundle is preferred, falling back to source.
 */
function resolveEntry() {
  if (process.env.LLXPRT_FORCE_SOURCE_ENTRY === '1') {
    return join(pkgRoot, 'index.ts');
  }
  const bundle = join(pkgRoot, 'bundle', 'llxprt.js');
  if (isFile(bundle)) {
    return bundle;
  }
  return join(pkgRoot, 'index.ts');
}

class InvocationParseError extends Error {
  constructor(message, usage) {
    super(message);
    this.usage = usage;
  }
}

function profileOptionValue(argv, index, name) {
  const value = argv[index + 1];
  if (value === undefined) {
    throw new InvocationParseError(`missing value for ${name}`, PROFILE_USAGE);
  }
  if (value.length === 0 || value.startsWith('-')) {
    throw new InvocationParseError(
      `invalid value for ${name}: ${value} (expected a non-flag value)`,
      PROFILE_USAGE,
    );
  }
  return value;
}

function validatePositiveInteger(raw, name, max) {
  if (!/^\d+$/u.test(raw)) {
    throw new InvocationParseError(
      `invalid value for ${name}: ${raw} (expected a positive integer)`,
      PROFILE_USAGE,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvocationParseError(
      `invalid value for ${name}: ${raw} (expected a positive integer)`,
      PROFILE_USAGE,
    );
  }
  if (value > max) {
    throw new InvocationParseError(
      `invalid value for ${name}: ${raw} (must be <= ${max})`,
      PROFILE_USAGE,
    );
  }
}

function buildUtilityInvocation(argv, packageRoot) {
  const command = argv[1];
  if (command === undefined) {
    throw new InvocationParseError(
      'missing memprofile subcommand',
      PROFILE_UTILITY_USAGE,
    );
  }

  let artifact;
  switch (command) {
    case 'request':
      artifact = 'memprofile-request.js';
      break;
    case 'report':
      artifact = 'memprofile-report.js';
      break;
    case 'analyze':
      artifact = 'memprofile-analyze.js';
      break;
    default:
      throw new InvocationParseError(
        `unknown memprofile subcommand: ${command}`,
        PROFILE_UTILITY_USAGE,
      );
  }

  const entry = join(packageRoot, 'bundle', artifact);
  return {
    entry,
    requiredEntries: [entry],
    childArgv: argv.slice(2),
    profilerEntry: true,
    isolateSignalGroup: false,
  };
}

// ---------------------------------------------------------------------------
// Argument boundary parsing.
//
// A user-supplied `--` ends this shim's option region: ordinary application
// argv has its own `--` contract (and the user's `--` is a separator
// the user owns, never a diagnostic). Everything at or after the first `--` is
// forwarded to the application verbatim, in order, and must never be counted,
// parsed, or translated as a profile flag.
//
// With an active shim-launched profile, only the prefix before the first `--` is a
// candidate for profile-control translation, and the ordinary argv the application
// receives is `[prefix ..] -- [suffix ..]`.
//
// Utility dispatch is decided by the first shim argument being `memprofile`; a
// `memprofile` token after `--` belongs to the application and is never utility
// dispatch.
// ---------------------------------------------------------------------------

function findUserBoundaryIndex(argv) {
  return argv.indexOf('--');
}

function buildProfileInvocation(argv, packageRoot) {
  const boundaryIndex = findUserBoundaryIndex(argv);
  const prefix = boundaryIndex < 0 ? argv : argv.slice(0, boundaryIndex);
  const suffix = boundaryIndex < 0 ? [] : argv.slice(boundaryIndex);

  const activationCount = prefix.filter(
    (arg) => arg === '--memprofile' || arg.startsWith('--memprofile='),
  ).length;
  if (activationCount > 1) {
    throw new InvocationParseError(
      '--memprofile may only be specified once',
      PROFILE_USAGE,
    );
  }

  for (const control of [
    '--memprofile-dir',
    '--memprofile-snapshots',
    '--memprofile-max-heap-mb',
  ]) {
    if (prefix.filter((arg) => arg === control).length > 1) {
      throw new InvocationParseError(
        `${control} may only be specified once`,
        PROFILE_USAGE,
      );
    }
  }

  const profilerArgv = [];
  const ordinaryArgv = [];
  for (let index = 0; index < prefix.length; index += 1) {
    const arg = prefix[index];
    if (arg === '--memprofile') {
      continue;
    }
    if (arg.startsWith('--memprofile=')) {
      const interval = arg.slice('--memprofile='.length);
      validatePositiveInteger(interval, '--memprofile', MAX_INTERVAL_MS);
      profilerArgv.push('--interval', interval);
    } else if (arg === '--memprofile-dir') {
      const value = profileOptionValue(prefix, index, arg);
      profilerArgv.push('--dir', value);
      index += 1;
    } else if (arg === '--memprofile-snapshots') {
      profilerArgv.push('--snapshots');
    } else if (arg === '--memprofile-max-heap-mb') {
      const value = profileOptionValue(prefix, index, arg);
      validatePositiveInteger(value, arg, MAX_SNAPSHOT_HEAP_MB_LIMIT);
      profilerArgv.push('--max-heap-mb', value);
      index += 1;
    } else {
      ordinaryArgv.push(arg);
    }
  }

  const entry = join(packageRoot, 'bundle', 'memprofile-launcher.js');
  return {
    entry,
    requiredEntries: [
      entry,
      join(packageRoot, 'bundle', 'memprofile-preload.js'),
      join(packageRoot, 'bundle', 'llxprt.js'),
    ],
    childArgv: [...profilerArgv, '--', ...ordinaryArgv, ...suffix],
    profilerEntry: true,
    isolateSignalGroup: true,
  };
}

/**
 * Selects the installed entry and child argv without reading process or file
 * system state. Profile-control flags remain ordinary arguments unless an exact
 * activation flag is present.
 */
function selectInvocation(argv, ordinaryEntry, packageRoot) {
  if (argv[0] === 'memprofile') {
    return buildUtilityInvocation(argv, packageRoot);
  }

  const boundaryIndex = findUserBoundaryIndex(argv);
  const prefix = boundaryIndex < 0 ? argv : argv.slice(0, boundaryIndex);

  const profiling = prefix.some(
    (arg) => arg === '--memprofile' || arg.startsWith('--memprofile='),
  );
  if (profiling) {
    return buildProfileInvocation(argv, packageRoot);
  }

  return {
    entry: ordinaryEntry,
    requiredEntries: [ordinaryEntry],
    childArgv: [...argv],
    profilerEntry: false,
    isolateSignalGroup: false,
  };
}

function failBunNotFound() {
  console.error('LLxprt Code: bundled Bun runtime was not found.');
  console.error(
    'Reinstall the package with "npm install @vybestack/llxprt-code"',
  );
  console.error(
    'to restore the bundled Bun dependency, or visit https://bun.sh',
  );
  process.exit(LAUNCHER_FAILURE_EXIT);
}

function failEntryNotFound(invocation, missingEntry) {
  if (invocation.profilerEntry) {
    console.error('LLxprt Code: memory profiler entry point was not found.');
  } else {
    console.error('LLxprt Code: entry point was not found.');
  }
  console.error(`Expected: ${missingEntry}`);
  console.error(
    'Your installation may be corrupt; reinstall @vybestack/llxprt-code.',
  );
  process.exit(LAUNCHER_FAILURE_EXIT);
}

function failInvocationParse(error) {
  console.error(`LLxprt Code: ${error.message}`);
  console.error('');
  console.error(error.usage);
  process.exit(1);
}

function failLaunch(message) {
  console.error('LLxprt Code: bundled Bun runtime could not be launched.');
  console.error(
    `The bundled bun may be missing, corrupt, or inaccessible: ${message}`,
  );
  console.error(
    'Reinstall the package with "npm install @vybestack/llxprt-code"',
  );
  console.error('or install Bun directly from https://bun.sh');
  process.exit(LAUNCHER_FAILURE_EXIT);
}

function failCapabilityMarker(marker) {
  console.error(
    `LLxprt Code: invalid ${CAPABILITY_FD_ENV} marker "${marker}".`,
  );
  console.error(
    `The sandbox capability transport only uses descriptor ${CAPABILITY_FD_NUMBER}.`,
  );
  console.error(
    'Unset the variable if you set it manually; otherwise the sandbox',
  );
  console.error('entrypoint is corrupt and the container should be rebuilt.');
  process.exit(LAUNCHER_FAILURE_EXIT);
}

function failCapabilityForward(message) {
  console.error(
    'LLxprt Code: the sandbox capability descriptor could not be forwarded.',
  );
  console.error(`Descriptor ${CAPABILITY_FD_NUMBER} is unusable: ${message}`);
  process.exit(LAUNCHER_FAILURE_EXIT);
}

/**
 * Builds the child stdio layout. Without a capability marker this is a plain
 * inherit of fds 0-2. With one, fd 3 is added so the descriptor carrying the
 * credential-proxy capability token survives the hop into Bun; the marker in
 * the child environment then names a descriptor that is genuinely there.
 */
function buildStdio() {
  const marker = process.env[CAPABILITY_FD_ENV];
  if (marker === undefined || marker === '') {
    return { stdio: 'inherit', forwardsCapability: false };
  }
  if (marker !== String(CAPABILITY_FD_NUMBER)) {
    failCapabilityMarker(marker);
  }
  return {
    stdio: ['inherit', 'inherit', 'inherit', CAPABILITY_FD_NUMBER],
    forwardsCapability: true,
  };
}

/**
 * Drops this supervisor's copy of the capability descriptor once the child has
 * inherited it, so the token is readable in exactly one live process. EBADF
 * means it is already gone, which is the desired end state.
 */
function closeCapabilityFd() {
  try {
    closeSync(CAPABILITY_FD_NUMBER);
  } catch (error) {
    if (error?.code !== 'EBADF') {
      throw error;
    }
  }
}

const SIGNAL_BRIDGE_ENV = 'LLXPRT_INTERNAL_MEMPROFILE_SIGNAL_BRIDGE';
const SHARED_GROUP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const ISOLATED_GROUP_SIGNALS = [
  'SIGINT',
  'SIGTERM',
  'SIGHUP',
  'SIGQUIT',
  'SIGTSTP',
  'SIGCONT',
  'SIGWINCH',
];
const WINDOWS_PROFILE_SIGNALS = ['SIGTERM', 'SIGHUP'];

function run() {
  let invocation;
  try {
    invocation = selectInvocation(
      process.argv.slice(2),
      resolveEntry(),
      pkgRoot,
    );
  } catch (error) {
    if (error instanceof InvocationParseError) {
      failInvocationParse(error);
      return;
    }
    throw error;
  }

  const bunExe = resolveBun();
  if (bunExe === null) {
    failBunNotFound();
    return;
  }

  for (const requiredEntry of invocation.requiredEntries) {
    if (!isFile(requiredEntry)) {
      failEntryNotFound(invocation, requiredEntry);
      return;
    }
  }

  const { stdio, forwardsCapability } = buildStdio();
  const isolateSignalGroup =
    invocation.isolateSignalGroup && process.platform !== 'win32';
  const forwardedSignals = isolateSignalGroup
    ? ISOLATED_GROUP_SIGNALS
    : invocation.isolateSignalGroup
      ? WINDOWS_PROFILE_SIGNALS
      : SHARED_GROUP_SIGNALS;
  const ignoredSignals =
    invocation.isolateSignalGroup && process.platform === 'win32'
      ? ['SIGINT']
      : [];
  const childEnv = invocation.isolateSignalGroup
    ? { ...process.env, [SIGNAL_BRIDGE_ENV]: '1' }
    : process.env;

  let child;
  try {
    child = spawn(bunExe, [invocation.entry, '--', ...invocation.childArgv], {
      stdio,
      detached: isolateSignalGroup,
      env: childEnv,
    });
  } catch (error) {
    // A marked but unopened fd 3 makes spawn throw EBADF synchronously, and
    // that is the only failure the capability transport is responsible for.
    // Every other spawn failure keeps its original error so it is not
    // misattributed to fd 3.
    if (forwardsCapability && error?.code === 'EBADF') {
      failCapabilityForward(error.message ?? String(error));
      return;
    }
    throw error;
  }

  if (forwardsCapability) {
    closeCapabilityFd();
    // The child already holds its own copy of the environment; deleting the
    // marker here only narrows what this supervisor can observe.
    delete process.env[CAPABILITY_FD_ENV];
  }

  const forward = (signal) => {
    let delivered = false;
    try {
      delivered = child.kill(signal);
    } catch {
      // The child may have exited between the signal arriving and the kill.
    }
    if (isolateSignalGroup && signal === 'SIGTSTP' && delivered) {
      process.kill(process.pid, 'SIGSTOP');
    }
  };
  for (const signal of forwardedSignals) {
    process.on(signal, forward);
  }

  const ignore = () => undefined;
  for (const signal of ignoredSignals) {
    process.on(signal, ignore);
  }

  child.on('error', (error) => {
    for (const signal of forwardedSignals) {
      process.off(signal, forward);
    }
    for (const signal of ignoredSignals) {
      process.off(signal, ignore);
    }
    failLaunch(error.message);
  });

  child.on('exit', (code, signal) => {
    for (const sig of forwardedSignals) {
      process.off(sig, forward);
    }
    for (const sig of ignoredSignals) {
      process.off(sig, ignore);
    }
    if (signal) {
      // Re-raise on the parent so the process dies with the same signal the
      // child died from, mirroring exec() (process replacement) semantics.
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

run();
