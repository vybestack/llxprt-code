/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Encryption envelope primitives for the SecureStore file fallback.
 *
 * Centralizes the on-disk envelope shape, versioning, scrypt KDF parameters,
 * and the per-version KDF input derivation so that SecureStore can remain
 * focused on the keyring/file lifecycle. The envelope versions are:
 *
 *   - v:1: KDF input = serviceName + '-' + sha256(hostname + username)
 *   - v:2: KDF input = machineSecretHex + '|' + serviceName + '|' +
 *           sha256(hostname + username)
 *
 * AES-256-GCM and scrypt parameters are identical for both versions.
 *
 * @plan PLAN-20260211-SECURESTORE.P06
 */

import * as crypto from 'node:crypto';
import * as os from 'node:os';

/** Envelope versions that this implementation can read. */
export const ENVELOPE_VERSIONS = new Set<number>([1, 2]);

/** scrypt cost parameters. Shared by v:1 and v:2 envelopes. */
export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export interface Envelope {
  v: number;
  crypto: {
    alg: string;
    kdf: string;
    N: number;
    r: number;
    p: number;
    saltLen: number;
  };
  data: string;
}

/**
 * Promisified node:crypto.scrypt. Returns a Buffer of length `keyLen`.
 */
export function scryptAsync(
  password: string,
  salt: Buffer,
  keyLen: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keyLen, options, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/**
 * Resolves the OS username in a way that never throws, falling back to the
 * numeric uid (or 'unknown') when userInfo() fails.
 */
function safeUsername(): string {
  try {
    return os.userInfo().username;
  } catch {
    return String(process.getuid?.() ?? 'unknown');
  }
}

/**
 * Stable per-machine identifier: sha256(hostname + username). Used as a
 * component in both v:1 and v:2 KDF inputs.
 */
function machineId(): string {
  return crypto
    .createHash('sha256')
    .update(os.hostname() + safeUsername())
    .digest('hex');
}

/**
 * v:1 KDF input. Remains exactly `serviceName + '-' + machineId()` for
 * backwards compatibility with existing fallback files.
 */
export function deriveV1KdfInput(serviceName: string): string {
  return serviceName + '-' + machineId();
}

/**
 * v:2 KDF input. The machine secret hex is the dominant entropy source so
 * that confidentiality does not depend solely on filesystem permissions.
 */
export function deriveV2KdfInput(
  serviceName: string,
  machineSecret: Buffer,
): string {
  return machineSecret.toString('hex') + '|' + serviceName + '|' + machineId();
}

/** Expected salt length (bytes) for the fallback envelope. */
export const SALT_LEN = 16;

/**
 * Type guard: the envelope has a recognized version and the crypto fields
 * reference AES-256-GCM over scrypt with the expected parameters. Does not
 * validate the data payload.
 */
export function isValidEnvelope(envelope: unknown): envelope is Envelope {
  if (typeof envelope !== 'object' || envelope === null) return false;
  const env = envelope as Record<string, unknown>;
  if (typeof env.v !== 'number' || !ENVELOPE_VERSIONS.has(env.v)) {
    return false;
  }
  if (typeof env.crypto !== 'object' || env.crypto === null) return false;
  const c = env.crypto as Record<string, unknown>;
  if (c.alg !== 'aes-256-gcm') return false;

  if (c.kdf !== 'scrypt') return false;
  // Validate scrypt parameters against the expected values so that a
  // downgraded or tampered envelope is rejected on read rather than being
  // silently decrypted with weaker/incorrect parameters.
  if (c.N !== SCRYPT_PARAMS.N) return false;
  if (c.r !== SCRYPT_PARAMS.r) return false;
  if (c.p !== SCRYPT_PARAMS.p) return false;
  if (c.saltLen !== SALT_LEN) return false;
  if (typeof env.data !== 'string') return false;
  return true;
}
