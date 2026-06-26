/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { BaseTokenStorage } from './base-token-storage.js';
import type { MCPOAuthCredentials } from '../token-store.js';
import {
  decryptEnvelopeString,
  encryptEnvelopeString,
  readEnvelopeVersion,
  EnvelopeCodecError,
  type EnvelopeCodecOptions,
} from '@vybestack/llxprt-code-storage/storage/envelope-codec.js';

/**
 * Options for {@link FileTokenStorage}.
 */
export interface FileTokenStorageOptions {
  /**
   * Overrides the on-disk token file path. Defaults to
   * `~/.llxprt/mcp-oauth-tokens-v2.json`. Exposed for deterministic tests.
   */
  tokenFilePath?: string;
  /**
   * Injectable machine-secret loader backing the v:2 envelope codec. Defaults
   * to the production machine-secret resolution (keyring → file → generate).
   * Returning `null` means "no machine secret available" (v:1 only).
   */
  machineSecretLoader?: () => Promise<Buffer | null>;
  /**
   * Optional path for the default machine-secret loader. Ignored when
   * `machineSecretLoader` is provided.
   */
  machineSecretPath?: string;
}

export class FileTokenStorage extends BaseTokenStorage {
  private readonly tokenFilePath: string;
  /**
   * Cached legacy KDF key. Lazily derived only when a legacy
   * `iv:authTag:ciphertext` token file is actually read, so the common paths
   * (writing, or reading versioned envelopes) never pay for the scrypt cost.
   */
  private legacyEncryptionKey: Buffer | null = null;
  private readonly codecOptions: EnvelopeCodecOptions;

  constructor(serviceName: string, options?: FileTokenStorageOptions) {
    super(serviceName);
    const configDir = path.join(os.homedir(), '.llxprt');
    this.tokenFilePath =
      options?.tokenFilePath ??
      path.join(configDir, 'mcp-oauth-tokens-v2.json');
    this.codecOptions = {
      machineSecretLoader: options?.machineSecretLoader,
      machineSecretPath: options?.machineSecretPath,
    };
  }

  /**
   * Lazily derives and caches the legacy KDF key used only to read pre-existing
   * `iv:authTag:ciphertext` token files. New writes use the versioned envelope
   * codec, so this is never computed unless a legacy file is encountered.
   */
  private getLegacyEncryptionKey(): Buffer {
    if (this.legacyEncryptionKey === null) {
      const salt = `${os.hostname()}-${os.userInfo().username}-llxprt-cli`;
      this.legacyEncryptionKey = crypto.scryptSync(
        'llxprt-cli-oauth',
        salt,
        32,
      );
    }
    return this.legacyEncryptionKey;
  }

  /**
   * Legacy AES-256-GCM decrypt for the `iv:authTag:ciphertext` (hex) format.
   * Used only to read pre-existing token files that predate the versioned
   * envelope codec. New writes go through the codec.
   */
  private decrypt(encryptedData: string): string {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.getLegacyEncryptionKey(),
      iv,
    );
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  private async ensureDirectoryExists(): Promise<void> {
    const dir = path.dirname(this.tokenFilePath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  }

  private async loadTokens(): Promise<Map<string, MCPOAuthCredentials>> {
    let data: string;
    try {
      data = await fs.readFile(this.tokenFilePath, 'utf-8');
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        // No token file exists yet - return empty collection
        return new Map();
      }
      throw error;
    }

    // Route versioned envelopes through the codec. readEnvelopeVersion returns
    // a version number for valid envelopes and null otherwise (including for
    // legacy hex-colon content).
    let plaintext: string;
    if (readEnvelopeVersion(data) !== null) {
      try {
        plaintext = await decryptEnvelopeString(
          data,
          this.serviceName,
          this.codecOptions,
        );
      } catch (error) {
        if (error instanceof EnvelopeCodecError) {
          // v:2 missing/different secret, tampering, or malformed envelope —
          // fail closed consistently with prior "Token file corrupted" behavior.
          throw new Error('Token file corrupted');
        }
        throw error;
      }
    } else {
      try {
        plaintext = this.decrypt(data);
      } catch {
        // Any failure decrypting a legacy hex-colon token file (malformed
        // format, bad IV/authTag, authentication failure, tampering) is
        // normalized to a single fail-closed error so raw crypto details do
        // not leak and the caller observes consistent behavior with the
        // versioned-envelope path above.
        throw new Error('Token file corrupted');
      }
    }

    try {
      const tokens = JSON.parse(plaintext) as Record<
        string,
        MCPOAuthCredentials
      >;
      return new Map(Object.entries(tokens));
    } catch {
      throw new Error('Token file corrupted');
    }
  }

  private async saveTokens(
    tokens: Map<string, MCPOAuthCredentials>,
  ): Promise<void> {
    await this.ensureDirectoryExists();

    // Detect an existing envelope version for anti-downgrade protection.
    // Non-envelope (legacy) files and missing files yield null. This is a
    // defense-in-depth read: the codec's own anti-downgrade guard
    // (existingEnvelopeVersion) is the authoritative refusal point, but reading
    // the current version here lets us pass it through so a v:2 file is never
    // silently overwritten with a weaker v:1 envelope when the machine secret
    // is unavailable. The read/write pair is inherently TOCTOU (a concurrent
    // writer could change the file in between), so the guard is best-effort
    // hardening rather than a lock; the single-writer assumption holds for the
    // CLI's normal usage.
    let existingVersion: number | null = null;
    try {
      const existing = await fs.readFile(this.tokenFilePath, 'utf-8');
      existingVersion = readEnvelopeVersion(existing);
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        throw error;
      }
    }

    const data = Object.fromEntries(tokens);
    const json = JSON.stringify(data, null, 2);
    const encrypted = await encryptEnvelopeString(json, this.serviceName, {
      ...this.codecOptions,
      existingEnvelopeVersion: existingVersion,
    });

    await fs.writeFile(this.tokenFilePath, encrypted, { mode: 0o600 });
    // writeFile's `mode` only applies on creation; overwriting a pre-existing
    // file leaves its (possibly looser) permissions intact. Tighten explicitly
    // on POSIX so the token file is never left group/world-readable.
    if (process.platform !== 'win32') {
      try {
        await fs.chmod(this.tokenFilePath, 0o600);
      } catch (chmodError) {
        // The token file was written but its permissions could not be
        // restricted. Remove it so OAuth credentials are never left on disk
        // with overly permissive modes, and surface an error distinct from a
        // write failure.
        await fs.unlink(this.tokenFilePath).catch(() => {
          // Best-effort cleanup; the file may remain with loose permissions.
        });
        const detail =
          chmodError instanceof Error ? chmodError.message : String(chmodError);
        throw new Error(
          `Token file was written but permissions could not be restricted to 0o600; the file was removed to avoid leaving over-permissive credentials on disk: ${detail}`,
        );
      }
    }
  }

  async getCredentials(
    serverName: string,
  ): Promise<MCPOAuthCredentials | null> {
    const tokens = await this.loadTokens();
    const credentials = tokens.get(serverName);

    if (!credentials) {
      return null;
    }

    return credentials;
  }

  async setCredentials(credentials: MCPOAuthCredentials): Promise<void> {
    this.validateCredentials(credentials);

    const tokens = await this.loadTokens();
    const updatedCredentials: MCPOAuthCredentials = {
      ...credentials,
      updatedAt: Date.now(),
    };

    tokens.set(credentials.serverName, updatedCredentials);
    await this.saveTokens(tokens);
  }

  async deleteCredentials(serverName: string): Promise<void> {
    const tokens = await this.loadTokens();

    if (!tokens.has(serverName)) {
      throw new Error(`No credentials found for ${serverName}`);
    }

    tokens.delete(serverName);

    if (tokens.size === 0) {
      try {
        await fs.unlink(this.tokenFilePath);
      } catch (error: unknown) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== 'ENOENT') {
          throw error;
        }
      }
    } else {
      await this.saveTokens(tokens);
    }
  }

  async listServers(): Promise<string[]> {
    const tokens = await this.loadTokens();
    return Array.from(tokens.keys());
  }

  async getAllCredentials(): Promise<Map<string, MCPOAuthCredentials>> {
    const tokens = await this.loadTokens();
    const result = new Map<string, MCPOAuthCredentials>();

    for (const [serverName, credentials] of tokens) {
      result.set(serverName, credentials);
    }

    return result;
  }

  async clearAll(): Promise<void> {
    try {
      await fs.unlink(this.tokenFilePath);
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
