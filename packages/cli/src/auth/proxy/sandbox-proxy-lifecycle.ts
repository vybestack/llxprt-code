/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lifecycle management for the credential proxy server during sandbox sessions.
 * Manages server creation, startup, and cleanup.
 *
 * NOTE: This is HOST-SIDE code that creates and manages the proxy server.
 * It intentionally uses direct KeyringTokenStore and getProviderKeyStorage
 * instantiation because it IS the host-side credential source, not a consumer.
 * The factory functions are for consumer sites that need to detect proxy mode.
 *
 * @plan:PLAN-20250214-CREDPROXY.P32
 * @plan:PLAN-20250214-CREDPROXY.P35 - Verified as host-side (direct instantiation correct)
 * @requirement R25.1, R25.3, R25.4
 */

import {
  getProviderKeyStorage,
  KeyringTokenStore,
} from '@vybestack/llxprt-code-core';
import { CredentialProxyServer } from './credential-proxy-server.js';

export interface SandboxProxyConfig {
  socketPath: string;
  idleTimeoutMs?: number;
  allowedProviders?: string[];
  allowedBuckets?: string[];
}

export interface SandboxProxyHandle {
  stop(): Promise<void>;
}

let serverInstance: CredentialProxyServer | undefined;
let actualSocketPath: string | undefined;

/**
 * Creates and starts the credential proxy server for sandbox communication.
 *
 * This should be called by the host process before spawning the sandbox container.
 * The returned handle's socketPath should be passed to the sandbox via
 * LLXPRT_CREDENTIAL_SOCKET environment variable.
 */
export async function createAndStartProxy(
  config: SandboxProxyConfig,
): Promise<SandboxProxyHandle> {
  if (serverInstance) {
    return {
      stop: async () => {
        await stopProxy();
      },
    };
  }

  const tokenStore = new KeyringTokenStore();
  const providerKeyStorage = getProviderKeyStorage();

  serverInstance = new CredentialProxyServer({
    tokenStore,
    providerKeyStorage,
    socketDir: config.socketPath.includes('/') ? undefined : undefined,
    allowedProviders: config.allowedProviders,
    allowedBuckets: config.allowedBuckets,
  });

  actualSocketPath = await serverInstance.start();

  process.env.LLXPRT_CREDENTIAL_SOCKET = actualSocketPath;

  return {
    stop: async () => {
      await stopProxy();
    },
  };
}

/**
 * Stops the credential proxy server and cleans up resources.
 */
export async function stopProxy(): Promise<void> {
  if (!serverInstance) {
    return;
  }

  await serverInstance.stop();
  serverInstance = undefined;

  if (actualSocketPath) {
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    actualSocketPath = undefined;
  }
}

/**
 * Returns the active socket path, if a proxy is running.
 */
export function getProxySocketPath(): string | undefined {
  return actualSocketPath;
}
