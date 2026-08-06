/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DebugLogger, FatalSandboxError } from '@vybestack/llxprt-code-core';
import {
  buildContainerRunArgs,
  setupContainerNetworking,
  setupContainerUser,
  startProxyContainer,
  addContainerEnvVars,
  addContainerVolumeMounts,
} from './sandbox-containers.js';
import { runContainerSandbox } from './sandbox-exec.js';
import {
  getContainerPath,
  resolveSandboxContainerHome,
} from './sandbox-env.js';
import { entrypoint } from './sandbox-entrypoint.js';
import { Storage } from '@vybestack/llxprt-code-storage';

// Explicit factory mock: Bun's automock walks every export of
// node:child_process and hits getters that access private fields
// (this.#stdin), crashing the compat shim. Spread importOriginal so
// everything else in the module graph keeps the real implementations —
// Vitest replaces the entire module namespace with the factory return.
//
// Only execSync and spawn are stubbed: those are the process-launching
// calls these tests must not actually perform. `exec` is deliberately left
// real, because sandbox-containers.ts evaluates promisify(exec) at module
// scope; a stub there would produce an execAsync that never settles and
// would hang the first test to reach that path.
vi.mock('node:child_process', async (importOriginal) => {
  const actual: typeof import('node:child_process') = await importOriginal();
  return {
    ...actual,
    execSync: vi.fn(),
    spawn: vi.fn(),
  };
});

const NETWORK_ENV_KEYS = [
  'LLXPRT_SANDBOX_NETWORK',
  'SANDBOX_NETWORK',
  'LLXPRT_SANDBOX_PROXY_COMMAND',
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'NO_PROXY',
  'no_proxy',
  'SANDBOX_FLAGS',
  'SANDBOX_ENV',
  'VIRTUAL_ENV',
  'NODE_OPTIONS',
  'DEBUG',
] as const;
const PROXIED_NETWORK_ERROR =
  'Sandbox network mode "proxied" requires a non-empty LLXPRT_SANDBOX_PROXY_COMMAND.';
const CONFIG = { command: 'docker', image: 'test' } as const;

function setNetworkEnvironment(
  primary: string | undefined,
  legacy: string | undefined,
  proxyCommand: string | undefined,
): void {
  const values = {
    LLXPRT_SANDBOX_NETWORK: primary,
    SANDBOX_NETWORK: legacy,
    LLXPRT_SANDBOX_PROXY_COMMAND: proxyCommand,
  };
  for (const key of NETWORK_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

function buildArgs(fixturePath: string): string[] {
  return buildContainerRunArgs(
    CONFIG,
    'test-image',
    fixturePath,
    '/workspace',
    fixturePath,
  );
}

function buildThenSetup(fixturePath: string): {
  readonly args: string[];
  readonly proxyCommand: string | undefined;
} {
  const args = buildArgs(fixturePath);
  return {
    args,
    proxyCommand: setupContainerNetworking(args, CONFIG, false),
  };
}

describe.sequential('#1456 container network policy', () => {
  let environmentSnapshot: NodeJS.ProcessEnv;
  let fixturePath = '';

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'container-1456-'));
    vi.resetAllMocks();
    vi.mocked(childProcess.execSync).mockReturnValue(Buffer.from(''));
  });

  afterEach(() => {
    process.env = environmentSnapshot;
    vi.restoreAllMocks();
    if (fixturePath !== '') {
      fs.rmSync(fixturePath, { recursive: true, force: true });
    }
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace', '   '],
  ])(
    'rejects proxied mode with %s command before build-to-setup effects',
    (_label, command) => {
      setNetworkEnvironment('proxied', undefined, command);

      const orchestrate = () => buildThenSetup(fixturePath);
      expect(orchestrate).toThrowError(FatalSandboxError);
      expect(orchestrate).toThrowError(PROXIED_NETWORK_ERROR);
      expect(vi.mocked(childProcess.execSync)).not.toHaveBeenCalled();
    },
  );

  it('rejects legacy-only proxied mode without a command', () => {
    setNetworkEnvironment(undefined, 'proxied', undefined);

    expect(() => buildThenSetup(fixturePath)).toThrowError(
      PROXIED_NETWORK_ERROR,
    );
    expect(vi.mocked(childProcess.execSync)).not.toHaveBeenCalled();
  });

  it('keeps a defined-empty primary authoritative over legacy proxied', () => {
    setNetworkEnvironment('', 'proxied', undefined);

    const { args, proxyCommand } = buildThenSetup(fixturePath);

    expect(proxyCommand).toBeUndefined();
    expect(args).not.toContain('--network');
    expect(vi.mocked(childProcess.execSync)).not.toHaveBeenCalled();
  });

  it('keeps primary "on" authoritative over legacy proxied', () => {
    setNetworkEnvironment('on', 'proxied', undefined);

    const { args, proxyCommand } = buildThenSetup(fixturePath);

    expect(proxyCommand).toBeUndefined();
    expect(args).not.toContain('--network');
    expect(vi.mocked(childProcess.execSync)).not.toHaveBeenCalled();
  });

  it('keeps primary proxied authoritative over legacy off', () => {
    setNetworkEnvironment('proxied', 'off', undefined);

    expect(() => buildThenSetup(fixturePath)).toThrowError(
      PROXIED_NETWORK_ERROR,
    );
    expect(vi.mocked(childProcess.execSync)).not.toHaveBeenCalled();
  });

  it('retains the exact network-off argument pair', () => {
    setNetworkEnvironment('off', undefined, undefined);

    const args = buildArgs(fixturePath);
    const networkIndex = args.indexOf('--network');
    expect(args.slice(networkIndex, networkIndex + 2)).toStrictEqual([
      '--network',
      'none',
    ]);
  });

  it.each(['on', undefined])(
    'retains network %s without a policy flag',
    (mode) => {
      setNetworkEnvironment(mode, undefined, undefined);

      expect(buildArgs(fixturePath)).not.toContain('--network');
    },
  );

  it('runs real build-to-setup orchestration through existing isolated networks', () => {
    const configuredCommand = '  mitmproxy --mode regular  ';
    setNetworkEnvironment('proxied', undefined, configuredCommand);
    const warnSpy = vi.spyOn(DebugLogger.prototype, 'warn');

    const { args, proxyCommand } = buildThenSetup(fixturePath);

    expect(proxyCommand).toBe(configuredCommand);
    expect(args).toContain(
      'HTTPS_PROXY=http://llxprt-code-sandbox-proxy:8877/',
    );
    expect(args).toContain('HTTP_PROXY=http://llxprt-code-sandbox-proxy:8877/');
    const networkIndex = args.indexOf('--network');
    expect(args.filter((argument) => argument === '--network')).toHaveLength(1);
    expect(args.slice(networkIndex, networkIndex + 2)).toStrictEqual([
      '--network',
      'llxprt-code-sandbox',
    ]);
    expect(vi.mocked(childProcess.execSync)).toHaveBeenCalledWith(
      'docker network inspect llxprt-code-sandbox || docker network create --internal llxprt-code-sandbox',
    );
    expect(vi.mocked(childProcess.execSync)).toHaveBeenCalledWith(
      'docker network inspect llxprt-code-sandbox-proxy || docker network create llxprt-code-sandbox-proxy',
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

const CONTAINER_ENV_VARS = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'GOOGLE_GENAI_USE_GCA',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'GEMINI_MODEL',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'TERM',
  'COLORTERM',
  'SANDBOX_ENV',
  'VIRTUAL_ENV',
  'NODE_OPTIONS',
  'LLXPRT_SANDBOX_MOUNTS',
  'SANDBOX_MOUNTS',
] as const;

const ENV_CONFIG = { command: 'docker', image: 'test' } as const;

describe.sequential('#2946 container credential isolation', () => {
  let environmentSnapshot: NodeJS.ProcessEnv;
  let tempDirs: string[] = [];

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    tempDirs = [];
    for (const key of CONTAINER_ENV_VARS) delete process.env[key];
  });

  afterEach(() => {
    process.env = environmentSnapshot;
    vi.restoreAllMocks();
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not forward GEMINI_API_KEY or GOOGLE_API_KEY into the container env', () => {
    process.env.GEMINI_API_KEY = 'sentinel-gemini-key-2946';
    process.env.GOOGLE_API_KEY = 'sentinel-google-key-2946';

    const args: string[] = [];
    addContainerEnvVars(args, ENV_CONFIG, 'test-container', [], '/workspace');

    expect(args.some((arg) => arg.startsWith('GEMINI_API_KEY='))).toBe(false);
    expect(args.some((arg) => arg.startsWith('GOOGLE_API_KEY='))).toBe(false);
    const joined = args.join(' ');
    expect(joined).not.toContain('sentinel-gemini-key-2946');
    expect(joined).not.toContain('sentinel-google-key-2946');
  });

  it('still forwards non-secret Vertex/Gemini configuration vars', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'my-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
    process.env.GOOGLE_GENAI_USE_GCA = 'true';
    process.env.GEMINI_MODEL = 'gemini-2.5-pro';

    const args: string[] = [];
    addContainerEnvVars(args, ENV_CONFIG, 'test-container', [], '/workspace');

    // Parse --env flag/value PAIRS: for each --env take the next element as
    // the operand. This rejects an implementation that emits unpaired values.
    const envPairs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--env' && i + 1 < args.length) {
        envPairs.push(args[i + 1]);
      }
    }
    expect(envPairs).toContain('GOOGLE_CLOUD_PROJECT=my-project');
    expect(envPairs).toContain('GOOGLE_CLOUD_LOCATION=us-central1');
    expect(envPairs).toContain('GOOGLE_GENAI_USE_VERTEXAI=true');
    expect(envPairs).toContain('GOOGLE_GENAI_USE_GCA=true');
    expect(envPairs).toContain('GEMINI_MODEL=gemini-2.5-pro');
  });

  // Guards against the opposite failure mode: a blanket blocklist keyed on a
  // GEMINI_/GOOGLE_ prefix would drop the secrets but take the non-secret
  // configuration with it. Both kinds must be set at once to catch that.
  it('drops only the secrets when secret and non-secret vars are set together', () => {
    process.env.GEMINI_API_KEY = 'sentinel-gemini-key-2946';
    process.env.GOOGLE_API_KEY = 'sentinel-google-key-2946';
    process.env.GOOGLE_CLOUD_PROJECT = 'my-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';

    const args: string[] = [];
    addContainerEnvVars(args, ENV_CONFIG, 'test-container', [], '/workspace');

    const envPairs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--env' && i + 1 < args.length) {
        envPairs.push(args[i + 1]);
      }
    }
    expect(envPairs).toContain('GOOGLE_CLOUD_PROJECT=my-project');
    expect(envPairs).toContain('GOOGLE_CLOUD_LOCATION=us-central1');
    expect(envPairs).toContain('GOOGLE_GENAI_USE_VERTEXAI=true');
    expect(envPairs.some((pair) => pair.startsWith('GEMINI_API_KEY='))).toBe(
      false,
    );
    expect(envPairs.some((pair) => pair.startsWith('GOOGLE_API_KEY='))).toBe(
      false,
    );
    const joined = args.join(' ');
    expect(joined).not.toContain('sentinel-gemini-key-2946');
    expect(joined).not.toContain('sentinel-google-key-2946');
  });

  it('does not mount the gcloud config directory', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gcloud-home-'));
    tempDirs.push(fakeHome);
    fs.mkdirSync(path.join(fakeHome, '.config', 'gcloud'), {
      recursive: true,
    });
    vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const args: string[] = [];
    addContainerVolumeMounts(args);

    const gcloudPath = path.join(fakeHome, '.config', 'gcloud');
    // Inspect only the operand that follows each --volume flag, so unrelated
    // mounts are permitted while a gcloud mount still fails the test.
    const volumeOperands: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--volume' && i + 1 < args.length) {
        volumeOperands.push(args[i + 1]);
      }
    }
    expect(volumeOperands.some((spec) => spec.includes(gcloudPath))).toBe(
      false,
    );
    expect(args.join(' ')).not.toContain(gcloudPath);
  });

  it('does not mount the GOOGLE_APPLICATION_CREDENTIALS file or re-export it', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adc-'));
    tempDirs.push(tmpDir);
    const adcFile = path.join(tmpDir, 'service-account.json');
    fs.writeFileSync(adcFile, '{"type":"service_account"}');
    process.env.GOOGLE_APPLICATION_CREDENTIALS = adcFile;

    const args: string[] = [];
    addContainerVolumeMounts(args);

    expect(args.join(' ')).not.toContain(adcFile);
    expect(
      args.some((arg) => arg.startsWith('GOOGLE_APPLICATION_CREDENTIALS=')),
    ).toBe(false);
  });

  it('still mounts paths from LLXPRT_SANDBOX_MOUNTS (regression guard)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-mount-'));
    tempDirs.push(tmpDir);
    process.env.LLXPRT_SANDBOX_MOUNTS = tmpDir;

    const args: string[] = [];
    addContainerVolumeMounts(args);

    expect(args).toContain('--volume');
    expect(args).toContain(`${tmpDir}:${tmpDir}:ro`);
  });

  it('still mounts paths from legacy SANDBOX_MOUNTS name (regression guard)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-mount-'));
    tempDirs.push(tmpDir);
    process.env.SANDBOX_MOUNTS = tmpDir;

    const args: string[] = [];
    addContainerVolumeMounts(args);

    expect(args).toContain('--volume');
    expect(args).toContain(`${tmpDir}:${tmpDir}:ro`);
  });
});

const HARDENING_ENV_KEYS = [
  'SANDBOX_FLAGS',
  'SANDBOX_SET_UID_GID',
  'LLXPRT_CODE_INTEGRATION_TEST',
] as const;

describe.sequential('#2902 sandbox privilege hardening', () => {
  let environmentSnapshot: NodeJS.ProcessEnv;
  let fixturePath = '';

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'container-2902-'));
    vi.resetAllMocks();
    // current-user path calls `id -u` / `id -g` via execSync; stub to empty
    // so the path completes without a real shell. The cap-add values under
    // test do not depend on uid/gid.
    vi.mocked(childProcess.execSync).mockReturnValue(Buffer.from(''));
    for (const key of HARDENING_ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    process.env = environmentSnapshot;
    vi.restoreAllMocks();
    if (fixturePath !== '') {
      fs.rmSync(fixturePath, { recursive: true, force: true });
    }
  });

  it('emits --security-opt no-new-privileges on every container run (AC1)', () => {
    const args = buildArgs(fixturePath);

    const secIdx = args.indexOf('--security-opt');
    expect(secIdx).toBeGreaterThanOrEqual(0);
    expect(args[secIdx + 1]).toBe('no-new-privileges');
  });

  it('emits --cap-drop=ALL on every container run (AC2)', () => {
    const args = buildArgs(fixturePath);

    expect(args).toContain('--cap-drop=ALL');
  });

  it('places --cap-drop=ALL before SANDBOX_FLAGS so a user can add caps back (AC7)', () => {
    process.env.SANDBOX_FLAGS = '--cap-add=NET_ADMIN';

    const args = buildArgs(fixturePath);

    const capDropIdx = args.indexOf('--cap-drop=ALL');
    const netAdminIdx = args.indexOf('--cap-add=NET_ADMIN');
    expect(capDropIdx).toBeGreaterThanOrEqual(0);
    expect(netAdminIdx).toBeGreaterThan(capDropIdx);
  });

  it('adds back exactly the three minimal current-user capabilities and nothing more (AC3)', async () => {
    process.env.SANDBOX_SET_UID_GID = 'true';

    const args = buildArgs(fixturePath);
    await setupContainerUser(args, ['sh', '-c', 'true']);

    const capAdds = args
      .filter((a) => a.startsWith('--cap-add='))
      .map((a) => a.slice('--cap-add='.length));
    expect(capAdds).toStrictEqual(['CHOWN', 'SETUID', 'SETGID']);
  });

  it('keeps --user root on the current-user path (AC5)', async () => {
    process.env.SANDBOX_SET_UID_GID = 'true';

    const args = buildArgs(fixturePath);
    await setupContainerUser(args, ['sh', '-c', 'true']);

    const userIdx = args.indexOf('--user');
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(args[userIdx + 1]).toBe('root');
  });

  it('does not set --user when LLXPRT_CODE_INTEGRATION_TEST is set and the current-user path is not taken (AC4)', async () => {
    // Force the non-current-user path deterministically: on Debian/Ubuntu
    // Linux CI, shouldUseCurrentUserInSandbox() returns true by default, which
    // would take the current-user branch and push --user root. SANDBOX_SET_UID_GID
    // is authoritative (checked before the distro auto-detect) and host-independent.
    process.env.SANDBOX_SET_UID_GID = 'false';
    // The obsolete LLXPRT_CODE_INTEGRATION_TEST must have no effect.
    process.env.LLXPRT_CODE_INTEGRATION_TEST = 'true';

    const args = buildArgs(fixturePath);
    const userFlag = await setupContainerUser(args, ['sh', '-c', 'true']);

    expect(userFlag).toBe('');
    expect(args).not.toContain('--user');
  });

  it('applies the base hardening flags to the proxy sidecar argv (AC2)', async () => {
    // startProxyContainer builds a second `run` argv that previously bypassed
    // the hardening. spawn is stubbed to throw immediately so the function
    // rejects before performing I/O, while the call args are recorded.
    vi.mocked(childProcess.spawn).mockImplementation(() => {
      throw new Error('proxy-argv-captured');
    });

    await expect(
      startProxyContainer(CONFIG, 'echo proxy', '', 'test-image', '/workspace'),
    ).rejects.toThrow('proxy-argv-captured');

    const spawnCalls = vi.mocked(childProcess.spawn).mock.calls;
    expect(spawnCalls.length).toBeGreaterThan(0);
    const proxyArgs = spawnCalls[0][1];
    expect(proxyArgs).toContain('--cap-drop=ALL');
    const secIdx = proxyArgs.indexOf('--security-opt');
    expect(secIdx).toBeGreaterThanOrEqual(0);
    expect(proxyArgs[secIdx + 1]).toBe('no-new-privileges');
  });

  it('keeps the base hardening flags alongside a non-empty userFlag on the proxy sidecar', async () => {
    // The proxy sidecar has always forwarded setupContainerUser's userFlag
    // (unchanged by this PR). Assert that the hardening flags coexist with it
    // and that the user selection is still passed through intact.
    vi.mocked(childProcess.spawn).mockImplementation(() => {
      throw new Error('proxy-argv-captured');
    });

    await expect(
      startProxyContainer(
        CONFIG,
        'echo proxy',
        '--user 501:20',
        'test-image',
        '/workspace',
      ),
    ).rejects.toThrow('proxy-argv-captured');

    const proxyArgs = vi.mocked(childProcess.spawn).mock.calls[0][1];
    expect(proxyArgs).toContain('--cap-drop=ALL');
    const secIdx = proxyArgs.indexOf('--security-opt');
    expect(proxyArgs[secIdx + 1]).toBe('no-new-privileges');
    const userIdx = proxyArgs.indexOf('--user');
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(proxyArgs[userIdx + 1]).toBe('501:20');
  });
});

// Parsing helpers that operate on the produced docker argv. They look only at
// the real buildContainerRunArgs output — no mocks — so the assertions pin the
// observable container behaviour, not a stub's call arguments.
function volumeDestinations(args: readonly string[]): string[] {
  const dests: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--volume' && i + 1 < args.length) {
      const parts = args[i + 1].split(':');
      // [host, dest] or [host, dest, options]
      if (parts.length >= 2) dests.push(parts[1]);
    }
  }
  return dests;
}

function envValue(args: readonly string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && i + 1 < args.length) {
      const pair = args[i + 1];
      if (pair.startsWith(`${name}=`)) return pair.slice(name.length + 1);
    }
  }
  return undefined;
}

function entrypointScript(workdir: string): string {
  // The final element of entrypoint()'s returned argv is the shell script the
  // container runs. cliArgs is [cli, subcommand, ...userArgs].
  return String(entrypoint(workdir, ['llxprt', 'chat']).at(-1));
}

function xdgDefaultFromScript(script: string, name: string): string {
  // Extracts the value from `export NAME="VALUE"`. Uses string indexOf so the
  // $/${} metacharacters need no escaping.
  const prefix = 'export ' + name + '="';
  const start = script.indexOf(prefix);
  if (start === -1) {
    throw new Error(`${name} export not found in entrypoint script`);
  }
  const valueStart = start + prefix.length;
  const end = script.indexOf('"', valueStart);
  if (end === -1) {
    throw new Error(`${name} export not found in entrypoint script`);
  }
  return script.slice(valueStart, end);
}

const CANONICAL_CONFIG_MOUNT_ENV_KEYS = [
  'SANDBOX_SET_UID_GID',
  'LLXPRT_CONFIG_HOME',
  'LLXPRT_DATA_HOME',
  'LLXPRT_CACHE_HOME',
  'LLXPRT_LOG_HOME',
] as const;

describe.sequential('#3081 canonical config mount + env pinning', () => {
  let environmentSnapshot: NodeJS.ProcessEnv;
  let fixturePath = '';

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'container-3081-'));
    vi.resetAllMocks();
    vi.mocked(childProcess.execSync).mockReturnValue(Buffer.from(''));
    // Force the non-current-user path deterministically: the Debian/Ubuntu
    // auto-detect makes shouldUseCurrentUserInSandbox return true on some
    // CI hosts. containerHome is then /home/node regardless of host.
    process.env.SANDBOX_SET_UID_GID = 'false';
    for (const key of CANONICAL_CONFIG_MOUNT_ENV_KEYS) {
      if (key !== 'SANDBOX_SET_UID_GID') delete process.env[key];
    }
    delete process.env.SANDBOX_ENV;
  });

  afterEach(() => {
    process.env = environmentSnapshot;
    vi.restoreAllMocks();
    if (fixturePath !== '') {
      fs.rmSync(fixturePath, { recursive: true, force: true });
    }
  });

  it('mounts the config dir at path parity and emits no legacy dot-llxprt destination', () => {
    const args = buildArgs(fixturePath);
    const hostConfigDir = Storage.getGlobalConfigDir();
    const containerConfigDir = getContainerPath(hostConfigDir);

    // The canonical mount is present at path parity...
    expect(args).toContain('--volume');
    expect(args).toContain(`${hostConfigDir}:${containerConfigDir}`);
    // ...and the legacy destination is gone from every volume destination.
    const dests = volumeDestinations(args);
    expect(dests.every((d) => !d.endsWith('/.llxprt'))).toBe(true);
  });

  it('pins LLXPRT_CONFIG_HOME to the config mount destination', () => {
    const args = buildArgs(fixturePath);
    const containerConfigDir = getContainerPath(Storage.getGlobalConfigDir());

    expect(envValue(args, 'LLXPRT_CONFIG_HOME')).toBe(containerConfigDir);
  });

  it('pins DATA/CACHE/LOG homes from the container HOME inside the entrypoint', () => {
    // After fix #4 the three ephemeral roots are exported from $HOME inside
    // the entrypoint (not passed as --env from the host), so they follow the
    // image's real container HOME. Verify the entrypoint script carries all
    // three exports with the correct distinct $HOME-relative suffixes.
    const script = entrypointScript(fixturePath);
    const data = xdgDefaultFromScript(script, 'LLXPRT_DATA_HOME');
    const cache = xdgDefaultFromScript(script, 'LLXPRT_CACHE_HOME');
    const log = xdgDefaultFromScript(script, 'LLXPRT_LOG_HOME');

    expect(data).toBe('$HOME/.local/share/llxprt-code');
    expect(cache).toBe('$HOME/.cache/llxprt-code');
    expect(log).toBe('$HOME/.local/state/llxprt-code');
    // Pairwise distinct, so data/cache/log never collapse into one directory.
    expect(new Set([data, cache, log]).size).toBe(3);
  });

  it('does not emit DATA/CACHE/LOG homes as --env from the host', () => {
    // They moved to the entrypoint; none may appear in the host-built argv.
    const args = buildArgs(fixturePath);
    expect(envValue(args, 'LLXPRT_DATA_HOME')).toBeUndefined();
    expect(envValue(args, 'LLXPRT_CACHE_HOME')).toBeUndefined();
    expect(envValue(args, 'LLXPRT_LOG_HOME')).toBeUndefined();
  });

  it('drives the config mount from LLXPRT_CONFIG_HOME at call time (regression for frozen constant)', () => {
    // Fix #3 made the config dir read dynamically; setting the env var must
    // actually change the emitted mount (it was inert against the frozen
    // module-load-time constant before). Use a DISTINCT temp dir so the value
    // is absolute, valid and provably different from the workdir/tmpdir mount.
    const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-3081-'));
    process.env.LLXPRT_CONFIG_HOME = configHome;
    try {
      const args = buildArgs(fixturePath);
      const expectedContainer = getContainerPath(configHome);

      expect(args).toContain(`${configHome}:${expectedContainer}`);
      expect(envValue(args, 'LLXPRT_CONFIG_HOME')).toBe(expectedContainer);
    } finally {
      delete process.env.LLXPRT_CONFIG_HOME;
      fs.rmSync(configHome, { recursive: true, force: true });
    }
  });

  it('covers the resolved config dir with an emitted --volume destination', () => {
    // The original bug: the destination the CLI resolved inside the container
    // was NOT covered by any --volume mount. Compute the expectation via the
    // REAL resolver (independent of the argv the function just produced), then
    // assert the resolver's answer is present among the volume destinations.
    const args = buildArgs(fixturePath);
    const emitted = envValue(args, 'LLXPRT_CONFIG_HOME');
    expect(emitted).toBeDefined();
    process.env.LLXPRT_CONFIG_HOME = emitted;
    const resolved = Storage.getGlobalConfigDir();
    expect(volumeDestinations(args)).toContain(resolved);
  });

  it('emitted LLXPRT_CONFIG_HOME satisfies Storage.isNonEmptyAbsoluteOverride', () => {
    // That override check is what short-circuits the phantom in-container
    // startup migration. Pin it so a non-absolute / relative value would fail.
    const args = buildArgs(fixturePath);
    const emitted = envValue(args, 'LLXPRT_CONFIG_HOME');
    expect(emitted).toBeDefined();
    expect(Storage.isNonEmptyAbsoluteOverride(emitted)).toBe(true);
  });

  it.each([
    'LLXPRT_CONFIG_HOME',
    'LLXPRT_DATA_HOME',
    'LLXPRT_CACHE_HOME',
    'LLXPRT_LOG_HOME',
  ])('rejects a SANDBOX_ENV override of pinned %s', (reservedKey) => {
    process.env.SANDBOX_ENV = `FOO=bar,${reservedKey}=/evil/override,BAZ=qux`;
    const args = buildArgs(fixturePath);

    // addContainerEnvVars runs after buildContainerRunArgs in the real flow.
    expect(() =>
      addContainerEnvVars(args, ENV_CONFIG, 'test-container', [], '/workspace'),
    ).toThrowError(FatalSandboxError);
    expect(() =>
      addContainerEnvVars(args, ENV_CONFIG, 'test-container', [], '/workspace'),
    ).toThrowError(
      new RegExp(`may not override reserved key '${reservedKey}'`),
    );
  });

  it('rejects reserved SANDBOX_ENV before image or network side effects', async () => {
    process.env.SANDBOX_ENV = 'LLXPRT_CONFIG_HOME=/evil/override';

    await expect(runContainerSandbox(CONFIG, [])).rejects.toThrowError(
      /may not override reserved key 'LLXPRT_CONFIG_HOME'/,
    );
    expect(vi.mocked(childProcess.execSync)).not.toHaveBeenCalled();
  });

  it('translates Windows host paths: no backslash in emitted config home or entrypoint roots', () => {
    // With the host platform stubbed to win32, every emitted LLXPRT_*_HOME
    // value must be POSIX (no backslashes); the /c/... translation form is
    // pinned directly against getContainerPath in sandbox-env.bun.ts.
    vi.spyOn(os, 'platform').mockReturnValue('win32');
    const args = buildArgs(fixturePath);

    const configHome = envValue(args, 'LLXPRT_CONFIG_HOME');
    expect(configHome).toBeDefined();
    expect(configHome).not.toMatch(/\\/);
    const script = entrypointScript(fixturePath);
    for (const name of [
      'LLXPRT_DATA_HOME',
      'LLXPRT_CACHE_HOME',
      'LLXPRT_LOG_HOME',
    ]) {
      expect(xdgDefaultFromScript(script, name)).not.toMatch(/\\/);
    }
  });
});

describe.sequential('#3081 current-user container-home agreement', () => {
  let environmentSnapshot: NodeJS.ProcessEnv;
  let fixturePath = '';

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'container-3081-cu-'));
    vi.resetAllMocks();
    vi.mocked(childProcess.execSync).mockReturnValue(Buffer.from(''));
    process.env.SANDBOX_SET_UID_GID = '1';
    for (const key of CANONICAL_CONFIG_MOUNT_ENV_KEYS) {
      if (key !== 'SANDBOX_SET_UID_GID') delete process.env[key];
    }
    delete process.env.SANDBOX_ENV;
  });

  afterEach(() => {
    process.env = environmentSnapshot;
    vi.restoreAllMocks();
    if (fixturePath !== '') {
      fs.rmSync(fixturePath, { recursive: true, force: true });
    }
  });

  it('pins HOME and the entrypoint ephemeral roots to the host home, keeping CONFIG_HOME on the mount', async () => {
    const args = buildArgs(fixturePath);
    // Capture the clean entrypoint script before setupContainerUser wraps it
    // in `su -p`; its $HOME-relative exports are what the exec'd CLI inherits.
    const finalEntrypoint = entrypoint(fixturePath, ['llxprt', 'chat']);
    const cleanScript = String(finalEntrypoint.at(-1));
    await setupContainerUser(args, finalEntrypoint);

    const home = envValue(args, 'HOME');
    const expectedHome = resolveSandboxContainerHome();
    expect(home).toBe(expectedHome);
    expect(expectedHome).toBe(getContainerPath(os.homedir()));

    // The three ephemeral roots are derived from that HOME, so the HOME pinned
    // here and the entrypoint's $HOME-relative defaults can never disagree.
    expect(cleanScript).toContain('$HOME/.local/share/llxprt-code');
    expect(cleanScript).toContain('$HOME/.cache/llxprt-code');
    expect(cleanScript).toContain('$HOME/.local/state/llxprt-code');

    // LLXPRT_CONFIG_HOME still points at the config bind mount, not the home.
    const configHome = envValue(args, 'LLXPRT_CONFIG_HOME');
    expect(configHome).toBe(getContainerPath(Storage.getGlobalConfigDir()));
    expect(volumeDestinations(args)).toContain(configHome);

    // The current-user branch was actually taken (the other branch is covered
    // by the #3081 canonical config mount describe above).
    expect(args).toContain('--user');
    expect(args[args.indexOf('--user') + 1]).toBe('root');
  });
});
