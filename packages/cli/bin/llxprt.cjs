#!/usr/bin/env node
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const { accessSync, constants, readFileSync, statSync } = require('node:fs');
const { basename, dirname, join } = require('node:path');

const BUN_RELAUNCH_ENV = 'LLXPRT_BUN_RELAUNCHED';
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'];
const SIGHUP_SELF_EXIT_DELAY_MS = 5_000;
const ORPHAN_CHECK_INTERVAL_MS = 10_000;
const SIGNAL_EXIT_CODES = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGQUIT: 131,
  SIGILL: 132,
  SIGTRAP: 133,
  SIGABRT: 134,
  SIGBUS: 135,
  SIGFPE: 136,
  SIGKILL: 137,
  SIGUSR1: 138,
  SIGSEGV: 139,
  SIGUSR2: 140,
  SIGPIPE: 141,
  SIGALRM: 142,
  SIGTERM: 143,
  SIGBREAK: 149,
};

function ancestors(startDir) {
  const dirs = [];
  let dir = startDir;
  while (dir !== dirname(dir)) {
    dirs.push(dir);
    dir = dirname(dir);
  }
  dirs.push(dir);
  return dirs;
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return isSpawnableUnixCandidate(path);
  } catch {
    return false;
  }
}

function isSpawnableUnixCandidate(path) {
  if (process.platform === 'win32') {
    return true;
  }
  try {
    const firstBytes = readFileSync(path).subarray(0, 4);
    const magic = firstBytes.toString('hex');
    return (
      firstBytes.toString('utf8').startsWith('#!') ||
      magic === '7f454c46' ||
      magic === 'cffaedfe' ||
      magic === 'feedfacf'
    );
  } catch {
    return false;
  }
}

function resolveEntry() {
  // The launcher always lives at <package root>/bin/llxprt.cjs, so the
  // package's own entry point is a sibling of this file's directory. This
  // covers the published standalone package layout, where the install
  // directory is named after the package (not "cli").
  const packageRootEntry = join(dirname(__dirname), 'index.ts');
  if (isFile(packageRootEntry)) {
    return packageRootEntry;
  }

  for (const dir of ancestors(__dirname)) {
    const packageEntry = join(dir, 'index.ts');
    if (isFile(packageEntry) && basename(dir) === 'cli') {
      return packageEntry;
    }

    const repositoryEntry = join(dir, 'packages', 'cli', 'index.ts');
    if (isFile(repositoryEntry)) {
      return repositoryEntry;
    }
  }
  return null;
}

function bunNames() {
  return process.platform === 'win32' ? ['bun.exe', 'bun.cmd'] : ['bun'];
}

function directBunNames() {
  // The bun npm package ships its binary as bun.exe on every platform (the
  // postinstall replaces the placeholder in-place), but check the bare name
  // too in case a future version drops the .exe suffix on Unix.
  return process.platform === 'win32'
    ? ['bun.exe', 'bun.cmd']
    : ['bun.exe', 'bun'];
}

function resolveBunFromNodeModules() {
  for (const dir of ancestors(__dirname)) {
    for (const name of bunNames()) {
      const candidate = join(dir, 'node_modules', '.bin', name);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
    for (const name of directBunNames()) {
      const candidate = join(dir, 'node_modules', 'bun', 'bin', name);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function resolveBunFromPath() {
  const tool = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(tool, ['bun'], {
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    return null;
  }
  for (const line of result.stdout.split(/\r?\n/)) {
    const candidate = line.trim().replace(/^(["'])(.+?)\1$/, '$2');
    if (candidate.length > 0 && isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveBun() {
  return resolveBunFromNodeModules() ?? resolveBunFromPath();
}

function hasWindowsCmdMetaCharacter(arg) {
  return /[&|<>^()%!"\r\n]/.test(arg);
}

function isWindowsCmdShim(path) {
  return (
    process.platform === 'win32' && basename(path).toLowerCase() === 'bun.cmd'
  );
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function bunLaunchErrorMessage(bunPath, error) {
  return `Failed to launch Bun at "${bunPath}" (${describeError(error)}). Reinstall dependencies with "npm install" to restore the bundled Bun, or ensure a working Bun is executable and on your PATH (see https://bun.sh).`;
}

function fatalExit(exit, message) {
  process.stderr.write(`${message}\n`);
  exit(43);
}

function resolveBunOrFail(exit, resolveBunFn) {
  const bunPath = resolveBunFn === undefined ? resolveBun() : resolveBunFn();
  if (bunPath === null) {
    fatalExit(
      exit,
      'Bun runtime was not found. Install it with "npm install" (it is bundled as the "bun" dependency) or install Bun directly from https://bun.sh and ensure it is on your PATH.',
    );
    return null;
  }
  return bunPath;
}

function resolveEntryOrFail(exit, resolveEntryFn) {
  const entry =
    resolveEntryFn === undefined ? resolveEntry() : resolveEntryFn();
  if (entry === null) {
    fatalExit(
      exit,
      'Could not locate the LLxprt Code TypeScript entry point (packages/cli/index.ts). Your installation may be corrupt; reinstall @vybestack/llxprt-code.',
    );
    return null;
  }
  return entry;
}

function buildSpawnArgs(bunPath, entry) {
  const args = [entry, ...process.argv.slice(2)];
  if (isWindowsCmdShim(bunPath) && args.some(hasWindowsCmdMetaCharacter)) {
    return {
      error:
        'Cannot safely forward arguments containing Windows command-shell metacharacters through the bundled bun.cmd shim. Install Bun directly so bun.exe is on PATH, or remove shell metacharacters from the CLI arguments.',
    };
  }
  return { args };
}

function createChildEnv() {
  return { ...process.env, [BUN_RELAUNCH_ENV]: 'true' };
}

async function runCliBin(options = {}) {
  const exit = options.exit ?? process.exit;
  const spawnFn = options.spawn ?? spawn;

  const bunPath = resolveBunOrFail(exit, options.resolveBun);
  if (bunPath === null) {
    return;
  }

  const entry = resolveEntryOrFail(exit, options.resolveEntry);
  if (entry === null) {
    return;
  }

  const built = buildSpawnArgs(bunPath, entry);
  if ('error' in built) {
    fatalExit(exit, built.error);
    return;
  }

  let child;
  try {
    child = spawnFn(bunPath, built.args, {
      stdio: 'inherit',
      env: createChildEnv(),
      shell: isWindowsCmdShim(bunPath),
    });
  } catch (error) {
    fatalExit(exit, bunLaunchErrorMessage(bunPath, error));
    return;
  }

  attachChildHandlers(child, bunPath, exit, {
    getPpid: options.getPpid,
    selfExitDelayMs: options.selfExitDelayMs,
    orphanCheckIntervalMs: options.orphanCheckIntervalMs,
  });
}

function attachChildHandlers(child, bunPath, exit, options = {}) {
  let settled = false;
  let childExitInfo = null;
  let hangupExitTimer = null;
  let orphanCheckTimer = null;

  const getPpid = options.getPpid ?? (() => process.ppid);
  const selfExitDelayMs = options.selfExitDelayMs ?? SIGHUP_SELF_EXIT_DELAY_MS;
  const orphanCheckIntervalMs =
    options.orphanCheckIntervalMs ?? ORPHAN_CHECK_INTERVAL_MS;

  const cleanupListeners = () => {
    child.off('close', onClose);
    child.off('error', onError);
    child.off('exit', onChildExit);
    for (const signal of FORWARDED_SIGNALS) {
      process.off(signal, forwardSignal);
    }
    process.off('beforeExit', onBeforeExit);
    if (hangupExitTimer !== null) {
      clearTimeout(hangupExitTimer);
      hangupExitTimer = null;
    }
    if (orphanCheckTimer !== null) {
      clearInterval(orphanCheckTimer);
      orphanCheckTimer = null;
    }
  };

  const prepareSettle = () => {
    if (settled) {
      return false;
    }
    settled = true;
    cleanupListeners();
    child.on('error', () => {});
    return true;
  };

  const settle = (exitCode) => {
    if (!prepareSettle()) {
      return;
    }
    exit(exitCode);
  };

  const exitCodeFromChild = (code, signal) => {
    if (code !== null) {
      return code;
    }
    if (signal !== null) {
      return SIGNAL_EXIT_CODES[signal] ?? 1;
    }
    return 1;
  };

  const forwardSignal = (signal) => {
    if (settled) {
      return;
    }
    try {
      child.kill(signal);
    } catch {
      // Child may have already exited before the signal handler fired.
    }
    // SIGHUP indicates the controlling terminal is gone. After forwarding,
    // schedule a fallback self-exit so the shim cannot become an immortal
    // husk if the child's close event never fires (e.g. child already
    // reaped externally, or event loop stalled).
    if (signal === 'SIGHUP' && hangupExitTimer === null) {
      hangupExitTimer = setTimeout(() => {
        settle(SIGNAL_EXIT_CODES['SIGHUP']);
      }, selfExitDelayMs);
      hangupExitTimer.unref();
    }
  };

  const onClose = (code, signal) => {
    settle(exitCodeFromChild(code, signal));
  };

  const onError = (error) => {
    if (!prepareSettle()) {
      return;
    }
    try {
      child.kill('SIGTERM');
    } catch {
      // Child may have already exited before the async spawn error surfaced.
    }
    process.stderr.write(`${bunLaunchErrorMessage(bunPath, error)}
`);
    exit(43);
  };

  const onChildExit = (code, signal) => {
    childExitInfo = { code, signal };
  };

  const onBeforeExit = () => {
    if (settled || childExitInfo === null) {
      return;
    }
    // Last-resort guard: if the event loop is draining and the child has
    // already exited (but 'close' never fired, e.g. inherited stdio with
    // a dead terminal), exit now rather than hanging forever.
    settle(exitCodeFromChild(childExitInfo.code, childExitInfo.signal));
  };

  const checkOrphaned = () => {
    if (settled || childExitInfo === null) {
      return;
    }
    // If the shim has been reparented to init (ppid === 1) and the child
    // has already exited, the terminal is gone and no signal will arrive.
    // Force exit to avoid becoming an immortal husk.
    let orphaned;
    try {
      orphaned = getPpid() === 1;
    } catch {
      return;
    }
    if (orphaned) {
      settle(exitCodeFromChild(childExitInfo.code, childExitInfo.signal));
    }
  };

  for (const signal of FORWARDED_SIGNALS) {
    process.on(signal, forwardSignal);
  }
  child.on('error', onError);
  child.on('close', onClose);
  child.on('exit', onChildExit);
  process.on('beforeExit', onBeforeExit);
  orphanCheckTimer = setInterval(checkOrphaned, orphanCheckIntervalMs);
  orphanCheckTimer.unref();
}

module.exports = { runCliBin };

if (require.main === module) {
  runCliBin().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
