/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
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
   * `<global-data-dir>/mcp-oauth-tokens-v2.json`. Exposed for deterministic tests.
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
  private readonly codecOptions: EnvelopeCodecOptions;

  constructor(serviceName: string, options?: FileTokenStorageOptions) {
    super(serviceName);
    const configDir = Storage.getGlobalDataDir();
    this.tokenFilePath =
      options?.tokenFilePath ??
      path.join(configDir, 'mcp-oauth-tokens-v2.json');
    this.codecOptions = {
      machineSecretLoader: options?.machineSecretLoader,
      machineSecretPath: options?.machineSecretPath,
    };
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

    // Content is envelope-only: a versioned envelope decrypts through the
    // codec; legacy hex-colon or malformed content fails closed.
    if (readEnvelopeVersion(data) === null) {
      throw new Error('Token file corrupted');
    }

    let plaintext: string;
    try {
      plaintext = await decryptEnvelopeString(
        data,
        this.serviceName,
        this.codecOptions,
      );
    } catch (error) {
      if (error instanceof EnvelopeCodecError) {
        // v:2 missing/different secret, tampering, or malformed envelope —
        // fail closed consistently with the non-envelope path so raw crypto
        // details do not leak and callers observe a uniform error.
        throw new Error('Token file corrupted', { cause: error });
      }
      // Rejecting machine-secret loader errors propagate unchanged.
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext);
    } catch (error) {
      // Decryptable envelope whose payload is not valid JSON — fail closed
      // so malformed content does not surface parse internals.
      throw new Error('Token file corrupted', { cause: error });
    }
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      throw new Error('Token file corrupted');
    }
    const entries: [string, MCPOAuthCredentials][] = [];
    for (const [key, value] of Object.entries(parsed)) {
      if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        typeof (value as { token?: unknown }).token !== 'object'
      ) {
        throw new Error('Token file corrupted');
      }
      entries.push([key, value as MCPOAuthCredentials]);
    }
    return new Map(entries);
  }

  private async saveTokens(
    tokens: Map<string, MCPOAuthCredentials>,
  ): Promise<void> {
    await this.ensureDirectoryExists();

    // Anti-downgrade: when overwriting an existing v:2 envelope with the
    // machine secret temporarily unavailable, refuse to write a weaker v:1
    // envelope instead of silently rotating the storage format.
    let existingEnvelopeVersion: number | null = null;
    try {
      const existing = await fs.readFile(this.tokenFilePath, 'utf-8');
      existingEnvelopeVersion = readEnvelopeVersion(existing);
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
      existingEnvelopeVersion,
    });

    await fs.writeFile(this.tokenFilePath, encrypted, { mode: 0o600 });
    // writeFile's `mode` only applies on creation; overwriting a pre-existing
    // file leaves its (possibly loose) permissions intact. Tighten explicitly
    // on POSIX so the token file is never left group/world-readable.
    if (process.platform !== 'win32') {
      try {
        await fs.chmod(this.tokenFilePath, 0o600);
      } catch (chmodError) {
        // The token file was written but its permissions could not be
        // restricted. Remove it so OAuth credentials are never left on disk
        // with overly permissive permissions.
        let unlinkFailed = false;
        try {
          await fs.unlink(this.tokenFilePath);
        } catch {
          // The over-permissive file could not be removed either; report
          // this so the caller knows credentials may still be on disk with
          // overly permissive permissions.
          unlinkFailed = true;
        }
        const detail =
          chmodError instanceof Error ? chmodError.message : String(chmodError);
        throw new Error(
          unlinkFailed
            ? `Token file was written but permissions could not be restricted to 0o600, and the over-permissive file could not be removed; OAuth credentials may remain on disk with overly permissive permissions. chmod error: ${detail}`
            : `Token file was written but permissions could not be restricted to 0o600; the file was removed to avoid leaving over-permissive credentials on disk: ${detail}`,
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
