/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for Phase 33: Factory Function + Detection Wiring
 * @plan:PLAN-20250214-CREDPROXY.P33
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createTokenStore,
  createProviderKeyStorage,
  resetFactorySingletons,
} from '../credential-store-factory.js';
import { OAuthManager } from '../../oauth-manager.js';

const VALID_TOKEN = 'a'.repeat(64);
const FACTORY_MODULE_PATH = fileURLToPath(
  new URL('../credential-store-factory.ts', import.meta.url),
);
const CHILD_RUNTIME = 'bun';

function runBashChild(bashScript: string): ReturnType<typeof spawnSync> {
  return spawnSync(
    'env',
    ['-u', 'BASH_ENV', 'bash', '--noprofile', '--norc', '-c', bashScript],
    { encoding: 'utf8' },
  );
}

describe('Factory Detection Wiring (P33)', () => {
  let originalSocketEnv: string | undefined;
  let originalFdEnv: string | undefined;
  let tmpDir: string;

  beforeEach(() => {
    originalSocketEnv = process.env.LLXPRT_CREDENTIAL_SOCKET;
    originalFdEnv = process.env.LLXPRT_CAPABILITY_FD;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-'));
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    delete process.env.LLXPRT_CAPABILITY_FD;
    delete process.env.LLXPRT_CAPABILITY_TOKEN;
    resetFactorySingletons();
  });

  afterEach(() => {
    if (originalSocketEnv !== undefined)
      process.env.LLXPRT_CREDENTIAL_SOCKET = originalSocketEnv;
    else delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    if (originalFdEnv !== undefined)
      process.env.LLXPRT_CAPABILITY_FD = originalFdEnv;
    else delete process.env.LLXPRT_CAPABILITY_FD;
    delete process.env.LLXPRT_CAPABILITY_TOKEN;
    resetFactorySingletons();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createTokenStore factory', () => {
    it('returns KeyringTokenStore when LLXPRT_CREDENTIAL_SOCKET is not set', () => {
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
      const store = createTokenStore();
      expect(store).toBeDefined();
      expect(typeof store.getToken).toBe('function');
    });

    it('returns ProxyTokenStore when LLXPRT_CREDENTIAL_SOCKET is set', () => {
      process.env.LLXPRT_CREDENTIAL_SOCKET = '/tmp/test-socket.sock';
      expect(createTokenStore()).toBeDefined();
    });

    it('returns singleton instances (caches per mode)', () => {
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
      expect(createTokenStore()).toBe(createTokenStore());
    });

    it('returns different singletons for different modes', () => {
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
      const directStore = createTokenStore();
      process.env.LLXPRT_CREDENTIAL_SOCKET = '/tmp/test-socket.sock';
      expect(directStore).not.toBe(createTokenStore());
    });
  });

  describe('createProviderKeyStorage factory', () => {
    it('clears all proxy state when switching to direct mode', () => {
      process.env.LLXPRT_CREDENTIAL_SOCKET = '/tmp/test-socket.sock';
      const proxyTokenStore = createTokenStore();
      createProviderKeyStorage();
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
      createProviderKeyStorage();
      process.env.LLXPRT_CREDENTIAL_SOCKET = '/tmp/test-socket.sock';
      expect(createTokenStore()).not.toBe(proxyTokenStore);
    });

    const KEY_STORAGE_METHODS = [
      'getKey',
      'saveKey',
      'deleteKey',
      'hasKey',
      'listKeys',
    ] as const;

    it.each([
      ['direct', undefined],
      ['proxy', '/tmp/test-socket.sock'],
    ] as const)(
      'returns %s storage with the correct interface',
      (_mode, socket) => {
        process.env.LLXPRT_CREDENTIAL_SOCKET = socket;
        const storage = createProviderKeyStorage() as Record<string, unknown>;
        expect(storage).toBeDefined();
        expect(
          KEY_STORAGE_METHODS.every((m) => typeof storage[m] === 'function'),
        ).toBe(true);
      },
    );

    it('returns singleton instances (caches per mode)', () => {
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
      expect(createProviderKeyStorage()).toBe(createProviderKeyStorage());
    });
  });

  describe('OAuthManager proactive renewal (R16.8)', () => {
    function getRenewalManager(socketEnv: string | undefined) {
      if (socketEnv !== undefined)
        process.env.LLXPRT_CREDENTIAL_SOCKET = socketEnv;
      else delete process.env.LLXPRT_CREDENTIAL_SOCKET;
      return (
        new OAuthManager(createTokenStore()) as unknown as {
          proactiveRenewalManager: { clearAllTimers: () => void };
        }
      ).proactiveRenewalManager;
    }

    it('skips proactive renewal scheduling in proxy mode', () => {
      expect(getRenewalManager('/tmp/test-socket.sock')).toBeDefined();
    });

    it('schedules proactive renewal in direct mode', () => {
      expect(getRenewalManager(undefined)).toBeDefined();
    });
  });

  describe('resetFactorySingletons', () => {
    it('clears cached TokenStore instances', () => {
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
      const store1 = createTokenStore();
      resetFactorySingletons();
      expect(store1).not.toBe(createTokenStore());
    });

    it('clears cached proxy instances when in proxy mode', () => {
      process.env.LLXPRT_CREDENTIAL_SOCKET = '/tmp/test-socket.sock';
      const store1 = createTokenStore();
      const storage1 = createProviderKeyStorage();
      resetFactorySingletons();
      expect(store1).not.toBe(createTokenStore());
      expect(storage1).not.toBe(createProviderKeyStorage());
    });

    it('factory internal cache is cleared for direct key storage', () => {
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
      const storage1 = createProviderKeyStorage();
      resetFactorySingletons();
      expect(storage1).toBe(createProviderKeyStorage());
    });
  });

  describe('Consumer code wiring verification', () => {
    it('verifies factory functions are importable', async () => {
      const factory = await import('../credential-store-factory.js');
      expect(typeof factory.createTokenStore).toBe('function');
      expect(typeof factory.createProviderKeyStorage).toBe('function');
      expect(typeof factory.resetFactorySingletons).toBe('function');
    });

    it('verifies token store factory returns TokenStore interface', () => {
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
      const store = createTokenStore() as Record<string, unknown>;
      expect(
        (
          [
            'getToken',
            'saveToken',
            'removeToken',
            'listProviders',
            'listBuckets',
          ] as const
        ).every((m) => typeof store[m] === 'function'),
      ).toBe(true);
    });

    it('verifies provider key storage factory returns ProviderKeyStorage interface', () => {
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
      const storage = createProviderKeyStorage() as Record<string, unknown>;
      expect(
        (
          ['getKey', 'saveKey', 'deleteKey', 'hasKey', 'listKeys'] as const
        ).every((m) => typeof storage[m] === 'function'),
      ).toBe(true);
    });
  });

  describe.skipIf(process.platform === 'win32')(
    'AC3: fd3 consumption on first proxy factory use',
    () => {
      function runFactoryChild(
        token: string,
        socketPath: string,
        childScript: string,
      ) {
        const bashScript = [
          `exec 3<<<"${token}"`,
          `LLXPRT_CREDENTIAL_SOCKET=${JSON.stringify(socketPath)} LLXPRT_CAPABILITY_FD=3 exec ${CHILD_RUNTIME} -e ${JSON.stringify(childScript)}`,
        ].join('\n');
        const result = runBashChild(bashScript);
        return {
          exit: result.status ?? -1,
          stdout: result.stdout.trim(),
          stderr: result.stderr.trim(),
        };
      }

      it('caches the consumed token in module-private state shared by both factories within one process', () => {
        const childScript = [
          `const { createTokenStore, createProviderKeyStorage } = require(${JSON.stringify(FACTORY_MODULE_PATH)});`,
          'let threw = null; try { createTokenStore(); createProviderKeyStorage(); } catch (e) { threw = e.message; }',
          'process.stdout.write(JSON.stringify({ threw }));',
        ].join('');
        const result = runFactoryChild(
          VALID_TOKEN,
          path.join(tmpDir, 'shared.sock'),
          childScript,
        );
        expect(result.exit).toBe(0);
        expect(
          (JSON.parse(result.stdout) as { threw: string | null }).threw,
        ).toBeNull();
      });

      type FactoryOp = 'tokenStore' | 'keyStorage';
      function fdConsumeScript(op: FactoryOp): string {
        const fnName =
          op === 'tokenStore' ? 'createTokenStore' : 'createProviderKeyStorage';
        return [
          `const { ${fnName}, resetFactorySingletons } = require(${JSON.stringify(FACTORY_MODULE_PATH)});`,
          'const fs = require("node:fs");',
          'const fd = Number(process.env.LLXPRT_CAPABILITY_FD || "3");',
          'let threw = null;',
          `try { ${fnName}(); } catch (e) { threw = e.message; }`,
          'let fdClosed = false;',
          'try { const b = Buffer.alloc(8); fs.readSync(fd, b, 0, 8, null); fdClosed = false; } catch (e) { fdClosed = true; }',
          'const capKeys = Object.keys(process.env).filter((k) => k.startsWith("LLXPRT_CAPABILITY"));',
          'process.stdout.write(JSON.stringify({ threw, markerGone: process.env.LLXPRT_CAPABILITY_FD === undefined, fdClosed, capKeys }));',
        ].join('');
      }

      type FdConsumePayload = {
        threw: string | null;
        markerGone: boolean;
        fdClosed: boolean;
        capKeys: string[];
      };

      it.each([
        ['tokenStore', 'proxy-token.sock'],
        ['keyStorage', 'proxy-keys.sock'],
      ] as const)(
        'consumes fd 3, closes it, scrubs the marker for %s',
        (_op, socketName) => {
          const result = runFactoryChild(
            VALID_TOKEN,
            path.join(tmpDir, socketName),
            fdConsumeScript(_op),
          );
          expect(result.exit).toBe(0);
          expect(result.stderr).toBe('');
          const payload = JSON.parse(result.stdout) as FdConsumePayload;
          expect(payload.threw).toBeNull();
          expect(payload.markerGone).toBe(true);
          expect(payload.fdClosed).toBe(true);
          expect(payload.capKeys).toStrictEqual([]);
        },
      );
    },
  );

  describe('AC4 (marker-only): invalid LLXPRT_CAPABILITY_FD markers fail fast', () => {
    function runMarkerOnlyChild(fdValue: string, socketName: string) {
      const childScript = [
        `const { createTokenStore } = require(${JSON.stringify(FACTORY_MODULE_PATH)});`,
        'let threw = null; try { createTokenStore(); } catch (e) { threw = e.message; }',
        'process.stdout.write(JSON.stringify({ threw, markerGone: process.env.LLXPRT_CAPABILITY_FD === undefined }));',
      ].join('');
      const result = spawnSync(CHILD_RUNTIME, ['-e', childScript], {
        encoding: 'utf8',
        env: {
          ...process.env,
          LLXPRT_CREDENTIAL_SOCKET: path.join(tmpDir, socketName),
          LLXPRT_CAPABILITY_FD: fdValue,
        },
      });
      if (result.error) {
        throw new Error(
          `Child process spawn failed for marker "${fdValue}": ${result.error.message}`,
        );
      }
      return {
        status: result.status,
        payload: JSON.parse(result.stdout.trim()) as {
          threw: string | null;
          markerGone: boolean;
        },
      };
    }

    it('rejects every LLXPRT_CAPABILITY_FD marker except exactly "3" (incl. stdin/stdout/stderr)', () => {
      for (const marker of ['0', '1', '2', '4', '5', '-1', '3.0', '03', '3x']) {
        const result = runMarkerOnlyChild(marker, `reject-${marker}.sock`);
        expect(result.status).toBe(0);
        expect(result.payload.threw).toMatch(
          /capability transport marker|invalid/i,
        );
        expect(result.payload.markerGone).toBe(true);
      }
    });
  });

  describe.skipIf(process.platform === 'win32')(
    'AC4: fd3 transport errors fail fast',
    () => {
      function runErrorChild(
        socketName: string,
        fdValue: string,
        fdSetup: string,
      ) {
        const childScript = [
          `const { createTokenStore } = require(${JSON.stringify(FACTORY_MODULE_PATH)});`,
          'let threw = null; try { createTokenStore(); } catch (e) { threw = e.message; }',
          'process.stdout.write(JSON.stringify({ threw, markerGone: process.env.LLXPRT_CAPABILITY_FD === undefined }));',
        ].join('');
        const fdLines = fdSetup ? `${fdSetup}\n` : '';
        const bashScript = `${fdLines}LLXPRT_CREDENTIAL_SOCKET=${JSON.stringify(path.join(tmpDir, socketName))} LLXPRT_CAPABILITY_FD=${fdValue} exec ${CHILD_RUNTIME} -e ${JSON.stringify(childScript)}`;
        const result = runBashChild(bashScript);
        expect(result.status).toBe(0);
        return JSON.parse(result.stdout.trim()) as {
          threw: string | null;
          markerGone: boolean;
        };
      }

      it.each([
        {
          socket: 'noread.sock',
          fdValue: '3',
          fdSetup: '',
          threwPattern: /capability descriptor/i,
        },
        {
          socket: 'malformed.sock',
          fdValue: '3',
          fdSetup: 'exec 3<<<"not-a-valid-token"',
          threwPattern: /capability descriptor/i,
        },
        {
          socket: 'empty.sock',
          fdValue: '3',
          fdSetup: 'exec 3<<<""',
          threwPattern: /capability descriptor/i,
        },
        {
          socket: 'badfd.sock',
          fdValue: 'abc',
          fdSetup: '',
          threwPattern: /capability transport marker/i,
        },
      ])(
        'throws on invalid fd transport ($socket)',
        ({ socket, fdValue, fdSetup, threwPattern }) => {
          const p = runErrorChild(socket, fdValue, fdSetup);
          expect(p.threw).toMatch(threwPattern);
          expect(p.markerGone).toBe(true);
        },
      );

      it('O18: accepts exactly marker "3" and scrubs it after consumption', () => {
        const p = runErrorChild(
          'accept3.sock',
          '3',
          `exec 3<<<"${VALID_TOKEN}"`,
        );
        expect(p.threw).toBeNull();
        expect(p.markerGone).toBe(true);
      });

      it('throws on duplicate transport: a second marker supplied after consumption', () => {
        const childScript = [
          `const { createTokenStore, createProviderKeyStorage } = require(${JSON.stringify(FACTORY_MODULE_PATH)});`,
          'let firstOk = null; try { createTokenStore(); firstOk = true; } catch (e) { firstOk = e.message; }',
          'process.env.LLXPRT_CAPABILITY_FD = "3";',
          'let dupThrew = null; try { createProviderKeyStorage(); } catch (e) { dupThrew = e.message; }',
          'process.stdout.write(JSON.stringify({ firstOk, dupThrew }));',
        ].join('');
        const bashScript = [
          `exec 3<<<"${VALID_TOKEN}"`,
          `LLXPRT_CREDENTIAL_SOCKET=${JSON.stringify(path.join(tmpDir, 'dup.sock'))} LLXPRT_CAPABILITY_FD=3 exec ${CHILD_RUNTIME} -e ${JSON.stringify(childScript)}`,
        ].join('\n');
        const result = runBashChild(bashScript);
        expect(result.status).toBe(0);
        const payload = JSON.parse(result.stdout.trim()) as {
          firstOk: boolean | string | null;
          dupThrew: string | null;
        };
        expect(payload.firstOk).toBe(true);
        expect(payload.dupThrew).toMatch(/duplicate capability transport/i);
      });

      it('throws when a capability descriptor is supplied without a proxy socket', () => {
        const childScript = [
          `const { createTokenStore } = require(${JSON.stringify(FACTORY_MODULE_PATH)});`,
          'let threw = null; try { createTokenStore(); } catch (e) { threw = e.message; }',
          'process.stdout.write(JSON.stringify({ threw, markerGone: process.env.LLXPRT_CAPABILITY_FD === undefined }));',
        ].join('');
        const bashScript = [
          `exec 3<<<"${VALID_TOKEN}"`,
          `LLXPRT_CAPABILITY_FD=3 exec ${CHILD_RUNTIME} -e ${JSON.stringify(childScript)}`,
        ].join('\n');
        const result = runBashChild(bashScript);
        const payload = JSON.parse(result.stdout.trim()) as {
          threw: string | null;
          markerGone: boolean;
        };
        expect(payload.threw).toMatch(/requires LLXPRT_CREDENTIAL_SOCKET/i);
        expect(payload.markerGone).toBe(true);
      });
    },
  );

  describe.skipIf(process.platform === 'win32')(
    'AC5: descendant process cannot recover the token',
    () => {
      it('a model descendant spawned after consumption has no capability env, fd authority, or marker', () => {
        const probeScript = [
          'const fs = require("node:fs");',
          'const capKeys = Object.keys(process.env).filter((k) => k.startsWith("LLXPRT_CAPABILITY"));',
          'let fd3Capability = false;',
          'try { const b = Buffer.alloc(128); const n = fs.readSync(3, b, 0, 128, null); fd3Capability = b.subarray(0, n).toString("utf8").includes(' +
            JSON.stringify(VALID_TOKEN) +
            '); } catch (e) { fd3Capability = false; }',
          'process.stdout.write(JSON.stringify({ capKeys, fd3Capability }));',
        ].join('');
        const childScript = [
          'const { spawnSync } = require("node:child_process");',
          `const { createTokenStore } = require(${JSON.stringify(FACTORY_MODULE_PATH)});`,
          'createTokenStore();',
          `const r = spawnSync(${JSON.stringify(CHILD_RUNTIME)}, ["-e", ${JSON.stringify(probeScript)}], { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "inherit"] });`,
          'process.stdout.write(r.stdout);',
        ].join('');
        const bashScript = [
          `exec 3<<<"${VALID_TOKEN}"`,
          `LLXPRT_CREDENTIAL_SOCKET=${JSON.stringify(path.join(tmpDir, 'child.sock'))} LLXPRT_CAPABILITY_FD=3 exec ${CHILD_RUNTIME} -e ${JSON.stringify(childScript)}`,
        ].join('\n');
        const result = runBashChild(bashScript);
        expect(result.status).toBe(0);
        const payload = JSON.parse(result.stdout.trim()) as {
          capKeys: string[];
          fd3Capability: boolean;
        };
        expect(payload.capKeys).toStrictEqual([]);
        expect(payload.fd3Capability).toBe(false);
      });
    },
  );

  describe('AC8: tokenless/direct behavior when no fd marker is supplied', () => {
    it('returns KeyringTokenStore without consuming any descriptor', () => {
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
      delete process.env.LLXPRT_CAPABILITY_FD;
      expect(createTokenStore()).toBeDefined();
    });

    it('returns direct ProviderKeyStorage without consuming any descriptor', () => {
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
      delete process.env.LLXPRT_CAPABILITY_FD;
      expect(createProviderKeyStorage()).toBeDefined();
    });
  });

  describe('AC3/AC8: resetFactorySingletons clears cached capability token', () => {
    it('clears the cached capability token so no token is retained after reset', () => {
      process.env.LLXPRT_CREDENTIAL_SOCKET = path.join(tmpDir, 'reset.sock');
      resetFactorySingletons();
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
      delete process.env.LLXPRT_CAPABILITY_FD;
      expect(createTokenStore()).toBeDefined();
    });

    describe.skipIf(process.platform === 'win32')(
      'O17 POSIX capability transport',
      () => {
        it('O17: warm, reset, and no-reuse happen within one process sharing one module cache', async () => {
          const { CredentialProxyServer } = await import(
            '../credential-proxy-server.js'
          );
          const inMemStore = {
            async saveToken(): Promise<void> {},
            async getToken(): Promise<null> {
              return null;
            },
            async removeToken(): Promise<void> {},
            async listProviders(): Promise<string[]> {
              return [];
            },
            async listBuckets(): Promise<string[]> {
              return [];
            },
            async getBucketStats(): Promise<null> {
              return null;
            },
            async acquireRefreshLock(): Promise<boolean> {
              return true;
            },
            async releaseRefreshLock(): Promise<void> {},
            async acquireAuthLock(): Promise<boolean> {
              return true;
            },
            async releaseAuthLock(): Promise<void> {},
          };
          const inMemKeys = {
            async getKey(): Promise<null> {
              return null;
            },
            async saveKey(): Promise<void> {},
            async deleteKey(): Promise<boolean> {
              return false;
            },
            async hasKey(): Promise<boolean> {
              return false;
            },
            async listKeys(): Promise<string[]> {
              return [];
            },
          };
          const mkServer = (token: string) =>
            new CredentialProxyServer({
              tokenStore: inMemStore as never,
              providerKeyStorage: inMemKeys as never,
              socketDir: tmpDir,
              capabilityToken: token,
            });
          const session1Token = 'a'.repeat(64);
          const session2Token = 'b'.repeat(64);
          const server1 = mkServer(session1Token);
          const socket1 = await server1.start();
          const server2 = mkServer(session2Token);
          const socket2 = await server2.start();
          try {
            const token2File = path.join(tmpDir, 'o17-token2.txt');
            fs.writeFileSync(token2File, session2Token + '\n');
            const grandchildFile = path.join(tmpDir, 'o17-grandchild.ts');
            const childFile = path.join(tmpDir, 'o17-child.ts');
            const childSrc = [
              `import { createTokenStore, resetFactorySingletons } from ${JSON.stringify(FACTORY_MODULE_PATH)};`,
              'import { spawnSync } from "node:child_process";',
              'const socket1 = process.env.S1!;',
              'const socket2 = process.env.S2!;',
              'const token2File = process.env.T2!;',
              'const grandchildFile = process.env.GC!;',
              'const runtime = process.env.RT!;',
              'process.env.LLXPRT_CREDENTIAL_SOCKET = socket1;',
              'let threw1: string | null = null;',
              'try { createTokenStore(); } catch (e) { threw1 = (e as Error).message; }',
              'const markerGone1 = process.env.LLXPRT_CAPABILITY_FD === undefined;',
              'resetFactorySingletons();',
              'const gb = "exec 3<" + JSON.stringify(token2File) + "\\nLLXPRT_CAPABILITY_FD=3 " + runtime + " " + JSON.stringify(grandchildFile);',
              'const gr = spawnSync("env", ["-u","BASH_ENV","bash","--noprofile","--norc","-c", gb], { encoding: "utf8", env: { ...process.env, LLXPRT_CREDENTIAL_SOCKET: socket2 } });',
              'let threw2: string | null = null, markerGone2 = false;',
              'if (gr.status === 0) {',
              '  const p = JSON.parse(gr.stdout.trim());',
              '  threw2 = p.t2; markerGone2 = p.m2;',
              '} else { threw2 = "grandchild exit " + gr.status + ": " + gr.stderr; }',
              'process.stdout.write(JSON.stringify({ threw1, markerGone1, threw2, markerGone2 }));',
            ].join('\n');
            const grandchildSrc = [
              `import { createTokenStore } from ${JSON.stringify(FACTORY_MODULE_PATH)};`,
              'let t2: string | null = null;',
              'try { createTokenStore(); } catch (e) { t2 = (e as Error).message; }',
              'const m2 = process.env.LLXPRT_CAPABILITY_FD === undefined;',
              'process.stdout.write(JSON.stringify({ t2, m2 }));',
            ].join('\n');
            fs.writeFileSync(childFile, childSrc);
            fs.writeFileSync(grandchildFile, grandchildSrc);
            const bashScript = [
              `exec 3<<<"${session1Token}"`,
              `S1=${JSON.stringify(socket1)} S2=${JSON.stringify(socket2)} T2=${JSON.stringify(token2File)} GC=${JSON.stringify(grandchildFile)} RT=${CHILD_RUNTIME} LLXPRT_CAPABILITY_FD=3 exec ${CHILD_RUNTIME} ${JSON.stringify(childFile)}`,
            ].join('\n');
            const result = runBashChild(bashScript);
            expect(result.status).toBe(0);
            expect(result.stderr).toBe('');
            const payload = JSON.parse(result.stdout.trim()) as {
              threw1: string | null;
              markerGone1: boolean;
              threw2: string | null;
              markerGone2: boolean;
            };
            expect(payload.threw1).toBeNull();
            expect(payload.markerGone1).toBe(true);
            expect(payload.threw2).toBeNull();
            expect(payload.markerGone2).toBe(true);
          } finally {
            await server1.stop();
            await server2.stop();
          }
        }, 60000);
      },
    );
  });
});
