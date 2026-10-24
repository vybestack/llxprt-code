/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialProxyServer } from './credential-proxy-server.js';
import {
  InMemoryTokenStore,
  InMemoryProviderKeyStorage,
  makeToken,
} from './__tests__/credential-proxy-server-helpers.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CredentialAuthority,
  HostCredentialOwner,
  closeOwnedTokenStore,
} from './credential-store-factory.js';

const childScript = fileURLToPath(
  new URL('./__tests__/capability-fd-child.ts', import.meta.url),
);

// The descriptor tests run only where the product delivers a descriptor: the
// Linux sandbox entrypoint opens fd 3 and bin/llxprt.mjs forwards it to Bun
// off Windows. A native Windows host delivers the token through capability.env
// (sandbox-capability.test.ts), so no descriptor reader runs there.
const descriptorDeliveryPlatform = process.platform !== 'win32';

interface ChildRun {
  readonly exit: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs the child with the capability token on an extra stdio slot (fd 3),
 * the way bin/llxprt.mjs forwards the descriptor to Bun. The token is written
 * with a trailing newline, as the sandbox entrypoint's here-string does.
 */
async function runChild(
  mode: 'capture' | 'requests',
  token: string,
  socket?: string,
): Promise<ChildRun> {
  const child = spawn(process.execPath, [childScript, mode], {
    env: {
      ...process.env,
      LLXPRT_CREDENTIAL_SOCKET: socket ?? '',
      LLXPRT_CAPABILITY_FD: '3',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const descriptor = child.stdio[3];
  if (
    descriptor === null ||
    descriptor === undefined ||
    !('end' in descriptor)
  ) {
    throw new Error('Child has no writable descriptor 3');
  }
  descriptor.end(`${token}\n`);
  return { exit: await exited, stdout, stderr };
}

async function captureReport(token: string, socket?: string): Promise<unknown> {
  const run = await runChild('capture', token, socket);
  expect(run.stderr).toBe('');
  expect(run.exit).toBe(0);
  return JSON.parse(run.stdout);
}

describe('host credential authority', () => {
  it.each([
    'A'.repeat(64),
    'a'.repeat(63),
    'a'.repeat(65),
    ' ' + 'a'.repeat(64),
  ])('rejects malformed explicit capability without exposing it', (token) => {
    expect(() => new CredentialAuthority('/host.sock', token)).toThrow(
      'Invalid credential capability token',
    );
  });

  it('rejects explicit capability without a transport', () => {
    expect(() => new CredentialAuthority(undefined, 'a'.repeat(64))).toThrow(
      'Capability transport requires LLXPRT_CREDENTIAL_SOCKET',
    );
  });

  it('captures host input once without rebinding when the input changes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'capture-'));
    const tokens = new InMemoryTokenStore();
    await tokens.saveToken('test', makeToken());
    const server = new CredentialProxyServer({
      tokenStore: tokens,
      providerKeyStorage: new InMemoryProviderKeyStorage(),
      socketDir: directory,
    });
    const socket = await server.start();
    const environment = { LLXPRT_CREDENTIAL_SOCKET: socket };
    const owner = new HostCredentialOwner(environment);
    environment.LLXPRT_CREDENTIAL_SOCKET = '/replacement.sock';
    const store = owner.authority.createTokenStore();
    try {
      expect(await store.getToken('test')).toMatchObject({
        token_type: 'Bearer',
      });
      expect(Object.isFrozen(owner.authority)).toBe(true);
      expect(JSON.stringify(owner.authority)).not.toContain(socket);
    } finally {
      closeOwnedTokenStore(store);
      await server.stop();
      rmSync(directory, { recursive: true });
    }
  });

  it('keeps captured key and broker transports authenticated after host input changes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'authority-keys-'));
    const keys = new InMemoryProviderKeyStorage();
    await keys.saveKey('primary', 'first-key');
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: keys,
      socketDir: directory,
      capabilityToken: 'c'.repeat(64),
    });
    const socket = await server.start();
    const authority = new CredentialAuthority(socket, 'c'.repeat(64));
    const storage = authority.createProviderKeyStorage();
    const broker = authority.createGitHubBrokerSocketClient();
    try {
      expect(await storage.getKey('primary')).toBe('first-key');
      expect(
        await broker?.request('get_api_key', { name: 'primary' }),
      ).toMatchObject({
        ok: true,
        data: { key: 'first-key' },
      });
      expect(JSON.stringify(authority)).not.toContain('c'.repeat(64));
    } finally {
      if ('close' in storage && typeof storage.close === 'function')
        storage.close();
      broker?.close();
      await server.stop();
      rmSync(directory, { recursive: true });
    }
  });

  it.skipIf(!descriptorDeliveryPlatform)(
    'uses the captured descriptor capability for token, key, and broker requests after scrubbing',
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'fd-owner-'));
      const tokens = new InMemoryTokenStore();
      const keys = new InMemoryProviderKeyStorage();
      await tokens.saveToken('test', makeToken());
      await keys.saveKey('primary', 'captured-key');
      const capability = 'd'.repeat(64);
      const server = new CredentialProxyServer({
        tokenStore: tokens,
        providerKeyStorage: keys,
        socketDir: directory,
        capabilityToken: capability,
      });
      const socket = await server.start();
      try {
        const run = await runChild('requests', capability, socket);
        expect(run.exit).toBe(0);
        expect(run.stderr).toBe('');
        expect(JSON.parse(run.stdout)).toStrictEqual({
          markerGone: true,
          tokenType: 'Bearer',
          key: 'captured-key',
          brokerKey: 'captured-key',
          serialized: '{}',
        });
      } finally {
        await server.stop();
        rmSync(directory, { recursive: true });
      }
    },
  );

  it('creates separate direct stores from one immutable authority', () => {
    const owner = new HostCredentialOwner({});
    const first = owner.authority.createTokenStore();
    const second = owner.authority.createTokenStore();
    expect(first).not.toBe(second);
  });

  it.skipIf(!descriptorDeliveryPlatform)(
    'consumes and closes inherited authority without exposing its secret',
    async () => {
      const secret = 'a'.repeat(64);
      const result = await captureReport(secret, '/host.sock');
      expect(result).toStrictEqual({
        error: null,
        closed: true,
        markerGone: true,
        serialized: '{}',
      });
      expect(JSON.stringify(result)).not.toContain(secret);
    },
  );

  it.skipIf(!descriptorDeliveryPlatform)(
    'rejects malformed inherited authority and still closes the descriptor',
    async () => {
      expect(await captureReport('invalid', '/host.sock')).toStrictEqual({
        error:
          'Capability descriptor does not contain a valid 64-character lowercase hex token with the transport delimiter',
        closed: true,
        markerGone: true,
      });
    },
  );

  it.skipIf(!descriptorDeliveryPlatform)(
    'rejects a descriptor without a socket and consumes it before rejection',
    async () => {
      expect(await captureReport('b'.repeat(64))).toStrictEqual({
        error: 'Capability transport requires LLXPRT_CREDENTIAL_SOCKET',
        closed: true,
        markerGone: true,
      });
    },
  );
});
