/**
 * @license
 * Copyright 2026 Vybestack LLC
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

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as net from 'node:net';
import { CredentialProxyServer } from '../credential-proxy-server.js';
import type { CredentialProxyServerOptions } from '../credential-proxy-server.js';
import { createGitHubBrokerHandler } from '../github-broker.js';
import { encodeFrame, FrameDecoder } from '@vybestack/llxprt-code-auth';
import { OP_REGISTRY } from '../github-broker-ops.js';
import { validateParams } from '../github-broker-validation.js';
import { auditLog } from '../audit-log.js';

const CAPABILITY = 'test-capability-token-with-plenty-of-entropy';
/** A realistically shaped GitHub token; must never appear in any response. */
const SECRET = 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function isBrokerSourceFile(file: string): boolean {
  return file.startsWith('github-broker') && file.endsWith('.ts');
}

async function findCredentialImportOffenders(
  fs: typeof import('node:fs/promises'),
  path: typeof import('node:path'),
  dir: string,
  brokerFiles: readonly string[],
): Promise<string[]> {
  const offenders: string[] = [];
  for (const file of brokerFiles) {
    const source = await fs.readFile(path.join(dir, file), 'utf8');
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map(
      (match) => match[1],
    );
    for (const specifier of specifiers) {
      if (
        /credential-store-factory|provider-key-storage|token-store|llxprt-code-storage/.test(
          specifier,
        )
      ) {
        offenders.push(`${file} -> ${specifier}`);
      }
    }
  }
  return offenders;
}

async function findShellSpawnOffenders(
  fs: typeof import('node:fs/promises'),
  path: typeof import('node:path'),
  dir: string,
  brokerFiles: readonly string[],
): Promise<string[]> {
  const shellSpawn =
    /(?:child_process['"]\s*\)?[\s\S]{0,200}?\b(?:exec|spawn)\s*\()|(?:\bimport\s*\{[^}]*\b(?:exec|spawn)\b[^}]*\}\s*from\s*['"]node:child_process)|(?:shell:\s*true)/;
  const offenders: string[] = [];
  for (const file of brokerFiles) {
    const source = await fs.readFile(path.join(dir, file), 'utf8');
    if (shellSpawn.test(source)) offenders.push(file);
  }
  return offenders;
}

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
    for (const [, descriptor] of Object.entries(OP_REGISTRY)) {
      const argv = JSON.stringify(
        descriptor.buildArgv({ number: 1, threadId: 'T', name: 'n' }),
      );
      expect(argv).not.toContain('get_api_key');
      expect(argv).not.toContain('sh -c');
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
    const brokerFiles = (await fs.readdir(dir)).filter(isBrokerSourceFile);
    expect(brokerFiles.length).toBeGreaterThan(0);

    // Match module specifiers across the whole file rather than filtering
    // for lines that start with `import`. Prettier wraps long imports, which
    // puts the specifier on a later line — so the line-based check silently
    // passed for exactly the formatting this repo produces.
    const offenders = await findCredentialImportOffenders(
      fs,
      path,
      dir,
      brokerFiles,
    );
    expect(offenders).toStrictEqual([]);
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
    const dir = path.resolve(here, '..');
    // Every broker module, not just the entry point. Spawning could be
    // introduced in any of them and a single-file check would miss it.
    const brokerFiles = (await fs.readdir(dir)).filter(isBrokerSourceFile);
    expect(brokerFiles.length).toBeGreaterThan(1);

    // Match shell-capable spawns specifically. A bare /exec\(/ also matches
    // RegExp.prototype.exec, which is unrelated and produced a false
    // positive; the risk is child_process exec/spawn, or shell: true on any
    // call.
    const offenders = await findShellSpawnOffenders(fs, path, dir, brokerFiles);
    expect(offenders).toStrictEqual([]);

    const entry = await fs.readFile(path.join(dir, 'github-broker.ts'), 'utf8');
    expect(entry).toContain('shell: false');
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

describe('handler dispatch is not prototype-reachable', () => {
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
   * `op` is caller-controlled. A plain index into the handler table resolves
   * inherited members, so "toString" or "constructor" would come back truthy
   * and then be invoked as a request handler.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-002, REQ-015
   */
  it('rejects operations named after Object.prototype members', async () => {
    for (const op of ['toString', 'constructor', 'valueOf', '__proto__']) {
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
        { v: 2, id: `p-${op}`, op, payload: {} },
      ]);
      const reply = frames.find((f) => f.id === `p-${op}`);
      expect(reply?.ok).toBe(false);
      expect(reply?.code).toBe('INVALID_REQUEST');
    }
  });
});

describe('audit log enforces its no-secrets claim', () => {
  /**
   * The details argument is caller-supplied. The previous implementation
   * asserted in a comment that secrets were never included while nothing
   * checked, which is the kind of guarantee that quietly stops being true.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-001
   */
  it('redacts token-shaped values passed in details', () => {
    const written: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    (process.stderr as { write: unknown }).write = (chunk: string): boolean => {
      written.push(String(chunk));
      return true;
    };
    try {
      auditLog('INFO', 1, 'test_op', { leaked: SECRET });
    } finally {
      (process.stderr as { write: unknown }).write = original;
    }
    expect(written.join('')).not.toContain(SECRET);
  });

  /**
   * A missing audit record is itself a security signal, so a value that
   * cannot be serialised must still produce a line.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-001
   */
  it('still emits a record when details cannot be serialised', () => {
    const written: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    (process.stderr as { write: unknown }).write = (chunk: string): boolean => {
      written.push(String(chunk));
      return true;
    };
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    try {
      auditLog('WARN', 2, 'circular_op', circular);
    } finally {
      (process.stderr as { write: unknown }).write = original;
    }
    expect(written.join('')).toContain('circular_op');
    expect(written.join('')).toContain('unserialisable');
  });
});

describe('production wiring', () => {
  /**
   * The broker exists only for the sandbox, and sandbox-proxy-lifecycle is
   * the sole production construction of CredentialProxyServer. If it does
   * not register the github handler, a sandboxed agent builds a proxy
   * client, sends github ops over the socket, and gets UNKNOWN_OP - the
   * broker fully present and completely unreachable.
   *
   * Every other test in this suite builds its own server WITH the handler,
   * so none of them can catch that. This one asserts the production path.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-003
   */
  it('registers the github handler on the sandbox proxy server', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const source = await fs.readFile(
      path.resolve(here, '..', 'sandbox-proxy-lifecycle.ts'),
      'utf8',
    );
    expect(source).toContain('createGitHubBrokerHandler');
    expect(source).toMatch(/extraHandlers:\s*\{\s*github:/);
  });

  /**
   * The registered value must be the handler function itself. The wrapper
   * object is not callable, and the server rejects a non-function at
   * construction, so passing the wrapper would break every sandbox start.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-003
   */
  it('registers a callable handler, not the wrapper object', async () => {
    const { createGitHubBrokerHandler } = await import('../github-broker.js');
    expect(typeof createGitHubBrokerHandler().handler).toBe('function');
    expect(typeof createGitHubBrokerHandler()).not.toBe('function');
  });
});
