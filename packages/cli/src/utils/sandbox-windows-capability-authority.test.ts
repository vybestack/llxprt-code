/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the capability delivery path a WINDOWS host uses
 * (#3841 review item E11, reworked for #3573). On Windows the sandbox is a
 * Linux container, so the host cannot hand the CLI a descriptor of its own:
 * it writes the token to a file in a host-only directory and Docker/Podman
 * bind-mount that directory at a fixed private path. Inside the container the
 * trusted entrypoint opens the file, unlinks it, re-opens descriptor 3 from a
 * pipe, and execs the CLI. The container's create configuration never holds
 * the token. Everything after the host file runs under bash in Linux, so this
 * suite drives that stretch on macOS and Linux CI: the host producer is real
 * (`createHostOnlyCapabilityMount`), the entrypoint is the REAL generated
 * command array with its mount path pointed at the host directory, and the
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
import { createHostOnlyCapabilityMount } from './sandbox-capability.js';
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
const PROVIDER_KEY_VALUE = 'primary-key-through-capability-mount';

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
  readonly tokenFilePath: string;
  readonly mountArgs: readonly string[];
  readonly sentinel: string;
  readonly release: () => void;
}

interface ProxyHandle {
  readonly socketPath: string;
  readonly stop: () => Promise<void>;
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

describe('windows capability delivery through the capability mount', () => {
  let tmpDir = '';
  let binDir = '';
  let workdir = '';
  let containerHome = '';
  let environmentSnapshot: NodeJS.ProcessEnv;

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    delete process.env.SANDBOX_PORTS;
    delete process.env.DEBUG;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-mount-'));
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
   * Builds the Windows-equivalent delivery. The host producer writes the token
   * file in its host-only directory; the entrypoint is generated with that
   * directory standing in for the container mount path;
   * `LLXPRT_CREDENTIAL_SOCKET` is added the way sandbox-credential-proxy.ts adds
   * it with `--env`; and the command array is generated for a
   * PATH-discoverable `llxprt`. HOME points inside the temp tree because the
   * container has its own home, which keeps the entrypoint's pinned data roots
   * out of the real one.
   */
  function createDelivery(
    token: string,
    socketPath: string | undefined,
    mode: string,
  ): Delivery {
    const result = createHostOnlyCapabilityMount(token, []);
    if (result === undefined) {
      throw new Error('Expected a capability mount result');
    }
    const sentinel = `env-visible-${String(Date.now())}-${String(
      Math.random(),
    ).slice(2)}`;
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.LLXPRT_CAPABILITY_FD;
    delete env.LLXPRT_CAPABILITY_TOKEN;
    delete env.LLXPRT_CREDENTIAL_SOCKET;
    env[SENTINEL_KEY] = sentinel;
    env.HOME = containerHome;
    env.PATH = `${binDir}:${process.env.PATH ?? ''}`;
    if (socketPath !== undefined) {
      env.LLXPRT_CREDENTIAL_SOCKET = socketPath;
    }
    return {
      command: entrypoint(
        workdir,
        ['llxprt', 'run', mode],
        undefined,
        undefined,
        undefined,
        { capabilityMountDir: path.dirname(result.tokenFilePath) },
      ),
      env,
      cwd: workdir,
      tokenFilePath: result.tokenFilePath,
      mountArgs: result.args,
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
    'carries the mounted token through the trusted entrypoint to the consumer and authenticates every request',
    async () => {
      const proxy = await startProxy(VALID_TOKEN);
      const delivery = createDelivery(
        VALID_TOKEN,
        proxy.socketPath,
        'requests',
      );
      try {
        // The host half: the token file holds the token and a newline, and
        // the token reaches the container neither through the environment nor
        // through any argv.
        expect(fs.readFileSync(delivery.tokenFilePath, 'utf8')).toBe(
          `${VALID_TOKEN}\n`,
        );
        expect(delivery.env.LLXPRT_CAPABILITY_TOKEN).toBeUndefined();
        expect(delivery.mountArgs.join('\n')).not.toContain(VALID_TOKEN);
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
        // The entrypoint unlinked the file before it ran the CLI.
        expect(fs.existsSync(delivery.tokenFilePath)).toBe(false);
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
    'rejects a capability containing %s at the producer before writing a capability file',
    (_label, token) => {
      expect(() => createHostOnlyCapabilityMount(token, [])).toThrow(
        'Capability token contains invalid characters for the capability file',
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

  it('removes the token file and its host-only directory on cleanup', () => {
    const result = createHostOnlyCapabilityMount(VALID_TOKEN, []);
    if (result === undefined) {
      throw new Error('Expected a capability mount result');
    }
    const hostDir = path.dirname(result.tokenFilePath);
    try {
      expect(fs.existsSync(result.tokenFilePath)).toBe(true);
      expect(fs.existsSync(hostDir)).toBe(true);
      expect(path.basename(result.tokenFilePath)).toBe('token');
      expect(result.args).toStrictEqual([
        '--volume',
        `${hostDir}:/run/llxprt-capability:rw`,
      ]);
    } finally {
      result.cleanup();
    }

    expect(fs.existsSync(result.tokenFilePath)).toBe(false);
    expect(fs.existsSync(hostDir)).toBe(false);
    expect(() => result.cleanup()).not.toThrow();
  });

  it.skipIf(!posixDescriptorHost)(
    'restricts the token file to owner read and write',
    () => {
      const result = createHostOnlyCapabilityMount(VALID_TOKEN, []);
      if (result === undefined) {
        throw new Error('Expected a capability mount result');
      }
      try {
        expect(fs.statSync(result.tokenFilePath).mode & 0o777).toBe(0o600);
        expect(
          fs.statSync(path.dirname(result.tokenFilePath)).mode & 0o777,
        ).toBe(0o700);
      } finally {
        result.cleanup();
      }
    },
  );
});
