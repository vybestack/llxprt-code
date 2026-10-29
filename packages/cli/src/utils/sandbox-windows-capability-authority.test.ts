/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the capability delivery path a WINDOWS host uses
 * (#3841 review item E11). On Windows the sandbox is a Linux container, so the
 * host cannot hand the CLI a descriptor of its own: it writes `capability.env`
 * and Docker/Podman load it with `--env-file`. Inside the container the trusted
 * entrypoint's env branch captures `LLXPRT_CAPABILITY_TOKEN`, unsets the
 * transport variables, re-opens descriptor 3, and execs the CLI. Everything
 * after the host file runs under bash in Linux, so this suite drives that
 * stretch on macOS and Linux CI: the host producer is real
 * (`createHostOnlyCapabilityEnvFile`), the entrypoint is the REAL generated
 * command array (which composes CAPABILITY_CAPTURE_STANZA verbatim), and the
 * consumer is the real `HostCredentialOwner` in a spawned Bun process standing
 * in for the CLI.
 *
 * Native Windows is skipped: it has no bash and no POSIX descriptor for fd 3.
 * The host-side producer is covered there by sandbox-capability.test.ts.
 *
 * @plan PLAN-20261023-PR3911FIX.R-E11
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORAGE_ENV_KEYS } from '@vybestack/llxprt-code-storage/testing';
import { createHostOnlyCapabilityEnvFile } from './sandbox-capability.js';
import { entrypoint } from './sandbox-entrypoint.js';
import { CredentialProxyServer } from '../../../providers/src/auth/proxy/credential-proxy-server.js';
import {
  InMemoryProviderKeyStorage,
  InMemoryTokenStore,
  makeToken,
} from '../../../providers/src/auth/proxy/__tests__/credential-proxy-server-helpers.js';

/** bash and descriptor 3 exist on every non-Windows runner. */
const posixDescriptorHost = process.platform !== 'win32';

/** 64 lowercase hex characters, the only shape the consumer accepts. */
const VALID_TOKEN = 'a1b2'.repeat(16);

const PROVIDER_KEY_NAME = 'primary';
const PROVIDER_KEY_VALUE = 'primary-key-through-env-file';

/**
 * Control variable proving the child's environment dump really reaches the
 * environment it was exec'd with, so "token absent from the dump" cannot pass
 * because the dump came back empty or truncated.
 */
const SENTINEL_KEY = 'LLXPRT_CAPABILITY_TEST_ENV_SENTINEL';

const childScriptPath = fileURLToPath(
  new URL('./__tests__/capability-env-file-child.ts', import.meta.url),
);

interface ConsumerReport {
  markerBeforeOwner: string | null;
  markerGone: boolean;
  descriptorClosed: boolean;
  envTokenAbsent: boolean;
  environmentDump: string;
  serialized: string;
  error?: string | null;
  tokenType?: string;
  key?: string | null;
  brokerKey?: unknown;
}

interface Delivery {
  readonly command: string[];
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly envFilePath: string;
  readonly sentinel: string;
  readonly release: () => void;
}

interface ProxyHandle {
  readonly socketPath: string;
  readonly stop: () => Promise<void>;
}

/**
 * Reads the env file the way `docker --env-file` and `podman --env-file` do:
 * one KEY=VALUE per line, blank lines and `#` comments ignored, split at the
 * FIRST `=`. Docker does no quote processing, so neither does this.
 */
function parseDockerEnvFile(envFilePath: string): Record<string, string> {
  const assignments: Record<string, string> = {};
  const lines = fs
    .readFileSync(envFilePath, 'utf8')
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'));
  for (const line of lines) {
    const separator = line.indexOf('=');
    if (separator <= 0) {
      throw new Error(`Env-file line has no KEY=VALUE form: ${line}`);
    }
    assignments[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return assignments;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** A PATH-discoverable `llxprt` that runs the Bun consumer script. */
function installCliShim(binDir: string): void {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(binDir, 'llxprt'),
    [
      '#!/usr/bin/env bash',
      `exec ${shellQuote(process.execPath)} ${shellQuote(childScriptPath)} "$@"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
}

/**
 * The environment every spawned child runs with. An explicit env object on
 * spawn snapshots the test process's ORIGINAL environment, so the storage
 * isolation preload's post-startup assignments are carried explicitly; without
 * them a spawned child resolves the developer's real config root.
 */
function withIsolatedStorageRoots(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  for (const key of STORAGE_ENV_KEYS) {
    const isolated = process.env[key];
    if (isolated !== undefined) {
      childEnv[key] = isolated;
    }
  }
  return childEnv;
}

async function startProxy(capabilityToken: string): Promise<ProxyHandle> {
  const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-authority-'));
  const tokens = new InMemoryTokenStore();
  const keys = new InMemoryProviderKeyStorage();
  await tokens.saveToken('test', makeToken());
  await keys.saveKey(PROVIDER_KEY_NAME, PROVIDER_KEY_VALUE);
  const server = new CredentialProxyServer({
    tokenStore: tokens,
    providerKeyStorage: keys,
    socketDir,
    capabilityToken,
  });
  const socketPath = await server.start();
  return {
    socketPath,
    stop: async () => {
      await server.stop();
      fs.rmSync(socketDir, { recursive: true, force: true });
    },
  };
}

describe('windows capability delivery through capability.env', () => {
  let tmpDir = '';
  let binDir = '';
  let workdir = '';
  let containerHome = '';
  let environmentSnapshot: NodeJS.ProcessEnv;

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    delete process.env.SANDBOX_PORTS;
    delete process.env.DEBUG;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-envfile-'));
    binDir = path.join(tmpDir, 'bin');
    workdir = path.join(tmpDir, 'workdir');
    containerHome = path.join(tmpDir, 'container-home');
    fs.mkdirSync(workdir);
    fs.mkdirSync(containerHome);
    installCliShim(binDir);
  });

  afterEach(() => {
    process.env = environmentSnapshot;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Builds the Windows-equivalent delivery. The host producer writes
   * capability.env; its assignments are loaded the way `--env-file` loads them;
   * `LLXPRT_CREDENTIAL_SOCKET` is added the way sandbox-credential-proxy.ts adds
   * it with `--env`; and the trusted entrypoint command array is generated for a
   * PATH-discoverable `llxprt`. HOME points inside the temp tree because the
   * container has its own home, which keeps the entrypoint's pinned data roots
   * out of the real one.
   */
  function createDelivery(
    token: string,
    socketPath: string | undefined,
    mode: string,
  ): Delivery {
    const result = createHostOnlyCapabilityEnvFile(token, []);
    if (result === undefined) {
      throw new Error('Expected a capability env file result');
    }
    const sentinel = `env-visible-${String(Date.now())}-${String(
      Math.random(),
    ).slice(2)}`;
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.LLXPRT_CAPABILITY_FD;
    delete env.LLXPRT_CAPABILITY_TOKEN;
    delete env.LLXPRT_CREDENTIAL_SOCKET;
    Object.assign(env, parseDockerEnvFile(result.envFilePath));
    env[SENTINEL_KEY] = sentinel;
    env.HOME = containerHome;
    env.PATH = `${binDir}:${process.env.PATH ?? ''}`;
    if (socketPath !== undefined) {
      env.LLXPRT_CREDENTIAL_SOCKET = socketPath;
    }
    return {
      command: entrypoint(workdir, ['llxprt', 'run', mode]),
      env,
      cwd: workdir,
      envFilePath: result.envFilePath,
      sentinel,
      release: result.cleanup,
    };
  }

  /**
   * Runs the generated entrypoint and collects the child's report. The child is
   * spawned asynchronously on purpose: this process also hosts the credential
   * proxy socket the child authenticates against, so a synchronous spawn would
   * block the event loop that has to answer those requests.
   */
  async function runDelivery(delivery: Delivery): Promise<{
    stdout: string;
    stderr: string;
    exit: number;
  }> {
    const child = spawn(delivery.command[0], delivery.command.slice(1), {
      env: withIsolatedStorageRoots(delivery.env),
      cwd: delivery.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    const exit = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Capability delivery timed out; stderr: ${stderr}`));
      }, 60_000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        resolve(code ?? -1);
      });
    });
    return { stdout, stderr, exit };
  }

  async function parseReport(
    run: Promise<{
      stdout: string;
      stderr: string;
      exit: number;
    }>,
  ): Promise<ConsumerReport> {
    const result = await run;
    expect(result.stderr).toBe('');
    expect(result.exit).toBe(0);
    return JSON.parse(result.stdout) as ConsumerReport;
  }

  it.skipIf(!posixDescriptorHost)(
    'carries the env-file token through the trusted entrypoint to the consumer and authenticates every request',
    async () => {
      const proxy = await startProxy(VALID_TOKEN);
      const delivery = createDelivery(
        VALID_TOKEN,
        proxy.socketPath,
        'requests',
      );
      try {
        // The host half: the env file holds the one assignment docker loads,
        // and the token reaches the container through the environment, never
        // through the container argv.
        expect(parseDockerEnvFile(delivery.envFilePath)).toStrictEqual({
          LLXPRT_CAPABILITY_TOKEN: VALID_TOKEN,
        });
        expect(delivery.env.LLXPRT_CAPABILITY_TOKEN).toBe(VALID_TOKEN);
        expect(delivery.command.join('\n')).not.toContain(VALID_TOKEN);

        const report = await parseReport(runDelivery(delivery));

        // The entrypoint's final exec delivered the marker and a descriptor,
        // and the consumer consumed both before any request went out.
        expect(report.markerBeforeOwner).toBe('3');
        expect(report.markerGone).toBe(true);
        expect(report.descriptorClosed).toBe(true);
        // The token never came back out of the transport.
        expect(report.envTokenAbsent).toBe(true);
        expect(report.environmentDump).toContain(delivery.sentinel);
        expect(report.environmentDump).not.toContain('LLXPRT_CAPABILITY_TOKEN');
        expect(report.environmentDump).not.toContain(VALID_TOKEN);
        // A wrong or truncated token fails the proxy handshake, so a
        // successful token, key and broker round trip proves the token arrived
        // whole and authenticated those requests.
        expect(report).toMatchObject({
          tokenType: 'Bearer',
          key: PROVIDER_KEY_VALUE,
          brokerKey: PROVIDER_KEY_VALUE,
          serialized: '{}',
        });
      } finally {
        delivery.release();
        await proxy.stop();
      }
    },
  );

  it.skipIf(!posixDescriptorHost).each([
    ['a 63-character', 'a'.repeat(63)],
    ['a 65-character', 'a'.repeat(65)],
    ['an uppercase', 'A'.repeat(64)],
  ])(
    'rejects %s capability at the consumer while still closing the descriptor',
    async (_label, token) => {
      const proxy = await startProxy(token);
      const delivery = createDelivery(token, proxy.socketPath, 'capture');
      try {
        const report = await parseReport(runDelivery(delivery));

        expect(report.error).toBe(
          'Capability descriptor does not contain a valid 64-character lowercase hex token with the transport delimiter',
        );
        expect(report.markerBeforeOwner).toBe('3');
        expect(report.markerGone).toBe(true);
        expect(report.descriptorClosed).toBe(true);
        expect(report.envTokenAbsent).toBe(true);
      } finally {
        delivery.release();
        await proxy.stop();
      }
    },
  );

  it.each([
    ['an equals sign', `${'a'.repeat(63)}=`],
    ['a newline', `${'a'.repeat(63)}\n`],
    ['a carriage return', `${'a'.repeat(63)}\r`],
  ])(
    'rejects a capability containing %s at the producer before writing an env file',
    (_label, token) => {
      expect(() => createHostOnlyCapabilityEnvFile(token, [])).toThrow(
        'Capability token contains invalid characters for env file',
      );
    },
  );

  it.skipIf(!posixDescriptorHost)(
    'fails with the transport error when the container has no credential socket',
    async () => {
      const delivery = createDelivery(VALID_TOKEN, undefined, 'capture');
      try {
        const report = await parseReport(runDelivery(delivery));

        expect(report.error).toBe(
          'Capability transport requires LLXPRT_CREDENTIAL_SOCKET',
        );
        // The descriptor is consumed and the marker scrubbed even though the
        // authority could not be built, so nothing is left readable.
        expect(report.markerBeforeOwner).toBe('3');
        expect(report.markerGone).toBe(true);
        expect(report.descriptorClosed).toBe(true);
      } finally {
        delivery.release();
      }
    },
  );

  it('removes the env file and its host-only directory on cleanup', () => {
    const result = createHostOnlyCapabilityEnvFile(VALID_TOKEN, []);
    if (result === undefined) {
      throw new Error('Expected a capability env file result');
    }
    const envFileDir = path.dirname(result.envFilePath);
    try {
      expect(fs.existsSync(result.envFilePath)).toBe(true);
      expect(fs.existsSync(envFileDir)).toBe(true);
      expect(path.basename(result.envFilePath)).toBe('capability.env');
      expect(result.args).toStrictEqual(['--env-file', result.envFilePath]);
    } finally {
      result.cleanup();
    }

    expect(fs.existsSync(result.envFilePath)).toBe(false);
    expect(fs.existsSync(envFileDir)).toBe(false);
    expect(() => result.cleanup()).not.toThrow();
  });

  it.skipIf(!posixDescriptorHost)(
    'restricts the env file to owner read and write',
    () => {
      const result = createHostOnlyCapabilityEnvFile(VALID_TOKEN, []);
      if (result === undefined) {
        throw new Error('Expected a capability env file result');
      }
      try {
        expect(fs.statSync(result.envFilePath).mode & 0o777).toBe(0o600);
        expect(fs.statSync(path.dirname(result.envFilePath)).mode & 0o777).toBe(
          0o700,
        );
      } finally {
        result.cleanup();
      }
    },
  );
});
