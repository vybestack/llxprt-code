/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for FileTokenStorage envelope hardening.
 *
 * These tests exercise the real file system (temp directories) and inject a
 * machine-secret loader so that the v:2 envelope root of trust is exercised
 * end-to-end without mock theater. Legacy hex-colon content is not readable and
 * fails closed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { FileTokenStorage } from './file-token-storage.js';
import { isValidEnvelope } from '@vybestack/llxprt-code-storage';
import { encryptEnvelopeString } from '@vybestack/llxprt-code-storage/storage/envelope-codec.js';
import type { MCPOAuthCredentials } from '../token-store.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

const SERVICE_NAME = 'test-oauth-service';

const MACHINE_SECRET_A = crypto.randomBytes(32);
const MACHINE_SECRET_B = crypto.randomBytes(32);

function secretLoaderA(): () => Promise<Buffer | null> {
  return async () => MACHINE_SECRET_A;
}

function secretLoaderB(): () => Promise<Buffer | null> {
  return async () => MACHINE_SECRET_B;
}

function nullSecretLoader(): () => Promise<Buffer | null> {
  return async () => null;
}

async function createTempTokenFile(): Promise<string> {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'file-token-storage-behavior-'),
  );
  return path.join(dir, 'tokens.json');
}

function makeCredentials(serverName: string): MCPOAuthCredentials {
  return {
    serverName,
    token: {
      accessToken: `access-${serverName}`,
      tokenType: 'Bearer',
    },
    updatedAt: Date.now(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FileTokenStorage — v:2 envelope behavior', () => {
  let tokenFilePath: string;

  beforeEach(async () => {
    tokenFilePath = await createTempTokenFile();
  });

  afterEach(async () => {
    await fs.rm(path.dirname(tokenFilePath), {
      recursive: true,
      force: true,
    });
  });

  it('new writes produce a valid v:2 JSON envelope backed by the machine secret', async () => {
    const storage = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: secretLoaderA(),
    });

    await storage.setCredentials(makeCredentials('server-1'));

    const content = await fs.readFile(tokenFilePath, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    expect(isValidEnvelope(parsed)).toBe(true);
    expect((parsed as { v: number }).v).toBe(2);
  });

  it('round-trips credentials through the v:2 envelope with the same secret', async () => {
    const storage = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: secretLoaderA(),
    });

    const creds = makeCredentials('roundtrip-server');
    await storage.setCredentials(creds);

    // New instance, same secret, same path.
    const reader = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: secretLoaderA(),
    });
    const result = await reader.getCredentials('roundtrip-server');
    expect(result).not.toBeNull();
    expect(result!.serverName).toBe('roundtrip-server');
    expect(result!.token.accessToken).toBe('access-roundtrip-server');
    expect(result!.token.tokenType).toBe('Bearer');
    // setCredentials stamps updatedAt on write; the read returns that stamp.
    expect(typeof result!.updatedAt).toBe('number');
  });

  it('read with a different machine secret fails closed as "Token file corrupted"', async () => {
    const writer = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: secretLoaderA(),
    });
    await writer.setCredentials(makeCredentials('secret-A'));

    const reader = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: secretLoaderB(),
    });

    await expect(reader.getCredentials('secret-A')).rejects.toThrow(
      'Token file corrupted',
    );
  });

  it('read of a v:2 file with no machine secret fails closed as "Token file corrupted"', async () => {
    const writer = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: secretLoaderA(),
    });
    await writer.setCredentials(makeCredentials('needs-secret'));

    const reader = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: nullSecretLoader(),
    });

    await expect(reader.getCredentials('needs-secret')).rejects.toThrow(
      'Token file corrupted',
    );
  });

  it('an unexpected (non-codec) loader error is NOT mislabeled as "Token file corrupted"', async () => {
    // First write a real v:2 file with a working secret loader so a valid
    // envelope exists at tokenFilePath.
    const writer = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: secretLoaderA(),
    });
    await writer.setCredentials(makeCredentials('loader-fault'));

    // Now read with a loader that throws a non-codec error. Because a valid
    // envelope is on disk, readEnvelopeVersion(data) !== null and
    // decryptEnvelopeString is invoked, which calls the throwing loader. The
    // plain Error('keyring exploded') is NOT an EnvelopeCodecError and must
    // propagate unchanged rather than being relabeled.
    const reader = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: async () => {
        throw new Error('keyring exploded');
      },
    });

    await expect(reader.getCredentials('loader-fault')).rejects.toThrow(
      /keyring exploded/,
    );
  });

  it('a SyntaxError from the machine-secret loader is NOT mislabeled as corruption', async () => {
    const writer = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: secretLoaderA(),
    });
    await writer.setCredentials(makeCredentials('syntax-loader'));

    const reader = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: async () => {
        throw new SyntaxError('keyring payload parse failed');
      },
    });

    await expect(reader.getCredentials('syntax-loader')).rejects.toThrow(
      /keyring payload parse failed/,
    );
  });

  it('fail-closed-on-read prevents overwrite of existing v:2 file with unavailable secret', async () => {
    const writer = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: secretLoaderA(),
    });
    await writer.setCredentials(makeCredentials('protected'));

    const beforeContent = await fs.readFile(tokenFilePath, 'utf-8');
    const beforeEnvelope = JSON.parse(beforeContent) as { v: number };
    expect(beforeEnvelope.v).toBe(2);

    // Attempt to mutate with no machine secret — must reject and leave the
    // existing v:2 file intact. Every mutation reads-then-writes: the read
    // fails closed on the v:2 envelope (missing secret) before any write can
    // occur, so the existing v:2 file is never overwritten.
    const degradedWriter = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: nullSecretLoader(),
    });
    await expect(
      degradedWriter.setCredentials(makeCredentials('protected')),
    ).rejects.toThrow(/Token file corrupted/);

    // File must be byte-identical.
    const afterContent = await fs.readFile(tokenFilePath, 'utf-8');
    expect(afterContent).toBe(beforeContent);

    // Original secret still reads the original value.
    const result = await writer.getCredentials('protected');
    expect(result?.token.accessToken).toBe('access-protected');
  });

  it('a decryptable envelope whose payload is malformed JSON fails closed', async () => {
    // Encrypt token-store-shaped JSON that is not valid JSON (here, trailing
    // garbage). The envelope decrypts fine but the payload must be rejected as
    // "Token file corrupted" rather than surfacing a raw parse error.
    const invalidPayload = '{"server-a": {"not": "closed"';
    const encrypted = await encryptEnvelopeString(
      invalidPayload,
      SERVICE_NAME,
      { machineSecretLoader: secretLoaderA() },
    );
    await fs.mkdir(path.dirname(tokenFilePath), {
      recursive: true,
      mode: 0o700,
    });
    await fs.writeFile(tokenFilePath, encrypted, { mode: 0o600 });

    const reader = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: secretLoaderA(),
    });

    await expect(reader.listServers()).rejects.toThrow('Token file corrupted');
  });

  it('a decryptable envelope whose payload is JSON null fails closed', async () => {
    const encrypted = await encryptEnvelopeString('null', SERVICE_NAME, {
      machineSecretLoader: secretLoaderA(),
    });
    await fs.mkdir(path.dirname(tokenFilePath), {
      recursive: true,
      mode: 0o700,
    });
    await fs.writeFile(tokenFilePath, encrypted, { mode: 0o600 });

    const reader = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: secretLoaderA(),
    });

    await expect(reader.listServers()).rejects.toThrow('Token file corrupted');
  });

  it('refuses to downgrade an existing v:2 file when the secret fails only on write', async () => {
    const writer = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: secretLoaderA(),
    });
    await writer.setCredentials(makeCredentials('downgrade'));

    const beforeContent = await fs.readFile(tokenFilePath, 'utf-8');
    const beforeEnvelope = JSON.parse(beforeContent) as { v: number };
    expect(beforeEnvelope.v).toBe(2);

    // The loader serves the secret for the read (decrypt) but returns null for
    // the write (encrypt). The saveTokens anti-downgrade probe must refuse to
    // overwrite the v:2 file with a weaker v:1 envelope.
    let calls = 0;
    const flakyLoader = async (): Promise<Buffer | null> => {
      calls += 1;
      return calls === 1 ? MACHINE_SECRET_A : null;
    };
    const flakyWriter = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: flakyLoader,
    });

    await expect(
      flakyWriter.setCredentials(makeCredentials('downgrade')),
    ).rejects.toThrow(/Refusing to overwrite an existing v:2 envelope/);
    expect(calls).toBeGreaterThanOrEqual(1);

    // The existing v:2 file must be byte-identical and still version 2.
    const afterContent = await fs.readFile(tokenFilePath, 'utf-8');
    expect(afterContent).toBe(beforeContent);
    const afterEnvelope = JSON.parse(afterContent) as { v: number };
    expect(afterEnvelope.v).toBe(2);
  });

  it('getCredentials returns null when no token file exists (ENOENT)', async () => {
    const storage = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: secretLoaderA(),
    });
    const result = await storage.getCredentials('absent');
    expect(result).toBeNull();
  });

  it('normalizes a malformed non-envelope file to "Token file corrupted"', async () => {
    // Any content that is not a supported versioned envelope (legacy hex-colon,
    // garbage, or malformed JSON) is rejected as "Token file corrupted".
    // ReadEnvelopeVersion returns null for all of these, so the envelope-only
    // read path fails closed uniformly without routing non-envelope bytes into the
    // codec.
    const iv = crypto.randomBytes(16).toString('hex');
    const authTag = crypto.randomBytes(16).toString('hex');
    const ciphertext = crypto.randomBytes(32).toString('hex');
    const malformedLegacy = `${iv}:${authTag}:${ciphertext}`;
    await fs.mkdir(path.dirname(tokenFilePath), {
      recursive: true,
      mode: 0o700,
    });
    await fs.writeFile(tokenFilePath, malformedLegacy, { mode: 0o600 });

    const reader = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: secretLoaderA(),
    });

    await expect(reader.getCredentials('anything')).rejects.toThrow(
      'Token file corrupted',
    );
  });

  it.skipIf(process.platform === 'win32')(
    'tightens permissions to 0o600 when overwriting a pre-existing loose-mode file',
    async () => {
      const storage = new FileTokenStorage(SERVICE_NAME, {
        tokenFilePath,
        machineSecretLoader: secretLoaderA(),
      });

      // First write creates a real v:2 envelope file.
      await storage.setCredentials(makeCredentials('perm-server'));

      // Simulate the file being left with group/world-readable permissions
      // (e.g. by an older write path). writeFile's `mode` only applies on
      // creation, so the subsequent overwrite must explicitly chmod.
      await fs.chmod(tokenFilePath, 0o644);

      // Second write overwrites the existing file; permissions must be
      // tightened back to owner-only.
      await storage.setCredentials(makeCredentials('perm-server-2'));

      const stat = await fs.stat(tokenFilePath);
      expect(stat.mode & 0o777).toBe(0o600);
    },
  );

  it('preserves CRUD API behavior (set/get/delete/list/clear) with v:2 envelopes', async () => {
    const storage = new FileTokenStorage(SERVICE_NAME, {
      tokenFilePath,
      machineSecretLoader: secretLoaderA(),
    });

    const c1 = makeCredentials('s1');
    const c2 = makeCredentials('s2');
    await storage.setCredentials(c1);
    await storage.setCredentials(c2);

    // Assert exactly these two servers (in any order) — arrayContaining would
    // pass even if stale entries leaked in, masking a cleanup bug.
    const servers = await storage.listServers();
    expect(servers).toHaveLength(2);
    expect([...servers].sort()).toStrictEqual(['s1', 's2']);
    const r1 = await storage.getCredentials('s1');
    expect(r1).not.toBeNull();
    expect(r1!.serverName).toBe('s1');

    await storage.deleteCredentials('s1');
    expect(await storage.getCredentials('s1')).toBeNull();
    expect(await storage.listServers()).toStrictEqual(['s2']);

    await storage.clearAll();
    expect(await storage.listServers()).toStrictEqual([]);
  });
});
