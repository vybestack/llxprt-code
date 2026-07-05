#!/usr/bin/env node
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const { accessSync, constants, readFileSync, statSync } = require('node:fs');
const { basename, dirname, join } = require('node:path');

const RELAUNCH_ENV = 'LLXPRT_BUN_RELAUNCHED';
const CREDENTIAL_SOCKET_ENV = 'LLXPRT_CREDENTIAL_SOCKET';
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

function stopProxyHost(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null || child.killed) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.off('close', finish);
      try {
        child.kill('SIGKILL');
      } catch {
        // Process may have already exited before the close event was delivered.
      }
      resolve();
    }, PROXY_HOST_SHUTDOWN_TIMEOUT_MS);
    child.once('close', finish);
    try {
      child.kill('SIGTERM');
    } catch {
      finish();
    }
  });
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
  return parsed.socketPath;
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
      stop: async () => {
        stopping = true;
        child.off('close', onPostStartupClose);
        child.off('error', absorbLateChildError);
        await stopProxyHost(child);
      },
    };
    onProxyCreated(proxyHostHandle);

    const fail = async (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      await stopProxyHost(child).catch(() => {});
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
        const socketPath = parseProxyHostLine(line);
        proxyHostHandle.socketPath = socketPath;
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
  const existingSocket = process.env[CREDENTIAL_SOCKET_ENV];
  if (existingSocket !== undefined && existingSocket.length > 0) {
    return {
      childEnv: { ...process.env, [RELAUNCH_ENV]: 'true' },
      credentialProxy: null,
    };
  }
  const credentialProxy = await startCredentialProxy({
    onUnexpectedExit,
    onProxyCreated,
  });
  return {
    childEnv: {
      ...process.env,
      [RELAUNCH_ENV]: 'true',
      [CREDENTIAL_SOCKET_ENV]: credentialProxy.socketPath,
    },
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
