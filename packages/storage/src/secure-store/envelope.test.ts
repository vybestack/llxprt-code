/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the envelope module: version validation, crypto
 * parameter validation, and KDF input derivation.
 */

import { describe, it, expect } from 'vitest';
import * as crypto from 'node:crypto';
import {
  isValidEnvelope,
  deriveV1KdfInput,
  deriveV2KdfInput,
  SCRYPT_PARAMS,
  type Envelope,
} from './envelope.js';

function makeValidEnvelope(
  version: number,
  overrides?: Partial<Envelope>,
): Envelope {
  return {
    v: version,
    crypto: {
      alg: 'aes-256-gcm',
      kdf: 'scrypt',
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      saltLen: 16,
    },
    data: crypto.randomBytes(64).toString('base64'),
    ...overrides,
  };
}

describe('isValidEnvelope', () => {
  it('accepts a well-formed v:1 envelope', () => {
    expect(isValidEnvelope(makeValidEnvelope(1))).toBe(true);
  });

  it('accepts a well-formed v:2 envelope', () => {
    expect(isValidEnvelope(makeValidEnvelope(2))).toBe(true);
  });

  it('rejects unknown versions', () => {
    expect(isValidEnvelope(makeValidEnvelope(3))).toBe(false);
    expect(isValidEnvelope(makeValidEnvelope(0))).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isValidEnvelope(null)).toBe(false);
    expect(isValidEnvelope('string')).toBe(false);
    expect(isValidEnvelope(42)).toBe(false);
    expect(isValidEnvelope(undefined)).toBe(false);
  });

  it('rejects unsupported cipher', () => {
    const env = makeValidEnvelope(1, {
      crypto: {
        alg: 'aes-128-gcm',
        kdf: 'scrypt',
        N: 16384,
        r: 8,
        p: 1,
        saltLen: 16,
      },
    });
    expect(isValidEnvelope(env)).toBe(false);
  });

  it('rejects unsupported KDF', () => {
    const env = makeValidEnvelope(1, {
      crypto: {
        alg: 'aes-256-gcm',
        kdf: 'pbkdf2',
        N: 16384,
        r: 8,
        p: 1,
        saltLen: 16,
      },
    });
    expect(isValidEnvelope(env)).toBe(false);
  });

  it('rejects unexpected scrypt N parameter', () => {
    const env = makeValidEnvelope(1, {
      crypto: {
        alg: 'aes-256-gcm',
        kdf: 'scrypt',
        N: 1024,
        r: 8,
        p: 1,
        saltLen: 16,
      },
    });
    expect(isValidEnvelope(env)).toBe(false);
  });

  it('rejects unexpected scrypt r parameter', () => {
    const env = makeValidEnvelope(1, {
      crypto: {
        alg: 'aes-256-gcm',
        kdf: 'scrypt',
        N: 16384,
        r: 4,
        p: 1,
        saltLen: 16,
      },
    });
    expect(isValidEnvelope(env)).toBe(false);
  });

  it('rejects unexpected scrypt p parameter', () => {
    const env = makeValidEnvelope(1, {
      crypto: {
        alg: 'aes-256-gcm',
        kdf: 'scrypt',
        N: 16384,
        r: 8,
        p: 2,
        saltLen: 16,
      },
    });
    expect(isValidEnvelope(env)).toBe(false);
  });

  it('rejects unexpected saltLen', () => {
    const env = makeValidEnvelope(1, {
      crypto: {
        alg: 'aes-256-gcm',
        kdf: 'scrypt',
        N: 16384,
        r: 8,
        p: 1,
        saltLen: 32,
      },
    });
    expect(isValidEnvelope(env)).toBe(false);
  });

  it('rejects missing data field', () => {
    const env = makeValidEnvelope(1);
    delete (env as Partial<Envelope>).data;
    expect(isValidEnvelope(env)).toBe(false);
  });

  it('rejects non-string data', () => {
    const env = makeValidEnvelope(1);
    (env as unknown as { data: number }).data = 123;
    expect(isValidEnvelope(env)).toBe(false);
  });
});

describe('KDF input derivation', () => {
  it('v:1 derivation is deterministic for the same service name', () => {
    const a = deriveV1KdfInput('svc');
    const b = deriveV1KdfInput('svc');
    expect(a).toBe(b);
  });

  it('v:2 derivation is deterministic for same service + secret', () => {
    const secret = crypto.randomBytes(32);
    const a = deriveV2KdfInput('svc', secret);
    const b = deriveV2KdfInput('svc', secret);
    expect(a).toBe(b);
  });

  it('v:2 derivation differs for different secrets', () => {
    const secretA = crypto.randomBytes(32);
    const secretB = crypto.randomBytes(32);
    const a = deriveV2KdfInput('svc', secretA);
    const b = deriveV2KdfInput('svc', secretB);
    expect(a).not.toBe(b);
  });

  it('v:2 derivation differs for different service names', () => {
    const secret = crypto.randomBytes(32);
    const a = deriveV2KdfInput('svc-a', secret);
    const b = deriveV2KdfInput('svc-b', secret);
    expect(a).not.toBe(b);
  });
});
