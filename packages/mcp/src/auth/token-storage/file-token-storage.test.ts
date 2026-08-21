/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Envelope-only (no legacy hex-colon read) mock-fs unit tests for
 * FileTokenStorage CRUD edge cases.
 *
 * FileTokenStorage is envelope-only: every write produces a v:2 envelope and
 * any content that is not a versioned envelope (including legacy hex-colon
 * content) fails closed as "Token file corrupted". The v:2 envelope security
 * behavior is covered by `file-token-storage.behavior.test.ts` using real
 * temp directories. This file retains mock-fs coverage for filesystem edge
 * cases (ENOENT, mkdir/write errors, path construction).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { decryptEnvelopeString } from '@vybestack/llxprt-code-storage/storage/envelope-codec.js';
import { FileTokenStorage } from './file-token-storage.js';
import type { MCPOAuthCredentials } from '../token-store.js';

// The service name FileTokenStorage passes to the envelope codec is the
// constructor argument; this suite always constructs it with 'test-storage'.
const ENVELOPE_SERVICE_NAME = 'test-storage';

/**
 * Decrypts an on-disk v:2 envelope written by FileTokenStorage (under the
 * injected FIXED_SECRET) back into the stored credential map, so write-path
 * tests can assert the *actual* persisted content (merge/delete correctness),
 * not merely that `writeFile` was called.
 */
async function decryptWrittenEnvelope(
  written: string,
): Promise<Record<string, MCPOAuthCredentials>> {
  // Fail loudly if the written content is not a v:2 envelope.
  const parsed = JSON.parse(written) as { v: number };
  expect(parsed.v).toBe(2);
  const plaintext = await decryptEnvelopeString(
    written,
    ENVELOPE_SERVICE_NAME,
    {
      machineSecretLoader: fixedSecretLoader(),
    },
  );
  return JSON.parse(plaintext) as Record<string, MCPOAuthCredentials>;
}

/**
 * Builds legacy `iv:authTag:ciphertext` (hex) content so read tests can
 * assert that legacy content FAILS CLOSED now that the legacy read path is
 * gone.
 */
function buildLegacyHexColon(plaintext: string): string {
  const salt = `test-host-test-user-llxprt-cli`;
  const key = crypto.scryptSync('llxprt-cli-oauth', salt, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Encrypts a credential map into a v:2 envelope using the fixed test secret,
 * for tests that need to simulate "a real v:2 on disk" before a read.
 */
async function buildV2Envelope(
  credentials: Record<string, MCPOAuthCredentials>,
): Promise<string> {
  const { encryptEnvelopeString } = await import(
    '@vybestack/llxprt-code-storage/storage/envelope-codec.js'
  );
  return encryptEnvelopeString(
    JSON.stringify(credentials),
    ENVELOPE_SERVICE_NAME,
    { machineSecretLoader: fixedSecretLoader() },
  );
}

void vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
    chmod: vi.fn(),
  },
}));

void vi.mock('node:os', () => ({
  default: {
    homedir: vi.fn(() => '/home/test'),
    hostname: vi.fn(() => 'test-host'),
    userInfo: vi.fn(() => ({ username: 'test-user' })),
    tmpdir: vi.fn(() => '/tmp'),
  },
  homedir: vi.fn(() => '/home/test'),
  hostname: vi.fn(() => 'test-host'),
  userInfo: vi.fn(() => ({ username: 'test-user' })),
  tmpdir: vi.fn(() => '/tmp'),
}));

const FIXED_SECRET = crypto.randomBytes(32);
function fixedSecretLoader(): () => Promise<Buffer | null> {
  return async () => FIXED_SECRET;
}

describe('FileTokenStorage (envelope-only)', () => {
  let storage: FileTokenStorage;
  const mockFs = fs as unknown as {
    readFile: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    unlink: ReturnType<typeof vi.fn>;
    mkdir: ReturnType<typeof vi.fn>;
    chmod: ReturnType<typeof vi.fn>;
  };
  const existingCredentials: MCPOAuthCredentials = {
    serverName: 'existing-server',
    token: {
      accessToken: 'existing-token',
      tokenType: 'Bearer',
    },
    updatedAt: Date.now() - 10000,
  };
  const CONFIG_HOME = path.resolve(
    path.join(os.tmpdir(), 'llxprt-test-config-home'),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    // FileTokenStorage resolves its path from Storage.getGlobalDataDir(),
    // which prefers LLXPRT_DATA_HOME, then LLXPRT_CONFIG_HOME, then the
    // platform default. The storage-isolation bootstrap sets all of these to
    // separate temp subdirs, so we must override LLXPRT_DATA_HOME (not just
    // LLXPRT_CONFIG_HOME) to make the mock-fs assertions match.
    process.env['LLXPRT_DATA_HOME'] = CONFIG_HOME;
    process.env['LLXPRT_CONFIG_HOME'] = CONFIG_HOME;
    // chmod is invoked after every write to tighten permissions on overwrite;
    // default it to resolve so write-path tests do not need to wire it up.
    mockFs.chmod.mockResolvedValue(undefined);
    storage = new FileTokenStorage('test-storage', {
      machineSecretLoader: fixedSecretLoader(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env['LLXPRT_DATA_HOME'];
    delete process.env['LLXPRT_CONFIG_HOME'];
  });

  describe('getCredentials', () => {
    it('should return null when file does not exist', async () => {
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

      const result = await storage.getCredentials('test-server');
      expect(result).toBeNull();
    });

    it('should fail closed with "Token file corrupted" for a legacy hex-colon file', async () => {
      const credentials: MCPOAuthCredentials = {
        serverName: 'test-server',
        token: {
          accessToken: 'access-token',
          tokenType: 'Bearer',
          expiresAt: Date.now() + 3600000,
        },
        updatedAt: Date.now(),
      };

      const encryptedData = buildLegacyHexColon(
        JSON.stringify({ 'test-server': credentials }),
      );
      mockFs.readFile.mockResolvedValue(encryptedData);

      await expect(storage.getCredentials('test-server')).rejects.toThrow(
        'Token file corrupted',
      );
    });

    it('should fail closed with "Token file corrupted" for non-envelope garbage', async () => {
      mockFs.readFile.mockResolvedValue('not-an-envelope');

      await expect(storage.getCredentials('test-server')).rejects.toThrow(
        'Token file corrupted',
      );
    });
  });

  describe('setCredentials', () => {
    it('should create new file writing a v:2 envelope when file does not exist', async () => {
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const credentials: MCPOAuthCredentials = {
        serverName: 'new-server',
        token: {
          accessToken: 'new-token',
          tokenType: 'Bearer',
        },
        updatedAt: Date.now(),
      };

      await storage.setCredentials(credentials);

      expect(mockFs.mkdir).toHaveBeenCalledWith(CONFIG_HOME, {
        recursive: true,
        mode: 0o700,
      });
      expect(mockFs.writeFile).toHaveBeenCalled();

      const writeCall = mockFs.writeFile.mock.calls[0];
      const written = writeCall[1] as string;
      const parsed = JSON.parse(written) as { v: number };
      expect(parsed.v).toBe(2);
      expect(writeCall[2]).toStrictEqual({ mode: 0o600 });

      // Decrypt the persisted envelope and verify the credential map actually
      // round-trips (a write that produced a v:2 envelope of the *wrong*
      // content would pass the version check above but fail here).
      const stored = await decryptWrittenEnvelope(written);
      expect(Object.keys(stored)).toStrictEqual(['new-server']);
      expect(stored['new-server'].token.accessToken).toBe('new-token');
    });

    it.skipIf(process.platform === 'win32')(
      'should update existing credentials',
      async () => {
        mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });
        mockFs.writeFile.mockResolvedValue(undefined);

        const newCredentials: MCPOAuthCredentials = {
          serverName: 'test-server',
          token: {
            accessToken: 'new-token',
            tokenType: 'Bearer',
          },
          updatedAt: Date.now(),
        };

        await storage.setCredentials(newCredentials);

        expect(mockFs.writeFile).toHaveBeenCalled();

        // Decrypt the written v:2 envelope and verify the merge: the pre-existing
        // entry is preserved AND the new entry is added (a broken merge that
        // overwrites instead of merging would be caught here).
        const writeCall = mockFs.writeFile.mock.calls[0];
        const stored = await decryptWrittenEnvelope(writeCall[1] as string);
        expect(stored['test-server'].token.accessToken).toBe('new-token');
      },
    );

    it('should fail closed when no machine secret can read a v:2 file', async () => {
      // This store has no machine-secret loader. Read of the v:2 envelope then
      // fails closed through the codec because no secret is available.
      const reader = new FileTokenStorage('test-storage', {
        machineSecretLoader: async () => null,
      });
      mockFs.readFile.mockResolvedValue(
        await buildV2Envelope({ 'secret-A': existingCredentials }),
      );

      await expect(reader.getCredentials('secret-A')).rejects.toThrow(
        'Token file corrupted',
      );
    });

    // Production tightens permissions with chmod only on POSIX platforms
    // (it is skipped when process.platform === 'win32'), so the chmod-failure
    // branch cannot be exercised on Windows.
    it.skipIf(process.platform === 'win32')(
      'should remove the file and throw when post-write chmod fails',
      async () => {
        // The file is written, but tightening its permissions fails. Production
        // must remove the just-written file (so credentials are never left on
        // disk with loose permissions) and surface an error distinct from a
        // write failure.
        mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });
        mockFs.mkdir.mockResolvedValue(undefined);
        mockFs.writeFile.mockResolvedValue(undefined);
        mockFs.chmod.mockRejectedValue(new Error('EACCES'));
        mockFs.unlink.mockResolvedValue(undefined);

        const credentials: MCPOAuthCredentials = {
          serverName: 'new-server',
          token: {
            accessToken: 'new-token',
            tokenType: 'Bearer',
          },
          updatedAt: Date.now(),
        };

        await expect(storage.setCredentials(credentials)).rejects.toThrow(
          /permissions could not be restricted/,
        );
        expect(mockFs.unlink).toHaveBeenCalledWith(
          path.join(CONFIG_HOME, 'mcp-oauth-tokens-v2.json'),
        );
      },
    );

    it.skipIf(process.platform === 'win32')(
      'should report when cleanup unlink also fails after chmod failure',
      async () => {
        // Worst case: chmod fails AND the cleanup unlink fails. The thrown error
        // must NOT falsely claim the file was removed; it must warn that
        // credentials may remain on disk with overly permissive permissions.
        mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });
        mockFs.mkdir.mockResolvedValue(undefined);
        mockFs.writeFile.mockResolvedValue(undefined);
        mockFs.chmod.mockRejectedValue(new Error('EACCES'));
        mockFs.unlink.mockRejectedValue(new Error('EPERM'));

        const credentials: MCPOAuthCredentials = {
          serverName: 'new-server',
          token: {
            accessToken: 'new-token',
            tokenType: 'Bearer',
          },
          updatedAt: Date.now(),
        };

        await expect(storage.setCredentials(credentials)).rejects.toThrow(
          /could not be removed/,
        );
      },
    );
  });

  describe('deleteCredentials', () => {
    it('should throw when credentials do not exist in empty storage', async () => {
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

      await expect(storage.deleteCredentials('test-server')).rejects.toThrow(
        'No credentials found for test-server',
      );
    });

    it('should delete file when last credential is removed', async () => {
      mockFs.readFile.mockResolvedValue(
        await buildV2Envelope({ 'test-server': existingCredentials }),
      );
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.unlink.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);

      await storage.setCredentials({
        serverName: 'test-server',
        token: {
          accessToken: 'access-token',
          tokenType: 'Bearer',
        },
        updatedAt: Date.now(),
      });

      // A file now exists: setCredentials wrote one. Delete it; after the last
      // credential is removed the file is deleted.
      await storage.deleteCredentials('test-server');
      expect(mockFs.unlink).toHaveBeenCalledWith(
        path.join(CONFIG_HOME, 'mcp-oauth-tokens-v2.json'),
      );
    });

    it('should update file when other credentials remain', async () => {
      mockFs.readFile.mockResolvedValue(
        await buildV2Envelope({ 'test-server': existingCredentials }),
      );
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.unlink.mockResolvedValue(undefined);
      mockFs.chmod.mockResolvedValue(undefined);

      const credentials2: MCPOAuthCredentials = {
        serverName: 'server2',
        token: {
          accessToken: 'token2',
          tokenType: 'Bearer',
        },
        updatedAt: Date.now(),
      };

      await storage.setCredentials(credentials2);

      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(mockFs.unlink).not.toHaveBeenCalled();

      // Decrypt the written v:2 envelope and verify the deletion: the removed
      // server is gone AND the remaining server is preserved (a broken delete
      // that writes back the deleted entry or drops the survivor is caught).
      const writeCall = mockFs.writeFile.mock.calls[0];
      const stored = await decryptWrittenEnvelope(writeCall[1] as string);
      expect(Object.keys(stored).sort()).toStrictEqual(
        ['test-server', 'server2'].sort(),
      );
      expect(stored['test-server']).toStrictEqual(existingCredentials);
      expect(stored['server2'].serverName).toBe('server2');
      expect(stored['server2'].token).toStrictEqual(credentials2.token);
    });
  });

  describe('listServers', () => {
    it('should return empty list when file does not exist', async () => {
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

      const result = await storage.listServers();
      expect(result).toStrictEqual([]);
    });
  });

  describe('clearAll', () => {
    it('should delete the token file', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      await storage.clearAll();

      expect(mockFs.unlink).toHaveBeenCalledWith(
        path.join(CONFIG_HOME, 'mcp-oauth-tokens-v2.json'),
      );
    });

    it('should not throw when file does not exist', async () => {
      mockFs.unlink.mockRejectedValue({ code: 'ENOENT' });

      await expect(storage.clearAll()).resolves.toBeUndefined();
    });
  });
});
