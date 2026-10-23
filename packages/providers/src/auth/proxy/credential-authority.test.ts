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
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CredentialAuthority,
  HostCredentialOwner,
  closeOwnedTokenStore,
} from './credential-store-factory.js';

const factoryPath = fileURLToPath(
  new URL('./credential-store-factory.ts', import.meta.url),
);

function runCapture(token: string, socket?: string): unknown {
  const script = `
    const { HostCredentialOwner } = require(${JSON.stringify(factoryPath)});
    const fs = require('node:fs');
    let error = null;
    let authority;
    try { authority = new HostCredentialOwner(process.env).authority; }
    catch (e) { error = e.message; }
    let closed = false;
    try { fs.readSync(3, Buffer.alloc(1), 0, 1, null); }
    catch { closed = true; }
    process.stdout.write(JSON.stringify({error, closed,
      markerGone: process.env.LLXPRT_CAPABILITY_FD === undefined,
      serialized: JSON.stringify(authority)}));
  `;
  const result = spawnSync(
    'bash',
    [
      '--noprofile',
      '--norc',
      '-c',
      `exec 3<<<"${token}"\nexec bun -e ${JSON.stringify(script.split(String.fromCharCode(10)).join(' '))}`,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        BASH_ENV: '',
        LLXPRT_CREDENTIAL_SOCKET: socket ?? '',
        LLXPRT_CAPABILITY_FD: '3',
      },
    },
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
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

  it.skipIf(process.platform === 'win32')(
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
      const script = `
        const { HostCredentialOwner, closeOwnedTokenStore } = await import(${JSON.stringify(factoryPath)});
        const authority = new HostCredentialOwner(process.env).authority;
        const markerGone = process.env.LLXPRT_CAPABILITY_FD === undefined;
        process.env.LLXPRT_CREDENTIAL_SOCKET = '/replacement.sock';
        const store = authority.createTokenStore();
        const keys = authority.createProviderKeyStorage();
        const broker = authority.createGitHubBrokerSocketClient();
        try {
          const token = await store.getToken('test');
          const key = await keys.getKey('primary');
          const response = await broker.request('get_api_key', { name: 'primary' });
          process.stdout.write(JSON.stringify({ markerGone, tokenType: token.token_type, key, brokerKey: response.data.key, serialized: JSON.stringify(authority) }));
        } finally {
          closeOwnedTokenStore(store);
          keys.close();
          broker.close();
        }
      `;
      try {
        const child = spawn(
          'bash',
          [
            '--noprofile',
            '--norc',
            '-c',
            `exec 3<<<"${capability}"
exec bun -e ${JSON.stringify(script.split(String.fromCharCode(10)).join(' '))}`,
          ],
          {
            env: {
              ...process.env,
              BASH_ENV: '',
              LLXPRT_CREDENTIAL_SOCKET: socket,
              LLXPRT_CAPABILITY_FD: '3',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let output = '';
        let errors = '';
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
          errors += chunk.toString();
        });
        const exit = await new Promise<number | null>((resolve, reject) => {
          child.once('error', reject);
          child.once('close', resolve);
        });
        expect(exit).toBe(0);
        expect(errors).toBe('');
        expect(JSON.parse(output)).toStrictEqual({
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

  it.skipIf(process.platform === 'win32')(
    'consumes and closes inherited authority without exposing its secret',
    () => {
      const secret = 'a'.repeat(64);
      const result = runCapture(secret, '/host.sock');
      expect(result).toStrictEqual({
        error: null,
        closed: true,
        markerGone: true,
        serialized: '{}',
      });
      expect(JSON.stringify(result)).not.toContain(secret);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'rejects malformed inherited authority and still closes the descriptor',
    () => {
      expect(runCapture('invalid', '/host.sock')).toStrictEqual({
        error:
          'Capability descriptor does not contain a valid 64-character lowercase hex token with the transport delimiter',
        closed: true,
        markerGone: true,
      });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a descriptor without a socket and consumes it before rejection',
    () => {
      expect(runCapture('b'.repeat(64))).toStrictEqual({
        error: 'Capability transport requires LLXPRT_CREDENTIAL_SOCKET',
        closed: true,
        markerGone: true,
      });
    },
  );
});
