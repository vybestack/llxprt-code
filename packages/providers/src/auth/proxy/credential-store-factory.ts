/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Host-captured credential authority creates independently owned transports.
 * Consumers receive stores from their composition root.
 *
 * @plan PLAN-20250214-CREDPROXY.P32
 * @plan PLAN-20250214-CREDPROXY.P36
 * @requirement R2.3, R2.4, R9.5
 */

// @plan:PLAN-20260608-ISSUE1586.P15 — auth types from auth package
import type { TokenStore } from '@vybestack/llxprt-code-auth';
import { ProxySocketClient } from '@vybestack/llxprt-code-auth';
import { ProxyProviderKeyStorage } from '@vybestack/llxprt-code-auth/proxy/proxy-provider-key-storage.js';
import { ProxyTokenStore } from '@vybestack/llxprt-code-auth/proxy/proxy-token-store.js';
import { createKeyringTokenStore } from '@vybestack/llxprt-code-core/auth-factories.js';
import type { ProviderKeyStorageLike } from '@vybestack/llxprt-code-storage';
import { ProviderKeyStorage } from '@vybestack/llxprt-code-storage';
import fs from 'node:fs';

/** F6: exactly 64 lowercase hex chars + the transport's defined delimiter (single trailing newline). */
const CAPABILITY_TOKEN_PATTERN = /^[0-9a-f]{64}\n$/;

/**
 * Reads fd 3 to EOF under a strict max (128 bytes), returning the raw buffer
 * and any read error. The strict max is enforced by a 1-byte overflow probe:
 * once totalRead reaches the limit, `readProbeAndAppend` reads exactly one
 * additional byte. If that probe returns a byte (non-EOF), the descriptor held
 * more than the allowed maximum and the token is rejected as oversized.
 */
function readFd3ToStrictMax(fdNumber: number): {
  rawBuf: Buffer;
  readErr: unknown;
} {
  const STRICT_MAX_BYTES = 128;
  const chunks: Buffer[] = [];
  let readErr: unknown;
  try {
    let totalRead = 0;
    let keepReading = true;
    while (keepReading) {
      const result = readOneChunk(
        fdNumber,
        chunks,
        totalRead,
        STRICT_MAX_BYTES,
      );
      totalRead = result.totalRead;
      keepReading = !result.eof && !result.hitMax;
    }
  } catch (err) {
    readErr = err;
  }
  return { rawBuf: Buffer.concat(chunks), readErr };
}

/** Reads one 64-byte chunk; appends to chunks and returns the new total/eof/hitMax state. */
function readOneChunk(
  fdNumber: number,
  chunks: Buffer[],
  totalRead: number,
  strictMaxBytes: number,
): { totalRead: number; eof: boolean; hitMax: boolean } {
  const chunk = Buffer.alloc(64);
  const bytesRead = fs.readSync(fdNumber, chunk, 0, chunk.length, null);
  if (bytesRead === 0) return { totalRead, eof: true, hitMax: false };
  const newTotal = totalRead + bytesRead;
  chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
  if (newTotal >= strictMaxBytes) {
    readProbeAndAppend(fdNumber, chunks);
    return { totalRead: newTotal, eof: false, hitMax: true };
  }
  return { totalRead: newTotal, eof: false, hitMax: false };
}

/** Probes one extra byte past the strict max and appends it if present. */
function readProbeAndAppend(fdNumber: number, chunks: Buffer[]): void {
  const probe = Buffer.alloc(1);
  const extra = fs.readSync(fdNumber, probe, 0, 1, null);
  if (extra > 0) chunks.push(Buffer.from(probe.subarray(0, extra)));
}

/** Combines a primary error with a close error via AggregateError when both occur. */
function buildConsumeError(
  primary: Error,
  closeErr: unknown,
  combinedMessage: string,
): Error {
  return closeErr !== undefined
    ? new AggregateError([primary, closeErr], combinedMessage)
    : primary;
}

/**
 * Reads, validates, and closes the inherited capability descriptor (fd 3).
 * The host supplies its captured marker and receives the validated token.
 * F6: reads to EOF under a strict max, validates exactly 64 hex + delimiter
 * (no trim), always attempts close, and surfaces both primary and close
 * errors via AggregateError.
 *
 * @plan project-plans/issue-1954-sandbox-hardening.md (AC4, AC10, F6)
 */
function consumeInheritedCapability(
  environment: NodeJS.ProcessEnv,
  fdMarker: string,
): string {
  const scrubMarker = (): void => {
    delete environment.LLXPRT_CAPABILITY_FD;
  };

  const fdNumber = Number(fdMarker);
  if (
    !Number.isInteger(fdNumber) ||
    fdNumber < 0 ||
    String(fdNumber) !== fdMarker
  ) {
    scrubMarker();
    throw new Error(
      `Capability transport marker LLXPRT_CAPABILITY_FD is not a valid file descriptor: ${fdMarker}`,
    );
  }

  // O18: Reject every marker except exactly "3" to prevent reading/closing
  // unintended descriptors (stdin=0, stdout=1, stderr=2, or arbitrary fds).
  if (fdMarker !== '3') {
    scrubMarker();
    throw new Error(
      `Capability transport marker LLXPRT_CAPABILITY_FD must be exactly "3", got: ${fdMarker}`,
    );
  }

  const { rawBuf, readErr } = readFd3ToStrictMax(fdNumber);
  const rawToken = rawBuf.toString('utf8');
  const isValid = CAPABILITY_TOKEN_PATTERN.test(rawToken);

  let closeErr: unknown;
  try {
    fs.closeSync(fdNumber);
  } catch (err) {
    closeErr = err;
  }

  scrubMarker();

  if (readErr !== undefined) {
    throw buildConsumeError(
      new Error(
        `Capability descriptor (fd ${fdNumber}) could not be read: ${readErr instanceof Error ? readErr.message : String(readErr)}`,
      ),
      closeErr,
      `Capability descriptor (fd ${fdNumber}) failed both read and close`,
    );
  }

  if (!isValid) {
    throw buildConsumeError(
      new Error(
        'Capability descriptor does not contain a valid 64-character lowercase hex token with the transport delimiter',
      ),
      closeErr,
      'Capability descriptor failed both validation and close',
    );
  }

  if (closeErr !== undefined) {
    throw new Error(
      `Capability descriptor (fd ${fdNumber}) could not be closed: ${closeErr instanceof Error ? closeErr.message : String(closeErr)}`,
    );
  }

  return rawToken.slice(0, 64);
}

export class CredentialAuthority {
  readonly #socketPath: string | undefined;
  readonly #capabilityToken: string | undefined;

  constructor(socketPath?: string, capabilityToken?: string) {
    if (
      capabilityToken !== undefined &&
      !/^[0-9a-f]{64}$/.test(capabilityToken)
    ) {
      throw new Error('Invalid credential capability token');
    }
    if (capabilityToken !== undefined && !socketPath) {
      throw new Error('Capability transport requires LLXPRT_CREDENTIAL_SOCKET');
    }
    this.#socketPath = socketPath;
    this.#capabilityToken = capabilityToken;
    Object.freeze(this);
  }

  createProviderKeyStorage(): ProviderKeyStorageLike & { close(): void } {
    if (!this.#socketPath) {
      const storage = new ProviderKeyStorage();
      return Object.assign(storage, { close(): void {} });
    }
    const client = new ProxySocketClient(
      this.#socketPath,
      this.#capabilityToken,
    );
    return Object.assign(new ProxyProviderKeyStorage(client), {
      close: (): void => client.close(),
    });
  }

  createGitHubBrokerSocketClient(): ProxySocketClient | null {
    return this.#socketPath
      ? new ProxySocketClient(this.#socketPath, this.#capabilityToken)
      : null;
  }

  createTokenStore(): TokenStore {
    return this.#socketPath
      ? new ProxyTokenStore(this.#socketPath, this.#capabilityToken)
      : createKeyringTokenStore();
  }
}

export class HostCredentialOwner {
  readonly authority: CredentialAuthority;

  constructor(environment: NodeJS.ProcessEnv) {
    const socketPath = environment.LLXPRT_CREDENTIAL_SOCKET;
    const fdMarker = environment.LLXPRT_CAPABILITY_FD;
    let capabilityToken: string | undefined;
    if (fdMarker !== undefined && fdMarker !== '') {
      if (!socketPath) {
        let transportError: unknown;
        try {
          consumeInheritedCapability(environment, fdMarker);
        } catch (error) {
          transportError = error;
        }
        const mismatch = new Error(
          'Capability transport requires LLXPRT_CREDENTIAL_SOCKET',
        );
        throw transportError === undefined
          ? mismatch
          : new AggregateError([mismatch, transportError], mismatch.message);
      }
      capabilityToken = consumeInheritedCapability(environment, fdMarker);
    }
    this.authority = new CredentialAuthority(socketPath, capabilityToken);
    Object.freeze(this);
  }
}

export function closeOwnedTokenStore(store: TokenStore | undefined): void {
  if (store instanceof ProxyTokenStore) store.getClient().close();
}

export function createProviderKeyStorage(
  authority: CredentialAuthority,
): ProviderKeyStorageLike {
  return authority.createProviderKeyStorage();
}

export function createGitHubBrokerSocketClient(
  authority: CredentialAuthority,
): ProxySocketClient | null {
  return authority.createGitHubBrokerSocketClient();
}
