/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Factory functions for creating credential stores that automatically detect
 * whether we're running inside a sandbox (proxy mode) or on the host (direct mode).
 *
 * **This module is the single entry point for obtaining TokenStore and
 * ProviderKeyStorage instances.** Direct instantiation of `KeyringTokenStore`
 * or calls to `getProviderKeyStorage()` from consumer code are prohibited.
 * Use `createTokenStore()` and `createProviderKeyStorage()` instead.
 *
 * @plan PLAN-20250214-CREDPROXY.P32
 * @plan PLAN-20250214-CREDPROXY.P36
 * @requirement R2.3, R2.4, R9.5
 */

// @plan:PLAN-20260608-ISSUE1586.P15 — auth types from auth package
import type {
  TokenStore,
  KeyringTokenStore,
} from '@vybestack/llxprt-code-auth';
import { ProxySocketClient } from '@vybestack/llxprt-code-auth';
import { ProxyProviderKeyStorage } from '@vybestack/llxprt-code-auth/proxy/proxy-provider-key-storage.js';
import { ProxyTokenStore } from '@vybestack/llxprt-code-auth/proxy/proxy-token-store.js';
import { createKeyringTokenStore } from '@vybestack/llxprt-code-core/auth-factories.js';
import type {
  ProviderKeyStorage,
  ProviderKeyStorageLike,
} from '@vybestack/llxprt-code-storage';
import { getProviderKeyStorage } from '@vybestack/llxprt-code-storage';
import fs from 'node:fs';

let proxyTokenStore: ProxyTokenStore | undefined;
let proxyTokenStoreCapabilityToken: string | undefined;
let proxyTokenStoreSocketPath: string | undefined;
let directTokenStore: KeyringTokenStore | undefined;
let proxyKeyStorage: ProxyProviderKeyStorage | undefined;
let proxyKeyStorageClient: ProxySocketClient | undefined;
let proxyKeyStorageCapabilityToken: string | undefined;
let proxyKeyStorageSocketPath: string | undefined;
/**
 * Cached socket client for brokered GitHub operations.
 *
 * @plan PLAN-20260731-GHBROKER.P19
 * @requirement REQ-003
 */
let brokerClient: ProxySocketClient | undefined;
let brokerClientCapabilityToken: string | undefined;
let brokerClientSocketPath: string | undefined;
let directKeyStorage: ProviderKeyStorage | undefined;

/**
 * Module-private cached capability token consumed from inherited fd 3. Both
 * token-store and key-storage proxy clients share this value so the descriptor
 * is read and closed exactly once per process lifetime.
 *
 * @plan project-plans/issue-1954-sandbox-hardening.md (AC4, AC10, F6)
 */
let cachedCapabilityToken: string | undefined;

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
 * Reads, validates, and closes the inherited capability descriptor (fd 3)
 * pointed to by LLXPRT_CAPABILITY_FD. The raw token is cached in module-private
 * state; the descriptor is closed and the marker env var is deleted before
 * returning. F6: reads to EOF under a strict max, validates exactly 64 hex +
 * delimiter (no trim), always attempts close, surfaces BOTH primary and close
 * errors via AggregateError. Duplicate transport fails fast.
 *
 * @plan project-plans/issue-1954-sandbox-hardening.md (AC4, AC10, F6)
 */
function consumeFd3Capability(): string | undefined {
  const fdMarker = process.env.LLXPRT_CAPABILITY_FD;
  if (fdMarker === undefined || fdMarker === '') return cachedCapabilityToken;

  const scrubMarker = (): void => {
    delete process.env.LLXPRT_CAPABILITY_FD;
  };

  if (cachedCapabilityToken !== undefined) {
    scrubMarker();
    throw new Error(
      'Duplicate capability transport: LLXPRT_CAPABILITY_FD supplied after the descriptor was already consumed',
    );
  }

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

  cachedCapabilityToken = rawToken.slice(0, 64);
  return cachedCapabilityToken;
}

/** Resolves the capability token, consuming the descriptor on first use and returning the cache on subsequent calls. */
function resolveCapabilityToken(): string | undefined {
  if (cachedCapabilityToken !== undefined) {
    if (
      process.env.LLXPRT_CAPABILITY_FD !== undefined &&
      process.env.LLXPRT_CAPABILITY_FD !== ''
    ) {
      return consumeFd3Capability();
    }
    return cachedCapabilityToken;
  }
  return consumeFd3Capability();
}

/** Closes a resource best-effort, swallowing errors. */
function safeClose(closeFn: (() => void) | undefined): void {
  if (!closeFn) return;
  try {
    closeFn();
  } catch {
    // best-effort cleanup
  }
}

/** Tears down ALL proxy singletons and clears their state (used when switching to direct mode). */
function cleanupProxySingletons(): void {
  if (proxyTokenStore !== undefined) {
    safeClose(() => proxyTokenStore?.getClient().close());
    proxyTokenStore = undefined;
    proxyTokenStoreCapabilityToken = undefined;
    proxyTokenStoreSocketPath = undefined;
  }
  if (brokerClient !== undefined) {
    safeClose(() => brokerClient?.close());
    brokerClient = undefined;
    brokerClientCapabilityToken = undefined;
    brokerClientSocketPath = undefined;
  }
  if (proxyKeyStorage !== undefined) {
    safeClose(() => proxyKeyStorageClient?.close());
    proxyKeyStorageClient = undefined;
    proxyKeyStorage = undefined;
    proxyKeyStorageCapabilityToken = undefined;
    proxyKeyStorageSocketPath = undefined;
  }
}

/**
 * Creates or returns a singleton TokenStore appropriate for the current environment.
 * This is the ONLY sanctioned way to obtain a TokenStore instance.
 * - When LLXPRT_CREDENTIAL_SOCKET env var is set: returns ProxyTokenStore
 * - Otherwise: returns KeyringTokenStore (direct host access)
 *
 * @plan PLAN-20250214-CREDPROXY.P36
 */
export function createTokenStore(): TokenStore {
  const socketPath = process.env.LLXPRT_CREDENTIAL_SOCKET;
  if (!socketPath && process.env.LLXPRT_CAPABILITY_FD !== undefined) {
    let transportError: unknown;
    try {
      consumeFd3Capability();
    } catch (err) {
      transportError = err;
    }
    cachedCapabilityToken = undefined;
    const mismatch = new Error(
      'Capability transport requires LLXPRT_CREDENTIAL_SOCKET',
    );
    throw transportError === undefined
      ? mismatch
      : new AggregateError([mismatch, transportError], mismatch.message);
  }
  if (socketPath) {
    const capabilityToken = resolveCapabilityToken();
    if (
      proxyTokenStore === undefined ||
      proxyTokenStoreCapabilityToken !== capabilityToken ||
      proxyTokenStoreSocketPath !== socketPath
    ) {
      const oldStore = proxyTokenStore;
      const newStore = new ProxyTokenStore(socketPath, capabilityToken);
      safeClose(() => oldStore?.getClient().close());
      proxyTokenStore = newStore;
      proxyTokenStoreCapabilityToken = capabilityToken;
      proxyTokenStoreSocketPath = socketPath;
    }
    return proxyTokenStore;
  }
  cleanupProxySingletons();
  directTokenStore ??= createKeyringTokenStore();
  return directTokenStore;
}

/**
 * Creates or returns a singleton ProviderKeyStorage appropriate for the current environment.
 * This is the ONLY sanctioned way to obtain a ProviderKeyStorage instance.
 * - When LLXPRT_CREDENTIAL_SOCKET env var is set: returns ProxyProviderKeyStorage (read-only)
 * - Otherwise: returns the direct ProviderKeyStorage singleton
 *
 * @plan PLAN-20250214-CREDPROXY.P36
 */
/**
 * Returns a socket client for brokered GitHub operations when running in a
 * sandbox, or null when running on the host.
 *
 * Capability resolution stays here rather than in the caller: #2784 confines
 * the token to this module's private cache, and handing it out to build a
 * client elsewhere would widen that boundary for no benefit.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-003, REQ-015
 */
export function createGitHubBrokerSocketClient(): ProxySocketClient | null {
  const socketPath = process.env.LLXPRT_CREDENTIAL_SOCKET;
  if (!socketPath && process.env.LLXPRT_CAPABILITY_FD !== undefined) {
    createTokenStore();
  }
  if (!socketPath) return null;
  const capabilityToken = resolveCapabilityToken();
  // Cached and torn down like the other proxy clients. Returning a fresh
  // untracked client per call would leak a socket on every rebuild and
  // survive resetFactorySingletons, which tests rely on to isolate.
  if (
    brokerClient === undefined ||
    brokerClientCapabilityToken !== capabilityToken ||
    brokerClientSocketPath !== socketPath
  ) {
    const oldClient = brokerClient;
    brokerClient = new ProxySocketClient(socketPath, capabilityToken);
    safeClose(() => oldClient?.close());
    brokerClientCapabilityToken = capabilityToken;
    brokerClientSocketPath = socketPath;
  }
  return brokerClient;
}

export function createProviderKeyStorage(): ProviderKeyStorageLike {
  const socketPath = process.env.LLXPRT_CREDENTIAL_SOCKET;
  if (!socketPath && process.env.LLXPRT_CAPABILITY_FD !== undefined) {
    createTokenStore();
  }
  if (socketPath) {
    const capabilityToken = resolveCapabilityToken();
    if (
      proxyKeyStorage === undefined ||
      proxyKeyStorageCapabilityToken !== capabilityToken ||
      proxyKeyStorageSocketPath !== socketPath
    ) {
      const oldClient = proxyKeyStorageClient;
      const newClient = new ProxySocketClient(socketPath, capabilityToken);
      const newStorage = new ProxyProviderKeyStorage(newClient);
      safeClose(() => oldClient?.close());
      proxyKeyStorageClient = newClient;
      proxyKeyStorage = newStorage;
      proxyKeyStorageCapabilityToken = capabilityToken;
      proxyKeyStorageSocketPath = socketPath;
    }
    return proxyKeyStorage;
  }
  cleanupProxySingletons();
  directKeyStorage ??= getProviderKeyStorage();
  return directKeyStorage;
}

/** Resets factory singletons. Used for test isolation. */
export function resetFactorySingletons(): void {
  const oldProxyTokenStore = proxyTokenStore;
  const oldProxyKeyStorageClient = proxyKeyStorageClient;
  proxyTokenStore = undefined;
  proxyTokenStoreCapabilityToken = undefined;
  proxyTokenStoreSocketPath = undefined;
  directTokenStore = undefined;
  proxyKeyStorage = undefined;
  proxyKeyStorageClient = undefined;
  proxyKeyStorageCapabilityToken = undefined;
  proxyKeyStorageSocketPath = undefined;
  directKeyStorage = undefined;
  cachedCapabilityToken = undefined;
  safeClose(() => oldProxyTokenStore?.getClient().close());
  safeClose(() => oldProxyKeyStorageClient?.close());
}
