#!/usr/bin/env node
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const {
  accessSync,
  constants,
  readFileSync,
  realpathSync,
  statSync,
} = require('node:fs');
const { rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { basename, dirname, isAbsolute, join, normalize } = require('node:path');
const {
  CREDENTIAL_SOCKET_ENV,
  PROXY_SOCKET_PREFIX,
  createLauncherChildEnv,
  hasUsableCredentialSocket,
} = require('./launcher-credential-env.cjs');
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'];
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
const PROXY_HOST_PATH = join(__dirname, 'credential-proxy-host.cjs');
const PROXY_HOST_NODE_ARGS = [
  '--disable-warning=ExperimentalWarning',
  PROXY_HOST_PATH,
];
const PROXY_HOST_STARTUP_TIMEOUT_MS = 15_000;
const PROXY_HOST_SHUTDOWN_TIMEOUT_MS = 1_000;
// Shorter, distinct window to wait for the kernel to reap the process after
// SIGKILL, so a child stuck in uninterruptible I/O does not double the total
// shutdown latency.
const POST_SIGKILL_REAP_TIMEOUT_MS = 250;
// rm() error codes that indicate a transient lock (notably on Windows) and are
// worth retrying before giving up on removing the socket directory.
const RETRYABLE_RM_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);
// Backoff between socket-directory removal retries.
const RM_RETRY_DELAY_MS = 50;

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

function fatalCredentialProxyMessage(error) {
  return `Failed to start the credential proxy needed for Bun runtime access to saved provider credentials (${describeError(error)}). Reinstall dependencies with "npm install" and try again.`;
}

function stopCredentialProxy(proxy) {
  if (proxy === null) {
    return Promise.resolve();
  }
  return proxy.stop().catch(() => {});
}

async function stopProxyHost(child, socketDir = '') {
  let forcedKill = false;
  await new Promise((resolve) => {
    // Only short-circuit when the child has ACTUALLY exited. child.killed is
    // deliberately excluded: it is set as soon as any kill() is called (even a
    // graceful SIGTERM the sidecar is still handling), so treating it as
    // "already done" here would resolve before the process exits and skip the
    // forced-kill cleanup accounting below.
    if (child.exitCode !== null || child.signalCode !== null) {
      // The child already exited/was signaled before we could send SIGTERM. If
      // it died from a signal or a non-zero exit rather than exiting gracefully
      // with code 0, the sidecar never ran its own cleanup, so the parent must
      // remove the socket directory.
      if (
        child.signalCode !== null ||
        (child.exitCode !== null && child.exitCode !== 0)
      ) {
        forcedKill = true;
      }
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      child.off('close', finish);
      resolve();
    };
    const timer = setTimeout(() => {
      // Only treat this as a forced kill if the child actually survived past the
      // SIGTERM deadline. If it already exited gracefully (racing the timer), the
      // sidecar cleaned up its own socket dir, so the parent must not attempt
      // cleanup — keeping forcedKill accurate to its stated intent.
      if (child.exitCode === null && child.signalCode === null) {
        forcedKill = true;
      }
      // Wait for the kernel to reap the process before proceeding so the
      // socket-directory cleanup below does not race with a lingering process
      // still holding the directory (notably on Windows). Fall back to a short
      // secondary deadline in case the close event never arrives.
      let resolvedAfterKill = false;
      const resolveOnce = () => {
        if (resolvedAfterKill) {
          return;
        }
        resolvedAfterKill = true;
        clearTimeout(reapTimer);
        child.off('close', resolveOnce);
        resolve();
      };
      const reapTimer = setTimeout(resolveOnce, POST_SIGKILL_REAP_TIMEOUT_MS);
      // Attach resolveOnce BEFORE removing finish so a 'close' emitted during
      // the SIGKILL cannot slip through the gap between off() and once().
      child.once('close', resolveOnce);
      child.off('close', finish);
      try {
        child.kill('SIGKILL');
      } catch {
        // Process may have already exited before the close event was delivered.
      }
    }, PROXY_HOST_SHUTDOWN_TIMEOUT_MS);
    child.once('close', finish);
    try {
      child.kill('SIGTERM');
    } catch {
      // If SIGTERM delivery failed and the child is still alive, it will not run
      // its own cleanup, so the parent must take over socket-dir removal.
      if (child.exitCode === null && child.signalCode === null) {
        forcedKill = true;
      }
      finish();
    }
  });
  // The sidecar owns and removes its own socket directory during a graceful
  // (SIGTERM) shutdown. Only when we escalate to SIGKILL — where the sidecar is
  // terminated before it can run its own cleanup — does the parent take over
  // removing the reported directory so it is not leaked.
  if (forcedKill && socketDir.length > 0) {
    await removeSocketDirWithRetry(socketDir);
  }
}

// On Windows the kernel may still hold a lock on the socket file for a short
// window after the process exits, so a single rm() can fail with EBUSY/EPERM/
// ENOTEMPTY. Retry a few times before giving up, and surface a warning rather
// than silently leaking the directory.
async function removeSocketDirWithRetry(socketDir) {
  // Operate only on the already-validated string form (a direct lxcp- child of
  // tmpdir()). Deliberately do NOT realpath here: resolving a symlink before
  // rm() would let a post-validation symlink swap redirect the recursive delete
  // to an arbitrary target. rm() itself does not follow a top-level symlink, so
  // the worst a swapped-in symlink can cause is removal of the link entry.
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await rm(socketDir, { force: true, recursive: true });
      return;
    } catch (error) {
      const code =
        error && typeof error === 'object' && typeof error.code === 'string'
          ? error.code
          : undefined;
      if (!RETRYABLE_RM_CODES.has(code) || attempt === maxAttempts - 1) {
        process.stderr.write(
          `warning: failed to remove proxy socket dir ${socketDir}: ${describeError(error)}\n`,
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, RM_RETRY_DELAY_MS));
    }
  }
}

// '/' and '\' (backslash, code point 92) path separators. Backslash is only a
// real separator on Windows; on POSIX it is a valid filename character, but
// since mkdtemp never generates trailing separators, stripping it on all
// platforms is a safe conservative normalization.
const PATH_SEPARATORS = new Set(['/', String.fromCharCode(92)]);

function stripTrailingSeparators(value) {
  let end = value.length;
  while (end > 0 && PATH_SEPARATORS.has(value[end - 1])) {
    end -= 1;
  }
  return value.slice(0, end);
}

// The socket directory is later handed to a recursive rm() on the force-kill
// cleanup path, and the sidecar's stdout is a process boundary that a buggy,
// compromised, or tampered producer could abuse to report an arbitrary path
// (e.g. '/' or '/tmp'). Constrain ANY directory we accept — whether explicitly
// reported by the sidecar or derived from socketPath — to an absolute path that
// lives directly under the OS temp directory and carries the sidecar's socket
// prefix (matching mkdtemp(join(tmpdir(), PROXY_SOCKET_PREFIX))). This bounds
// what rm() can ever target.
function safeRealpath(targetPath) {
  try {
    return realpathSync(targetPath);
  } catch {
    return undefined;
  }
}

function isSafeProxySocketDir(candidateDir) {
  // Strip trailing separators so a reported path like '/tmp/lxcp-abc/' still
  // yields a usable basename.
  const normalized = stripTrailingSeparators(candidateDir);
  if (
    !isAbsolute(normalized) ||
    !basename(normalized).startsWith(PROXY_SOCKET_PREFIX)
  ) {
    return false;
  }
  // The parent must be the OS temp directory. Compare against BOTH the
  // unresolved and realpath-resolved forms of tmpdir() and of the candidate's
  // parent, so a symlinked temp root (e.g. macOS /var -> /private/var, which
  // mkdtemp itself may return) is accepted whether or not the parent currently
  // resolves on disk. If the parent does not exist (e.g. a fabricated payload)
  // its unresolved form still will not match tmpdir(), so it is rejected.
  const parent = dirname(normalized);
  const acceptedParents = new Set([tmpdir()]);
  const resolvedTmp = safeRealpath(tmpdir());
  if (resolvedTmp !== undefined) {
    acceptedParents.add(resolvedTmp);
  }
  const resolvedParent = safeRealpath(parent);
  return (
    acceptedParents.has(parent) ||
    (resolvedParent !== undefined && acceptedParents.has(resolvedParent))
  );
}

function parseProxyHostLine(line) {
  const parsed = JSON.parse(line);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof parsed.socketPath !== 'string' ||
    parsed.socketPath.length === 0
  ) {
    throw new Error('proxy host did not report a socket path');
  }
  // Prefer the explicitly reported socketDir; fall back to deriving it from
  // socketPath for backward compatibility with older payloads. Either way the
  // result must pass the same safety validation before it can reach rm().
  const reportedDir =
    typeof parsed.socketDir === 'string' && parsed.socketDir.length > 0
      ? parsed.socketDir
      : dirname(parsed.socketPath);
  if (!isSafeProxySocketDir(reportedDir)) {
    throw new Error('proxy host did not report a usable socket directory');
  }
  // Normalize to the trailing-separator-stripped form that isSafeProxySocketDir
  // validated, so the containment comparison below uses exactly what was
  // checked (dirname() never emits trailing separators).
  const safeSocketDir = stripTrailingSeparators(reportedDir);
  // The socketPath is forwarded to the Bun child as its credential socket, so a
  // tampered producer must not be able to pair a safe-looking socketDir with a
  // socketPath pointing elsewhere. Require the socket to live directly inside
  // the validated directory. Normalize both sides so a legitimate payload that
  // mixes '/' and '\' separators (possible on Windows) does not cause a
  // spurious mismatch. Note: this comparison is case-sensitive; it is safe
  // because both socketDir and socketPath originate from the same sidecar's
  // single mkdtemp()+join() call and are therefore consistently cased.
  if (normalize(dirname(parsed.socketPath)) !== normalize(safeSocketDir)) {
    throw new Error(
      'proxy host reported a socket path outside its socket directory',
    );
  }
  return { socketPath: parsed.socketPath, socketDir: safeSocketDir };
}

function createCredentialProxyDefault(options = {}) {
  const spawnFn = options.spawn ?? spawn;
  const onUnexpectedExit = options.onUnexpectedExit ?? (() => {});
  const onProxyCreated = options.onProxyCreated ?? (() => {});
  const env = { ...process.env };
  delete env[CREDENTIAL_SOCKET_ENV];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(process.execPath, PROXY_HOST_NODE_ARGS, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
    } catch (error) {
      reject(new Error(fatalCredentialProxyMessage(error)));
      return;
    }

    let settled = false;
    let stopping = false;
    let stdout = '';
    let stderr = '';
    const startupTimer = setTimeout(() => {
      void fail(
        new Error(
          fatalCredentialProxyMessage(
            'proxy host did not report a socket path within the startup timeout',
          ),
        ),
      );
    }, PROXY_HOST_STARTUP_TIMEOUT_MS);

    const absorbLateChildError = () => {};

    const onPostStartupClose = (code, signal) => {
      if (stopping) {
        return;
      }
      onUnexpectedExit({ code, signal });
    };

    const cleanup = () => {
      clearTimeout(startupTimer);
      child.off('error', onError);
      child.off('close', onClose);
      child.stdout?.off('data', onStdout);
      child.stderr?.off('data', onStderr);
    };

    const cleanupAfterStartup = () => {
      clearTimeout(startupTimer);
      child.on('error', absorbLateChildError);
      child.on('close', onPostStartupClose);
      child.off('error', onError);
      child.off('close', onClose);
      child.stdout?.off('data', onStdout);
      child.stderr?.off('data', onStderr);
    };

    const proxyHostHandle = {
      socketPath: '',
      socketDir: '',
      stop: async () => {
        stopping = true;
        child.off('close', onPostStartupClose);
        child.off('error', absorbLateChildError);
        await stopProxyHost(child, proxyHostHandle.socketDir);
      },
    };
    onProxyCreated(proxyHostHandle);

    const fail = async (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      await stopProxyHost(child, proxyHostHandle.socketDir).catch(() => {});
      reject(error);
    };

    const onError = (error) => {
      void fail(new Error(fatalCredentialProxyMessage(error)));
    };

    const onClose = (code, signal) => {
      const reason =
        stderr.trim() ||
        `proxy host exited before reporting a socket path (code=${code}, signal=${signal})`;
      void fail(new Error(fatalCredentialProxyMessage(reason)));
    };

    const onStderr = (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 4096) {
        stderr = stderr.slice(-4096);
      }
    };

    const onStdout = (chunk) => {
      stdout += chunk.toString('utf8');
      const newline = stdout.indexOf('\n');
      if (newline === -1) {
        if (stdout.length > 8192) {
          void fail(
            new Error(
              fatalCredentialProxyMessage(
                'proxy host stdout exceeded 8192 bytes before reporting a socket path',
              ),
            ),
          );
        }
        return;
      }
      const line = stdout.slice(0, newline).trim();
      try {
        const proxyInfo = parseProxyHostLine(line);
        proxyHostHandle.socketPath = proxyInfo.socketPath;
        proxyHostHandle.socketDir = proxyInfo.socketDir;
        settled = true;
        cleanupAfterStartup();
        resolve(proxyHostHandle);
      } catch (error) {
        void fail(new Error(fatalCredentialProxyMessage(error)));
      }
    };

    child.once('error', onError);
    child.once('close', onClose);
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
  });
}

async function createChildEnv(
  startCredentialProxy,
  onUnexpectedExit,
  onProxyCreated,
) {
  if (hasUsableCredentialSocket()) {
    return {
      childEnv: createLauncherChildEnv({}),
      credentialProxy: null,
    };
  }
  const credentialProxy = await startCredentialProxy({
    onUnexpectedExit,
    onProxyCreated,
  });
  return {
    childEnv: createLauncherChildEnv({
      credentialSocketPath: credentialProxy.socketPath,
    }),
    credentialProxy,
  };
}

async function runCliBin(options = {}) {
  const exit = options.exit ?? process.exit;
  const spawnFn = options.spawn ?? spawn;
  const startCredentialProxy =
    options.startCredentialProxy ??
    ((proxyOptions) => createCredentialProxyDefault(proxyOptions));

  function fatalExit(message) {
    process.stderr.write(`${message}\n`);
    exit(43);
  }

  const bunPath =
    options.resolveBun === undefined ? resolveBun() : options.resolveBun();
  if (bunPath === null) {
    fatalExit(
      'Bun runtime was not found. Install it with "npm install" (it is bundled as the "bun" dependency) or install Bun directly from https://bun.sh and ensure it is on your PATH.',
    );
    return;
  }

  const entry =
    options.resolveEntry === undefined
      ? resolveEntry()
      : options.resolveEntry();
  if (entry === null) {
    fatalExit(
      'Could not locate the LLxprt Code TypeScript entry point (packages/cli/index.ts). Your installation may be corrupt; reinstall @vybestack/llxprt-code.',
    );
    return;
  }

  const args = [entry, ...process.argv.slice(2)];
  if (isWindowsCmdShim(bunPath) && args.some(hasWindowsCmdMetaCharacter)) {
    fatalExit(
      'Cannot safely forward arguments containing Windows command-shell metacharacters through the bundled bun.cmd shim. Install Bun directly so bun.exe is on PATH, or remove shell metacharacters from the CLI arguments.',
    );
    return;
  }

  let child;
  let credentialProxy = null;
  let childEnv;
  let settled = false;

  const forwardSignal = (signal) => {
    if (settled) {
      return;
    }
    if (child !== undefined) {
      child.kill(signal);
      return;
    }
    settled = true;
    cleanupListeners();
    void stopCredentialProxy(credentialProxy).finally(() => {
      exit(SIGNAL_EXIT_CODES[signal] ?? 1);
    });
  };
  const cleanupListeners = () => {
    if (child !== undefined) {
      child.off('close', onClose);
      child.off('error', onError);
    }
    for (const signal of FORWARDED_SIGNALS) {
      process.off(signal, forwardSignal);
    }
  };
  const settle = async (callback) => {
    if (settled) {
      return;
    }
    settled = true;
    cleanupListeners();
    child?.on('error', () => {});
    let callbackCalled = false;
    const finish = () => {
      if (callbackCalled) {
        return;
      }
      callbackCalled = true;
      callback();
    };
    const fastExit = (signal) => {
      try {
        child?.kill(signal);
      } catch {
        // Child may have already exited before the second signal arrived.
      }
      finish();
    };
    for (const signal of FORWARDED_SIGNALS) {
      process.once(signal, fastExit);
    }
    try {
      await stopCredentialProxy(credentialProxy);
    } finally {
      for (const signal of FORWARDED_SIGNALS) {
        process.off(signal, fastExit);
      }
    }
    finish();
  };
  const onError = (error) => {
    void settle(() => {
      try {
        child?.kill('SIGTERM');
      } catch {
        // Child may have already exited before the async spawn error surfaced.
      }
      fatalExit(
        `Failed to launch Bun at "${bunPath}" (${describeError(error)}). Reinstall dependencies with "npm install" to restore the bundled Bun, or ensure a working Bun is executable and on your PATH (see https://bun.sh).`,
      );
    }).catch(() => {});
  };
  const onClose = (code, signal) => {
    void settle(() => {
      if (code !== null) {
        exit(code);
        return;
      }
      if (signal !== null) {
        exit(SIGNAL_EXIT_CODES[signal] ?? 1);
        return;
      }
      exit(1);
    }).catch(() => {});
  };
  const onProxyUnexpectedExit = ({ code, signal }) => {
    void settle(() => {
      try {
        child?.kill('SIGTERM');
      } catch {
        // Bun child may have already exited before the proxy died.
      }
      fatalExit(
        fatalCredentialProxyMessage(
          `credential proxy host exited unexpectedly while Bun was running (code=${code}, signal=${signal})`,
        ),
      );
    }).catch(() => {});
  };

  for (const signal of FORWARDED_SIGNALS) {
    process.on(signal, forwardSignal);
  }

  try {
    const envResult = await createChildEnv(
      startCredentialProxy,
      onProxyUnexpectedExit,
      (proxy) => {
        credentialProxy = proxy;
      },
    );
    credentialProxy = envResult.credentialProxy;
    childEnv = envResult.childEnv;
  } catch (error) {
    if (settled) {
      return;
    }
    cleanupListeners();
    fatalExit(describeError(error));
    return;
  }
  if (settled) {
    return;
  }
  try {
    child = spawnFn(bunPath, args, {
      stdio: 'inherit',
      env: childEnv,
      shell: isWindowsCmdShim(bunPath),
    });
  } catch (error) {
    await stopCredentialProxy(credentialProxy);
    fatalExit(
      `Failed to launch Bun at "${bunPath}" (${describeError(error)}). Reinstall dependencies with "npm install" to restore the bundled Bun, or ensure a working Bun is executable and on your PATH (see https://bun.sh).`,
    );
    return;
  }

  child.on('error', onError);
  child.on('close', onClose);
}

module.exports = { runCliBin, createCredentialProxyDefault };

if (require.main === module) {
  runCliBin().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
