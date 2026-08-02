/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import * as path from 'node:path';
import * as os from 'node:os';
import { KeyringTokenStore } from '../keyring-token-store.js';
import { buildOwnerMetadata } from '../lock-owner.js';
import type { IDebugLogger, ISecureStore } from '../interfaces/index.js';

function createInMemorySecureStore(): ISecureStore {
  const entries = new Map<string, string>();
  return {
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => void entries.set(key, value),
    delete: async (key) => entries.delete(key),
    list: async () => [...entries.keys()],
    has: async (key) => entries.has(key),
  };
}

function createNoOpLogger(): IDebugLogger {
  return {
    debug: () => {},
    error: () => {},
    warn: () => {},
    log: () => {},
  };
}

const CHILD_READY_TIMEOUT_MS = 2_000;
const CHILD_EXIT_TIMEOUT_MS = 2_000;

async function waitForChildReady(
  child: ReturnType<typeof spawn>,
): Promise<void> {
  const stdout = child.stdout;
  if (stdout === null) {
    throw new Error('Lock-owner child stdout is not piped');
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      stdout.removeListener('data', onData);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
    };
    const onData = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      cleanup();
      reject(
        new Error(
          `Lock-owner child exited before ready (code=${String(code)}, signal=${String(signal)})`,
        ),
      );
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for lock-owner child readiness'));
    }, CHILD_READY_TIMEOUT_MS);
    stdout.once('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await Promise.race([
    exited,
    new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error('Lock-owner child did not exit after SIGKILL')),
        CHILD_EXIT_TIMEOUT_MS,
      );
    }),
  ]);
}
describe('KeyringTokenStore advisory lock behavior', () => {
  let tempDir: string;
  let lockDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-lock-behavior-'));
    lockDir = path.join(tempDir, 'locks');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createStore(
    currentProcessOwnerMetadataBuilder?: () =>
      | ReturnType<typeof buildOwnerMetadata>
      | Promise<ReturnType<typeof buildOwnerMetadata>>,
  ): KeyringTokenStore {
    return new KeyringTokenStore({
      secureStore: createInMemorySecureStore(),
      lockDir,
      logger: createNoOpLogger(),
      currentProcessOwnerMetadataBuilder,
    });
  }

  it('requires lockDir in the injected directory', () => {
    expect(
      () =>
        new KeyringTokenStore({
          secureStore: createInMemorySecureStore(),
          logger: createNoOpLogger(),
        } as never),
    ).toThrow(/createKeyringTokenStore/);
  });

  it('creates the lock file inside the injected lockDir', async () => {
    const store = createStore();
    const acquired = await store.acquireRefreshLock('codex', {
      waitMs: 1000,
    });
    expect(acquired).toBe(true);

    const lockFile = path.join(lockDir, 'codex-refresh.lock');
    const stat = await fs.stat(lockFile);
    expect(stat.isFile()).toBe(true);

    await store.releaseRefreshLock('codex');
  });

  it('makes an uncontended acquisition attempt when waitMs is zero', async () => {
    const store = createStore();

    expect(await store.acquireRefreshLock('zero-wait', { waitMs: 0 })).toBe(
      true,
    );

    await store.releaseRefreshLock('zero-wait');
  });

  it('starts the wait budget after current-process metadata probing', async () => {
    let metadataProbeFinished = false;
    const store = createStore(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      metadataProbeFinished = true;
      return buildOwnerMetadata(Date.now() - process.uptime() * 1000);
    });

    const acquired = await store.acquireRefreshLock('metadata-budget', {
      waitMs: 1,
    });
    expect({ acquired, metadataProbeFinished }).toStrictEqual({
      acquired: true,
      metadataProbeFinished: true,
    });

    await store.releaseRefreshLock('metadata-budget');
  });

  it('serializes two live contenders across separate instances', async () => {
    const storeA = createStore();
    const storeB = createStore();

    expect(await storeA.acquireRefreshLock('anthropic', { waitMs: 1000 })).toBe(
      true,
    );

    const bPromise = storeB.acquireRefreshLock('anthropic', { waitMs: 2000 });

    await new Promise((resolve) => setTimeout(resolve, 150));
    await expect(
      fs.stat(path.join(lockDir, 'anthropic-refresh.lock')),
    ).resolves.toBeDefined();

    await storeA.releaseRefreshLock('anthropic');
    const bAcquired = await bPromise;
    expect(bAcquired).toBe(true);

    await storeB.releaseRefreshLock('anthropic');
  });

  it('recovers a dead-owner lock (issue #2819)', async () => {
    const lockFile = path.join(lockDir, 'anthropic-refresh.lock');
    await fs.mkdir(lockDir, { recursive: true });
    const stalePayload = {
      version: 1,
      ownerToken: 'dead-owner',
      pid: 999999,
      hostname: os.hostname(),
      startTimeMs: Date.now() - 60_000,
    };
    await fs.writeFile(lockFile, JSON.stringify(stalePayload), {
      mode: 0o600,
    });

    const store = createStore();
    const acquired = await store.acquireRefreshLock('anthropic', {
      waitMs: 1000,
    });
    // Issue #2819: a dead local owner is provably gone, so the lock is
    // recovered via the fenced takeover protocol instead of orphaning.
    expect(acquired).toBe(true);
    await store.releaseRefreshLock('anthropic');
    await expect(fs.stat(lockFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('defers on a malformed/tokenless lock (no mtime reclaim)', async () => {
    const lockFile = path.join(lockDir, 'gemini-refresh.lock');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(lockFile, 'not valid json', { mode: 0o600 });

    const store = createStore();
    const acquired = await store.acquireRefreshLock('gemini', {
      waitMs: 200,
    });
    expect(acquired).toBe(false);
    // The malformed lock is left in place for manual cleanup.
    const stat = await fs.stat(lockFile);
    expect(stat.isFile()).toBe(true);
  });

  it('removes own lock on release', async () => {
    const store = createStore();
    await store.acquireRefreshLock('gemini', { waitMs: 500 });
    const lockFile = path.join(lockDir, 'gemini-refresh.lock');
    await expect(fs.stat(lockFile)).resolves.toBeDefined();

    await store.releaseRefreshLock('gemini');
    await expect(fs.stat(lockFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not remove a lock it does not own on release', async () => {
    const store = createStore();
    const lockFile = path.join(lockDir, 'codex-refresh.lock');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      lockFile,
      JSON.stringify({
        version: 1,
        ownerToken: 'foreign',
        pid: 999999,
        hostname: os.hostname(),
        startTimeMs: Date.now() - process.uptime() * 1000,
      }),
      { mode: 0o600 },
    );

    await store.releaseRefreshLock('codex');
    const stat = await fs.stat(lockFile);
    expect(stat.isFile()).toBe(true);
  });

  it('does not steal a live lock held by another process', async () => {
    const lockFile = path.join(lockDir, 'anthropic-refresh.lock');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      lockFile,
      JSON.stringify({
        version: 1,
        ownerToken: 'live-owner',
        pid: process.pid,
        hostname: os.hostname(),
        startTimeMs: Date.now() - process.uptime() * 1000,
      }),
      { mode: 0o600 },
    );

    const store = createStore();
    const acquired = await store.acquireRefreshLock('anthropic', {
      waitMs: 200,
    });
    expect(acquired).toBe(false);
  });

  it('propagates unexpected write errors from lockDir creation', async () => {
    const store = new KeyringTokenStore({
      secureStore: createInMemorySecureStore(),
      lockDir: path.join(lockDir, 'subdir', '\0'),
      logger: createNoOpLogger(),
    });
    await expect(
      store.acquireRefreshLock('codex', { waitMs: 100 }),
    ).rejects.toThrow(/lock|directory|error/i);
  });

  it('respects the wait timeout when the lock stays busy', async () => {
    const lockFile = path.join(lockDir, 'anthropic-refresh.lock');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      lockFile,
      JSON.stringify({
        version: 1,
        ownerToken: 'perpetual',
        pid: process.pid,
        hostname: os.hostname(),
        startTimeMs: Date.now() - process.uptime() * 1000,
      }),
      { mode: 0o600 },
    );

    const store = createStore();
    const start = Date.now();
    const acquired = await store.acquireRefreshLock('anthropic', {
      waitMs: 200,
    });
    expect(acquired).toBe(false);
    expect(Date.now() - start).toBeGreaterThanOrEqual(100);
  });

  it('bounds a stalled auth-lock waiter callback by the acquisition deadline', async () => {
    const lockFile = path.join(lockDir, 'codex-auth.lock');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      lockFile,
      JSON.stringify({
        version: 1,
        ownerToken: 'live-owner',
        pid: process.pid,
        hostname: os.hostname(),
        startTimeMs: Date.now() - process.uptime() * 1000,
      }),
      { mode: 0o600 },
    );
    const store = createStore();
    const start = Date.now();

    const acquired = await store.acquireAuthLock('codex', {
      waitMs: 100,
      onWait: () => new Promise<boolean>(() => undefined),
    });

    expect(acquired).toBe(false);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('keeps auth and refresh lock namespaces independent', async () => {
    const storeA = createStore();
    const storeB = createStore();

    expect(await storeA.acquireAuthLock('codex', { waitMs: 500 })).toBe(true);
    expect(await storeB.acquireRefreshLock('codex', { waitMs: 500 })).toBe(
      true,
    );

    await storeB.releaseRefreshLock('codex');
    await storeA.releaseAuthLock('codex');
  });

  it('hands off a token through a real store while waiting on another owner', async () => {
    const secureStore = createInMemorySecureStore();
    const storeA = new KeyringTokenStore({
      secureStore,
      lockDir,
      logger: createNoOpLogger(),
    });
    const storeB = new KeyringTokenStore({
      secureStore,
      lockDir,
      logger: createNoOpLogger(),
    });
    expect(await storeA.acquireAuthLock('codex', { waitMs: 500 })).toBe(true);
    const waiter = storeB.acquireAuthLock('codex', {
      waitMs: 1_000,
      onWait: async () => (await storeB.getToken('codex', 'work')) !== null,
    });

    await storeA.saveToken(
      'codex',
      {
        access_token: 'handoff-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'work',
    );
    expect(await waiter).toBe(false);
    expect((await storeB.getToken('codex', 'work'))?.access_token).toBe(
      'handoff-token',
    );
    await storeA.releaseAuthLock('codex');
  });

  it('does not expose a fixed lock pathname when atomic publication fails', async () => {
    const store = createStore();
    const lockFile = path.join(lockDir, 'codex-refresh.lock');
    const link = vi
      .spyOn(fs, 'link')
      .mockRejectedValueOnce(
        Object.assign(new Error('disk full'), { code: 'ENOSPC' }),
      );

    try {
      await expect(
        store.acquireRefreshLock('codex', { waitMs: 100 }),
      ).rejects.toMatchObject({ code: 'ENOSPC' });
      await expect(fs.stat(lockFile)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      link.mockRestore();
    }
  });

  describe.skipIf(!['darwin', 'linux', 'freebsd'].includes(process.platform))(
    'OS-observed subprocess owner identity',
    () => {
      // Bun's child_process.spawn emits stdout data events differently from
      // Node.js, causing the lock-owner child's readiness signal to be missed
      // or the lock file to be released before the parent attempts acquisition.
      // These tests verify Node.js-specific process semantics.
      it.skipIf(process.versions.bun !== undefined).each([
        {
          lockType: 'auth',
          acquire: (store: KeyringTokenStore, waitMs: number) =>
            store.acquireAuthLock('subprocess', { waitMs }),
          release: (store: KeyringTokenStore) =>
            store.releaseAuthLock('subprocess'),
        },
        {
          lockType: 'refresh',
          acquire: (store: KeyringTokenStore, waitMs: number) =>
            store.acquireRefreshLock('subprocess', { waitMs }),
          release: (store: KeyringTokenStore) =>
            store.releaseRefreshLock('subprocess'),
        },
      ])(
        'defers to a real live subprocess $lockType owner and recovers after it exits',
        async ({ lockType, acquire, release }) => {
          const lockFile = path.join(lockDir, `subprocess-${lockType}.lock`);
          await fs.mkdir(lockDir, { recursive: true });
          const child = spawn(
            process.execPath,
            [
              '-e',
              [
                "const fs=require('node:fs')",
                "const os=require('node:os')",
                "const cp=require('node:child_process')",
                "const started=Date.parse(cp.execFileSync('ps',['-o','lstart=','-p',String(process.pid)],{encoding:'utf8'}).trim())",
                "fs.writeFileSync(process.argv[1],JSON.stringify({version:1,ownerToken:'child-owner',pid:process.pid,hostname:os.hostname(),startTimeMs:started,startTimeSource:'canonical'}),{mode:0o600})",
                "process.stdout.write('ready\\n')",
                'setInterval(()=>{},1000)',
              ].join(';'),
              lockFile,
            ],
            {
              env: { ...process.env, LC_ALL: 'C' },
            },
          );
          const store = createStore();

          try {
            await waitForChildReady(child);
            expect(await acquire(store, 150)).toBe(false);
          } finally {
            await stopChild(child);
          }
          expect(await acquire(store, 1_000)).toBe(true);
          await release(store);
        },
      );
    },
  );
});
