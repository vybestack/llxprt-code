/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared string-oriented envelope codec for sibling encrypted file stores.
 *
 * This module reuses the SecureStore versioned envelope primitives
 * (scrypt KDF + AES-256-GCM, on-disk layout [salt][iv12][authTag16][ciphertext])
 * so that sibling stores — `ToolKeyStorage`, `FileTokenStorage`, and other
 * file-based credential stores — can share the machine-secret-backed root of
 * trust instead of re-implementing weak per-file key derivation from
 * hard-coded constants.
 *
 * The codec is intentionally a thin wrapper over `envelope.ts` primitives; it
 * introduces no new crypto parameters. It centralizes:
 *
 *   - anti-downgrade protection (refusing to overwrite an existing v:2
 *     envelope with a weaker v:1 envelope when the machine secret is
 *     unavailable),
 *   - fail-closed decrypt (malformed, unsupported, or unauthentic envelopes
 *     throw `EnvelopeCodecError` with code `CORRUPT`),
 *   - a uniform JSON envelope shape so callers can detect a valid envelope
 *     vs. a legacy format and route accordingly.
 *
 * @plan PLAN-20260211-SECURESTORE.P06 (sibling hardening follow-up)
 */

import * as crypto from 'node:crypto';
import {
  deriveV1KdfInput,
  deriveV2KdfInput,
  isValidEnvelope,
  scryptAsync,
  SCRYPT_PARAMS,
  SALT_LEN,
  type Envelope,
} from './envelope.js';
import { getMachineSecret } from './machine-secret.js';

export type { Envelope } from './envelope.js';

// ─── Layout constants ────────────────────────────────────────────────────────
//
// On-disk envelope ciphertext layout: [salt][iv][authTag][encrypted].
// These are derived from the shared SALT_LEN so the layout is self-documenting
// and the header length is computed rather than hard-coded.

/** GCM nonce length (bytes). */
const IV_LEN = 12;
/** GCM authentication tag length (bytes). */
const AUTH_TAG_LEN = 16;
/** Total header length = salt + iv + authTag (bytes). */
const HEADER_LEN = SALT_LEN + IV_LEN + AUTH_TAG_LEN;

/**
 * Mirrors `SecureStoreErrorCode` for the subset of failure modes the codec
 * can surface. Kept as its own union so this module does not need to import
 * the full SecureStore class (which would create a cycle in callers that
 * only want the codec).
 */
export type EnvelopeCodecErrorCode = 'UNAVAILABLE' | 'CORRUPT';

/**
 * Error thrown by the envelope codec. Carries a stable `code` so callers
 * can branch on failure mode (e.g. surface "Token file corrupted").
 */
export class EnvelopeCodecError extends Error {
  readonly code: EnvelopeCodecErrorCode;
  readonly remediation: string;

  constructor(
    message: string,
    code: EnvelopeCodecErrorCode,
    remediation: string,
  ) {
    super(message);
    this.name = 'EnvelopeCodecError';
    this.code = code;
    this.remediation = remediation;
  }
}

/**
 * Options shared by {@link encryptEnvelopeString} and
 * {@link decryptEnvelopeString}.
 */
export interface EnvelopeCodecOptions {
  /**
   * Injectable machine-secret loader. Defaults to the production
   * `getMachineSecret()` resolution (keyring → file → generate). Returning
   * `null` means "no machine secret available" (v:1 only).
   */
  machineSecretLoader?: () => Promise<Buffer | null>;
  /**
   * Path passed to the default machine-secret loader when no explicit loader
   * is injected. Ignored when `machineSecretLoader` is provided.
   */
  machineSecretPath?: string;
}

/**
 * Additional options for {@link encryptEnvelopeString}.
 */
export interface EncryptEnvelopeStringOptions extends EnvelopeCodecOptions {
  /**
   * The envelope version of an existing file being overwritten, or `null`
   * when the target does not exist / is not a recognized envelope. When the
   * machine secret is unavailable and the existing version is `2`, the codec
   * refuses to write a weaker v:1 envelope (anti-downgrade) and throws
   * `EnvelopeCodecError` with code `UNAVAILABLE`. Callers should obtain this
   * value via {@link readEnvelopeVersion} before encrypting.
   */
  existingEnvelopeVersion?: number | null;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function defaultMachineSecretLoader(
  filePath?: string,
): () => Promise<Buffer | null> {
  return async () => getMachineSecret({ filePath });
}

function resolveLoader(
  options?: EnvelopeCodecOptions,
): () => Promise<Buffer | null> {
  return (
    options?.machineSecretLoader ??
    defaultMachineSecretLoader(options?.machineSecretPath)
  );
}

/**
 * Encrypts `plaintext` into a JSON envelope string under the given
 * `serviceName`.
 *
 * Version selection mirrors SecureStore: v:2 when a machine secret is
 * available, v:1 otherwise — except that an existing v:2 envelope is never
 * silently downgraded to v:1 (see {@link EncryptEnvelopeStringOptions}).
 *
 * The returned string is `JSON.stringify(envelope)`; callers write it to disk
 * with mode 0o600.
 */
export async function encryptEnvelopeString(
  plaintext: string,
  serviceName: string,
  options?: EncryptEnvelopeStringOptions,
): Promise<string> {
  const loader = resolveLoader(options);
  const machineSecret = await loader();
  const useV2 = machineSecret !== null;

  if (!useV2 && options?.existingEnvelopeVersion === 2) {
    throw new EnvelopeCodecError(
      'Refusing to overwrite an existing v:2 envelope with a weaker v:1 envelope while the machine secret is unavailable',
      'UNAVAILABLE',
      'Restore the machine secret and re-save the value, or remove the existing file if intentional.',
    );
  }

  const salt = crypto.randomBytes(SALT_LEN);
  const kdfInput = useV2
    ? deriveV2KdfInput(serviceName, machineSecret)
    : deriveV1KdfInput(serviceName);
  const encKey = await scryptAsync(kdfInput, salt, 32, SCRYPT_PARAMS);

  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const ciphertext = Buffer.concat([salt, iv, authTag, encrypted]);
  const envelope: Envelope = {
    v: useV2 ? 2 : 1,
    crypto: {
      alg: 'aes-256-gcm',
      kdf: 'scrypt',
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      saltLen: SALT_LEN,
    },
    data: ciphertext.toString('base64'),
  };

  return JSON.stringify(envelope);
}

/**
 * Decrypts a JSON envelope string previously produced by
 * {@link encryptEnvelopeString} (or by SecureStore's fallback writer).
 *
 * Fail-closed behavior:
 *   - Non-JSON or non-envelope content → `CORRUPT`.
 *   - Unsupported/tampered version or crypto parameters → `CORRUPT`.
 *   - v:2 envelope with no machine secret → `CORRUPT`.
 *   - Authentication failure (wrong secret, tampered ciphertext) → `CORRUPT`.
 *
 * Returns the decrypted plaintext string.
 */
export async function decryptEnvelopeString(
  envelopeJson: string,
  serviceName: string,
  options?: EnvelopeCodecOptions,
): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelopeJson);
  } catch {
    throw new EnvelopeCodecError(
      'Envelope is not valid JSON',
      'CORRUPT',
      'Re-save the value or re-authenticate.',
    );
  }

  if (!isValidEnvelope(parsed)) {
    throw new EnvelopeCodecError(
      'Envelope is malformed or uses unsupported parameters',
      'CORRUPT',
      'Re-save the value or re-authenticate.',
    );
  }

  const envelope = parsed;
  const ciphertext = Buffer.from(envelope.data, 'base64');
  if (ciphertext.length < HEADER_LEN) {
    throw new EnvelopeCodecError(
      'Envelope payload is too short to contain a valid header',
      'CORRUPT',
      'Re-save the value or re-authenticate. The file may be truncated or corrupted.',
    );
  }
  const salt = ciphertext.subarray(0, SALT_LEN);
  const iv = ciphertext.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const authTag = ciphertext.subarray(SALT_LEN + IV_LEN, HEADER_LEN);
  const encryptedData = ciphertext.subarray(HEADER_LEN);

  let kdfInput: string;
  if (envelope.v === 2) {
    const loader = resolveLoader(options);
    const machineSecret = await loader();
    if (machineSecret === null) {
      throw new EnvelopeCodecError(
        'v:2 envelope requires a machine secret that is unavailable',
        'CORRUPT',
        'Re-save the value or re-authenticate. The machine secret may have changed or been removed.',
      );
    }
    kdfInput = deriveV2KdfInput(serviceName, machineSecret);
  } else {
    kdfInput = deriveV1KdfInput(serviceName);
  }

  const decKey = await scryptAsync(kdfInput, salt, 32, SCRYPT_PARAMS);

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', decKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(encryptedData),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    throw new EnvelopeCodecError(
      'Failed to decrypt envelope (authentication failure)',
      'CORRUPT',
      'Re-save the value or re-authenticate. The file may have been created on a different machine or with a different machine secret.',
    );
  }
}

/**
 * Inspects file content (or any string) and returns the envelope version
 * (1 or 2) if it parses as a valid envelope, or `null` otherwise.
 *
 * Callers use this before {@link encryptEnvelopeString} to detect an existing
 * v:2 file that must not be downgraded, and before decryption to route
 * legacy (non-envelope) formats to a legacy reader.
 */
export function readEnvelopeVersion(content: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isValidEnvelope(parsed)) {
    return null;
  }
  return parsed.v;
}
