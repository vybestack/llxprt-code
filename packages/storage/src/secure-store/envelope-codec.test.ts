/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the shared envelope codec.
 *
 * The codec reuses the SecureStore versioned envelope primitives
 * (scrypt + AES-256-GCM, [salt][iv12][authTag16][ciphertext] layout) so that
 * sibling encrypted file stores (ToolKeyStorage, FileTokenStorage) can share
 * the same machine-secret-backed root of trust without re-implementing the
 * weak per-file derivation.
 */

import { describe, it, expect } from 'vitest';
import * as crypto from 'node:crypto';
import {
  encryptEnvelopeString,
  decryptEnvelopeString,
  readEnvelopeVersion,
  EnvelopeCodecError,
} from './envelope-codec.js';
import { isValidEnvelope } from './envelope.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

const FIXED_SECRET_A = crypto.randomBytes(32);
const FIXED_SECRET_B = crypto.randomBytes(32);

function secretLoader(secret: Buffer): () => Promise<Buffer | null> {
  return async () => secret;
}

function nullSecretLoader(): () => Promise<Buffer | null> {
  return async () => null;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('envelope-codec — encryptEnvelopeString', () => {
  it('produces a valid v:2 JSON envelope when a machine secret is available', async () => {
    const envelopeJson = await encryptEnvelopeString(
      'plaintext-secret',
      'test-service',
      { machineSecretLoader: secretLoader(FIXED_SECRET_A) },
    );

    const parsed = JSON.parse(envelopeJson) as unknown;
    expect(isValidEnvelope(parsed)).toBe(true);
    expect((parsed as { v: number }).v).toBe(2);
    expect(envelopeJson).not.toContain('plaintext-secret');
  });

  it('produces a valid v:1 JSON envelope when no machine secret is available', async () => {
    const envelopeJson = await encryptEnvelopeString(
      'plaintext-secret',
      'test-service',
      { machineSecretLoader: nullSecretLoader() },
    );

    const parsed = JSON.parse(envelopeJson) as unknown;
    expect(isValidEnvelope(parsed)).toBe(true);
    expect((parsed as { v: number }).v).toBe(1);
    expect(envelopeJson).not.toContain('plaintext-secret');
  });

  it('produces different ciphertext for the same plaintext (random salt/iv)', async () => {
    const a = await encryptEnvelopeString('same', 'svc', {
      machineSecretLoader: secretLoader(FIXED_SECRET_A),
    });
    const b = await encryptEnvelopeString('same', 'svc', {
      machineSecretLoader: secretLoader(FIXED_SECRET_A),
    });
    expect(a).not.toBe(b);
  });

  it('includes the expected AES-256-GCM + scrypt crypto metadata', async () => {
    const envelopeJson = await encryptEnvelopeString('x', 'svc', {
      machineSecretLoader: secretLoader(FIXED_SECRET_A),
    });
    const parsed = JSON.parse(envelopeJson) as {
      crypto: { alg: string; kdf: string; N: number; r: number; p: number };
    };
    expect(parsed.crypto.alg).toBe('aes-256-gcm');
    expect(parsed.crypto.kdf).toBe('scrypt');
    expect(parsed.crypto.N).toBe(16384);
    expect(parsed.crypto.r).toBe(8);
    expect(parsed.crypto.p).toBe(1);
  });
});

describe('envelope-codec — decryptEnvelopeString', () => {
  it('round-trips v:2 with the same machine secret', async () => {
    const envelopeJson = await encryptEnvelopeString(
      'round-trip-value',
      'test-service',
      { machineSecretLoader: secretLoader(FIXED_SECRET_A) },
    );

    const plaintext = await decryptEnvelopeString(
      envelopeJson,
      'test-service',
      {
        machineSecretLoader: secretLoader(FIXED_SECRET_A),
      },
    );
    expect(plaintext).toBe('round-trip-value');
  });

  it('round-trips v:1 without a machine secret', async () => {
    const envelopeJson = await encryptEnvelopeString(
      'v1-value',
      'test-service',
      { machineSecretLoader: nullSecretLoader() },
    );

    const plaintext = await decryptEnvelopeString(
      envelopeJson,
      'test-service',
      {
        machineSecretLoader: nullSecretLoader(),
      },
    );
    expect(plaintext).toBe('v1-value');
  });

  it('v:1 can be read even when a machine secret is now available', async () => {
    // Written without a secret (v:1).
    const envelopeJson = await encryptEnvelopeString(
      'legacy-value',
      'test-service',
      { machineSecretLoader: nullSecretLoader() },
    );

    // Now a secret is available — v:1 must still decrypt.
    const plaintext = await decryptEnvelopeString(
      envelopeJson,
      'test-service',
      {
        machineSecretLoader: secretLoader(FIXED_SECRET_A),
      },
    );
    expect(plaintext).toBe('legacy-value');
  });

  it('v:2 with a different machine secret fails closed (CORRUPT)', async () => {
    const envelopeJson = await encryptEnvelopeString(
      'secret-A',
      'test-service',
      { machineSecretLoader: secretLoader(FIXED_SECRET_A) },
    );

    await expect(
      decryptEnvelopeString(envelopeJson, 'test-service', {
        machineSecretLoader: secretLoader(FIXED_SECRET_B),
      }),
    ).rejects.toMatchObject({ code: 'CORRUPT' });
  });

  it('v:2 with no machine secret fails closed (CORRUPT)', async () => {
    const envelopeJson = await encryptEnvelopeString(
      'secret-A',
      'test-service',
      { machineSecretLoader: secretLoader(FIXED_SECRET_A) },
    );

    await expect(
      decryptEnvelopeString(envelopeJson, 'test-service', {
        machineSecretLoader: nullSecretLoader(),
      }),
    ).rejects.toMatchObject({ code: 'CORRUPT' });
  });

  it('malformed JSON fails closed (CORRUPT)', async () => {
    await expect(
      decryptEnvelopeString('not-json-at-all', 'test-service', {
        machineSecretLoader: secretLoader(FIXED_SECRET_A),
      }),
    ).rejects.toMatchObject({ code: 'CORRUPT' });
  });

  it('unsupported envelope version fails closed (CORRUPT)', async () => {
    const bogus = JSON.stringify({
      v: 99,
      crypto: {
        alg: 'aes-256-gcm',
        kdf: 'scrypt',
        N: 16384,
        r: 8,
        p: 1,
        saltLen: 16,
      },
      data: 'aaaa',
    });
    await expect(
      decryptEnvelopeString(bogus, 'test-service', {
        machineSecretLoader: secretLoader(FIXED_SECRET_A),
      }),
    ).rejects.toMatchObject({ code: 'CORRUPT' });
  });

  it('tampered crypto parameters fail closed (CORRUPT)', async () => {
    const envelopeJson = await encryptEnvelopeString('value', 'svc', {
      machineSecretLoader: secretLoader(FIXED_SECRET_A),
    });
    const parsed = JSON.parse(envelopeJson) as { crypto: { N: number } };
    parsed.crypto.N = 2; // weaken scrypt
    await expect(
      decryptEnvelopeString(JSON.stringify(parsed), 'svc', {
        machineSecretLoader: secretLoader(FIXED_SECRET_A),
      }),
    ).rejects.toMatchObject({ code: 'CORRUPT' });
  });

  it('tampered ciphertext (auth failure) fails closed (CORRUPT)', async () => {
    const envelopeJson = await encryptEnvelopeString('value', 'svc', {
      machineSecretLoader: secretLoader(FIXED_SECRET_A),
    });
    const parsed = JSON.parse(envelopeJson) as { data: string };
    // Flip a byte in the base64 data.
    const buf = Buffer.from(parsed.data, 'base64');
    buf[buf.length - 1] ^= 0x01;
    parsed.data = buf.toString('base64');
    await expect(
      decryptEnvelopeString(JSON.stringify(parsed), 'svc', {
        machineSecretLoader: secretLoader(FIXED_SECRET_A),
      }),
    ).rejects.toMatchObject({ code: 'CORRUPT' });
  });

  it('uses serviceName in key derivation (cross-service isolation)', async () => {
    const envelopeJson = await encryptEnvelopeString('value', 'service-a', {
      machineSecretLoader: secretLoader(FIXED_SECRET_A),
    });
    // Decrypting with a different service name must fail (auth failure).
    await expect(
      decryptEnvelopeString(envelopeJson, 'service-b', {
        machineSecretLoader: secretLoader(FIXED_SECRET_A),
      }),
    ).rejects.toMatchObject({ code: 'CORRUPT' });
  });

  it('truncated payload (fewer than header bytes) fails closed (CORRUPT)', async () => {
    const envelopeJson = await encryptEnvelopeString('value', 'svc', {
      machineSecretLoader: secretLoader(FIXED_SECRET_A),
    });
    // Build a corrupted envelope whose `data` is base64 of fewer than 44
    // bytes (the full header length), keeping the rest of the envelope
    // structure valid so isValidEnvelope still passes.
    const parsed = JSON.parse(envelopeJson) as { data: string };
    parsed.data = Buffer.alloc(10).toString('base64');

    // Assert only the documented contract (code: 'CORRUPT'). The specific
    // message ("...too short to contain a valid header") is an internal detail
    // and not part of the public API, so matching it would make this test
    // brittle to harmless rewording.
    await expect(
      decryptEnvelopeString(JSON.stringify(parsed), 'svc', {
        machineSecretLoader: secretLoader(FIXED_SECRET_A),
      }),
    ).rejects.toMatchObject({ code: 'CORRUPT' });
  });

  it('empty-string plaintext round-trips through the envelope', async () => {
    // GCM ciphertext for empty input is 0 bytes, so the envelope payload is
    // exactly HEADER_LEN — the minimum-length guard must still accept it.
    const envelopeJson = await encryptEnvelopeString('', 'svc', {
      machineSecretLoader: secretLoader(FIXED_SECRET_A),
    });

    const plaintext = await decryptEnvelopeString(envelopeJson, 'svc', {
      machineSecretLoader: secretLoader(FIXED_SECRET_A),
    });
    expect(plaintext).toBe('');
  });

  it('fails closed (CORRUPT) when the machine-secret loader rejects on a v:2 read', async () => {
    // Seal a v:2 envelope with a working secret, then attempt to decrypt it
    // with a loader that rejects (e.g. keyring/file I/O failure). The codec
    // must normalize this to a fail-closed EnvelopeCodecError(CORRUPT) rather
    // than leaking a raw, non-EnvelopeCodecError exception — callers branch on
    // `instanceof EnvelopeCodecError`, so a raw throw would bypass their
    // fail-closed handling.
    const envelopeJson = await encryptEnvelopeString('secret', 'svc', {
      machineSecretLoader: secretLoader(FIXED_SECRET_A),
    });

    const rejectingLoader = async (): Promise<Buffer | null> => {
      throw new Error('keyring unavailable');
    };

    await expect(
      decryptEnvelopeString(envelopeJson, 'svc', {
        machineSecretLoader: rejectingLoader,
      }),
    ).rejects.toMatchObject({ code: 'CORRUPT' });
    await expect(
      decryptEnvelopeString(envelopeJson, 'svc', {
        machineSecretLoader: rejectingLoader,
      }),
    ).rejects.toBeInstanceOf(EnvelopeCodecError);
  });
});

describe('envelope-codec — anti-downgrade (existingEnvelopeVersion)', () => {
  it('refuses to downgrade an existing v:2 envelope to v:1 when secret unavailable', async () => {
    // Simulate an existing v:2 file.
    const existing = await encryptEnvelopeString('orig', 'svc', {
      machineSecretLoader: secretLoader(FIXED_SECRET_A),
    });
    const version = readEnvelopeVersion(existing);
    expect(version).toBe(2);

    await expect(
      encryptEnvelopeString('new', 'svc', {
        machineSecretLoader: nullSecretLoader(),
        existingEnvelopeVersion: version,
      }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('allows overwriting a v:1 envelope with v:1 when secret unavailable', async () => {
    const envelopeJson = await encryptEnvelopeString('new', 'svc', {
      machineSecretLoader: nullSecretLoader(),
      existingEnvelopeVersion: 1,
    });
    const parsed = JSON.parse(envelopeJson) as { v: number };
    expect(parsed.v).toBe(1);
  });

  it('allows writing a new v:2 over null existing version with secret available', async () => {
    const envelopeJson = await encryptEnvelopeString('new', 'svc', {
      machineSecretLoader: secretLoader(FIXED_SECRET_A),
      existingEnvelopeVersion: null,
    });
    const parsed = JSON.parse(envelopeJson) as { v: number };
    expect(parsed.v).toBe(2);
  });
});

describe('envelope-codec — readEnvelopeVersion', () => {
  it('returns the version for a valid envelope JSON', async () => {
    const envelopeJson = await encryptEnvelopeString('x', 'svc', {
      machineSecretLoader: secretLoader(FIXED_SECRET_A),
    });
    expect(readEnvelopeVersion(envelopeJson)).toBe(2);
  });

  it('returns null for non-JSON content', () => {
    expect(readEnvelopeVersion('not-json')).toBeNull();
  });

  it('returns null for empty-string content (truncated/zero-length file)', () => {
    // JSON.parse('') throws, so an empty or truncated file must be reported as
    // "no recognizable envelope version" rather than throwing. Callers pass raw
    // file contents that can legitimately be empty.
    expect(readEnvelopeVersion('')).toBeNull();
  });

  it('returns null for JSON that is not a valid envelope', () => {
    expect(readEnvelopeVersion(JSON.stringify({ foo: 'bar' }))).toBeNull();
    expect(
      readEnvelopeVersion(JSON.stringify({ v: 5, crypto: {}, data: 'x' })),
    ).toBeNull();
  });
});

describe('envelope-codec — EnvelopeCodecError', () => {
  it('is an Error subclass with a code property', () => {
    const err = new EnvelopeCodecError('msg', 'CORRUPT', 'fix');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('CORRUPT');
    expect(err.remediation).toBe('fix');
    expect(err.message).toBe('msg');
  });
});
