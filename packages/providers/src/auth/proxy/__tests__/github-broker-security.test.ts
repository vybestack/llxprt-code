/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Security regression suite for the GitHub broker.
 *
 * Issue #1954 was a penetration test against the credential proxy. Its
 * exploit chain was: connect to the socket, send a trivial handshake,
 * enumerate keys with list_api_keys, then exfiltrate each one with
 * get_api_key. PRs #2467 and #2784 closed steps 1 through 3.
 *
 * This broker adds a NEW authenticated operation to that same socket, so
 * these tests prove the chain still fails where it failed before, and that
 * the new operation did not open a fourth door.
 *
 * @plan PLAN-20260731-GHBROKER.P17
 * @requirement REQ-001, REQ-015
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as net from 'node:net';
import { CredentialProxyServer } from '../credential-proxy-server.js';
import type { CredentialProxyServerOptions } from '../credential-proxy-server.js';
import { createGitHubBrokerHandler } from '../github-broker.js';
import { encodeFrame, FrameDecoder } from '@vybestack/llxprt-code-auth';
import { OP_REGISTRY } from '../github-broker-ops.js';
import { validateParams } from '../github-broker-validation.js';

const CAPABILITY = 'test-capability-token-with-plenty-of-entropy';
/** A realistically shaped GitHub token; must never appear in any response. */
const SECRET = 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** Minimal in-memory stores; the broker must never reach these at all. */
function makeStores() {
  const keys = new Map<string, string>([['github-pat', SECRET]]);
  return {
    tokenStore: {
      async getToken() {
        return null;
      },
      async saveToken() {},
      async removeToken() {},
      async listProviders() {
        return [];
      },
    },
    keyStorage: {
      async getKey(name: string) {
        return keys.get(name) ?? null;
      },
      async saveKey() {},
      async deleteKey() {
        return false;
      },
      async listKeys() {
        return [...keys.keys()];
      },
      async hasKey(name: string) {
        return keys.has(name);
      },
    },
  };
}

function options(): CredentialProxyServerOptions {
  const { tokenStore, keyStorage } = makeStores();
  return {
    tokenStore:
      tokenStore as unknown as CredentialProxyServerOptions['tokenStore'],
    providerKeyStorage:
      keyStorage as unknown as CredentialProxyServerOptions['providerKeyStorage'],
    capabilityToken: CAPABILITY,
    extraHandlers: { github: createGitHubBrokerHandler().handler },
  };
}

/**
 * Speaks the wire protocol directly, exactly as the #1954 report's attacker
 * did, rather than going through ProxySocketClient. Using the real client
 * would hide the very step the pentest exploited.
 */
async function rawExchange(
  socketPath: string,
  frames: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const received: Array<Record<string, unknown>> = [];
    const decoder = new FrameDecoder();
    const socket = net.createConnection(socketPath);
    const done = (): void => {
      socket.destroy();
      resolve(received);
    };
    socket.on('connect', () => {
      for (const frame of frames) socket.write(encodeFrame(frame));
      setTimeout(done, 300);
    });
    socket.on('data', (chunk: Buffer) => {
      try {
        received.push(...decoder.feed(chunk));
      } catch {
        // A decode failure is itself a valid observation; stop reading.
        done();
      }
    });
    socket.on('error', reject);
  });
}

describe('GitHub broker security regressions (#1954)', () => {
  let server: CredentialProxyServer;
  let socketPath: string;

  beforeEach(async () => {
    server = new CredentialProxyServer(options());
    socketPath = await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  /**
   * Step 2 of the #1954 chain. The handshake used to accept anything.
   *
   * @plan PLAN-20260731-GHBROKER.P17
   * @requirement REQ-015
   */
  it('rejects the pentest handshake that carried no capability token', async () => {
    const frames = await rawExchange(socketPath, [
      { v: 2, op: 'handshake', payload: { minVersion: 1, maxVersion: 2 } },
    ]);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0].ok).toBe(false);
    expect(frames[0].code).toBe('UNAUTHORIZED');
  });

  /**
   * The broker put a new operation on this socket. It must sit behind the
   * same gate, not beside it.
   *
   * @plan PLAN-20260731-GHBROKER.P17
   * @requirement REQ-003, REQ-015
   */
  it('refuses a github operation from an unauthenticated connection', async () => {
    const frames = await rawExchange(socketPath, [
      { v: 2, op: 'handshake', payload: { minVersion: 1, maxVersion: 2 } },
      {
        v: 2,
        id: 'x1',
        op: 'github',
        payload: { op: 'issue.view', number: 1 },
      },
    ]);
    const success = frames.find((f) => f.ok === true);
    expect(success).toBeUndefined();
    for (const frame of frames) {
      expect(JSON.stringify(frame)).not.toContain(SECRET);
    }
  });

  /**
   * Step 3 of the chain: enumeration. Closed by #2467 and still closed.
   *
   * @plan PLAN-20260731-GHBROKER.P17
   * @requirement REQ-015
   */
  it('still returns no key names to an authenticated sandbox connection', async () => {
    const frames = await rawExchange(socketPath, [
      {
        v: 2,
        op: 'handshake',
        payload: {
          minVersion: 1,
          maxVersion: 2,
          capabilityToken: CAPABILITY,
        },
      },
      { v: 2, id: 'l1', op: 'list_api_keys', payload: {} },
      { v: 2, id: 'h1', op: 'has_api_key', payload: { name: 'github-pat' } },
    ]);
    const list = frames.find((f) => f.id === 'l1');
    expect(list?.ok).toBe(true);
    expect((list?.data as { keys: string[] }).keys).toStrictEqual([]);

    const has = frames.find((f) => f.id === 'h1');
    expect(has?.ok).toBe(false);
    expect(has?.code).toBe('FORBIDDEN');
  });

  /**
   * The whole point of the broker: it brokers operations, it does not
   * broker credentials. It must not have become a second way to read one.
   *
   * @plan PLAN-20260731-GHBROKER.P17
   * @requirement REQ-001, REQ-004
   */
  it('exposes no github operation that returns a stored credential', () => {
    for (const [name, descriptor] of Object.entries(OP_REGISTRY)) {
      const argv = JSON.stringify(
        descriptor.buildArgv({ number: 1, threadId: 'T', name: 'n' }),
      );
      expect(argv, `${name} must not read the keystore`).not.toContain(
        'get_api_key',
      );
      expect(argv, `${name} must not invoke a shell`).not.toContain('sh -c');
    }
  });

  /**
   * The broker must never import credential storage. Enforced here rather
   * than by convention, because the confused-deputy risk is the reason the
   * broker is a separate component at all.
   *
   * @plan PLAN-20260731-GHBROKER.P17
   * @requirement REQ-004
   */
  it('keeps credential storage out of the broker module graph', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const dir = path.resolve(here, '..');
    const brokerFiles = (await fs.readdir(dir)).filter(
      (f) => f.startsWith('github-broker') && f.endsWith('.ts'),
    );
    expect(brokerFiles.length).toBeGreaterThan(0);

    for (const file of brokerFiles) {
      const source = await fs.readFile(path.join(dir, file), 'utf8');
      const imports = source
        .split('\n')
        .filter((line) => line.trimStart().startsWith('import'));
      for (const line of imports) {
        expect(line, `${file} must not import credential storage`).not.toMatch(
          /credential-store-factory|provider-key-storage|token-store/,
        );
      }
    }
  });

  /**
   * Every op must invoke gh by argv. A shell string anywhere would make the
   * op set unauditable, which is the property the whole design rests on.
   *
   * @plan PLAN-20260731-GHBROKER.P17
   * @requirement REQ-002
   */
  it('never invokes gh through a shell', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const source = await fs.readFile(
      path.resolve(here, '..', 'github-broker.ts'),
      'utf8',
    );
    expect(source).toContain('shell: false');
    expect(source).not.toMatch(/\bexec\(/);
    expect(source).not.toMatch(/shell:\s*true/);
  });
});

describe('flag-injection defense (array elements)', () => {
  /**
   * The generic leading-dash check sees only the array container, so the
   * per-element check is what actually holds here. Array elements are
   * pushed straight into the gh argv by the repeatable-flag helpers, so a
   * gap would contradict the invariant the validation module documents.
   *
   * @plan PLAN-20260731-GHBROKER.P17
   * @requirement REQ-002
   */
  it('rejects a dash-prefixed label array element', () => {
    const error = validateParams(
      { label: 'label' },
      { label: ['--malicious-flag'] },
    );
    expect(error).not.toBeNull();
    expect(error?.code).toBe('INVALID_PARAM');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P17
   * @requirement REQ-002
   */
  it('rejects a dash-prefixed assignee array element', () => {
    const error = validateParams(
      { addAssignee: 'assignee' },
      { addAssignee: ['-x'] },
    );
    expect(error).not.toBeNull();
    expect(error?.code).toBe('INVALID_PARAM');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P17
   * @requirement REQ-002
   */
  it('still accepts ordinary label and assignee arrays', () => {
    expect(
      validateParams({ label: 'label' }, { label: ['bug', 'security'] }),
    ).toBeNull();
    expect(
      validateParams(
        { addAssignee: 'assignee' },
        { addAssignee: ['acoliver'] },
      ),
    ).toBeNull();
  });
});
