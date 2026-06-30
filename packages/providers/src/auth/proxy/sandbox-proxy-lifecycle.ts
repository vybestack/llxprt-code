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
 * It intentionally wires the direct credential source through core factories
 * because it is the host-side bridge for sandboxed consumers.
 *
 * @plan:PLAN-20250214-CREDPROXY.P32
 * @plan:PLAN-20250214-CREDPROXY.P35 - Verified as host-side (direct instantiation correct)
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P08
 * @requirement R25.1, R25.3, R25.4
 */

// @plan:PLAN-20260608-ISSUE1586.P15 — auth types from auth package
import {
  AnthropicDeviceFlow,
  CodexDeviceFlow,
  type OAuthToken,
} from '@vybestack/llxprt-code-auth';
import { createKeyringTokenStore } from '@vybestack/llxprt-code-core';
import { getProviderKeyStorage } from '@vybestack/llxprt-code-storage';
import path from 'node:path';
import {
  CredentialProxyServer,
  type OAuthFlowInterface,
} from './credential-proxy-server.js';
import { RefreshCoordinator } from './refresh-coordinator.js';

export interface SandboxProxyConfig {
  socketPath: string;
  idleTimeoutMs?: number;
}

export interface SandboxProxyHandle {
  stop(): Promise<void>;
}

let serverInstance: CredentialProxyServer | undefined;
let actualSocketPath: string | undefined;

/**
 * Adapter that wraps CodexDeviceFlow to match OAuthFlowInterface.
 * Codex uses buildAuthorizationUrl() for browser redirect flow, but the proxy
 * interface expects initiateDeviceFlow(). This adapter bridges that gap.
 *
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P08
 */
class CodexFlowAdapter implements OAuthFlowInterface {
  private flow: CodexDeviceFlow;

  constructor() {
    this.flow = new CodexDeviceFlow();
  }

  /**
   * Initiates OAuth flow for Codex using device code flow.
   * Codex supports two flows - browser redirect and device code.
   * For sandbox proxy, we use the device code flow as it doesn't require
   * a localhost callback server.
   */
  async initiateDeviceFlow(_redirectUri?: string): Promise<{
    device_code: string;
    user_code?: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval?: number;
  }> {
    // Use Codex device code flow
    const result = await this.flow.requestDeviceCode();

    // Store device_auth_id for later polling
    return {
      device_code: result.device_auth_id,
      user_code: result.user_code,
      verification_uri: 'https://auth.openai.com/deviceauth/callback',
      verification_uri_complete: `https://auth.openai.com/deviceauth/callback?user_code=${result.user_code}`,
      expires_in: 900, // 15 minutes for Codex device auth
      interval: result.interval,
    };
  }

  /**
   * Polls for token using device authorization.
   * This uses Codex's pollForDeviceToken followed by completeDeviceAuth.
   */
  async pollForToken(deviceCode: string): Promise<OAuthToken> {
    // deviceCode is actually device_auth_id from initiateDeviceFlow
    // We need to poll and then exchange
    const codeResult = await this.flow.pollForDeviceToken(
      deviceCode,
      '', // user_code - Codex API uses device_auth_id primarily
      5, // interval
    );

    // Complete the device auth flow
    const token = await this.flow.completeDeviceAuth(
      codeResult.authorization_code,
      codeResult.code_verifier,
      'https://auth.openai.com/deviceauth/callback',
    );

    return token;
  }

  /**
   * Refreshes token using the wrapped flow.
   */
  async refreshToken(refreshToken: string): Promise<OAuthToken> {
    return this.flow.refreshToken(refreshToken);
  }
}

/**
 * Builds default flow factories for known OAuth providers.
 * Each factory creates a fresh flow instance per OAuth session.
 *
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P08
 */
function buildDefaultFlowFactories(): Map<string, () => OAuthFlowInterface> {
  return new Map([
    ['anthropic', () => new AnthropicDeviceFlow() as OAuthFlowInterface],
    ['codex', () => new CodexFlowAdapter()],
  ]);
}

/**
 * Creates and starts the credential proxy server for sandbox communication.
 *
 * This should be called by the host process before spawning the sandbox container.
 * The returned handle's socketPath should be passed to the sandbox via
 * LLXPRT_CREDENTIAL_SOCKET environment variable.
 *
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P08 - Wires real OAuth providers
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

  const tokenStore = createKeyringTokenStore();
  const providerKeyStorage = getProviderKeyStorage();

  // Build flow factories for OAuth initiation
  const flowFactories = buildDefaultFlowFactories();

  // Create RefreshCoordinator for rate-limited, deduplicated refresh
  const refreshCoordinator = new RefreshCoordinator({
    tokenStore,
    refreshFn: async (provider, currentToken) => {
      const flowFactory = flowFactories.get(provider);
      if (!flowFactory) {
        throw new Error(`No OAuth provider configured for: ${provider}`);
      }
      const flowInstance = flowFactory();
      if (!flowInstance.refreshToken) {
        throw new Error(`Provider ${provider} does not support token refresh`);
      }
      if (!currentToken.refresh_token) {
        throw new Error(`Token for ${provider} does not have a refresh_token`);
      }
      return flowInstance.refreshToken(currentToken.refresh_token);
    },
    cooldownMs: 30 * 1000, // 30 second cooldown per provider:bucket
  });

  const requestedSocketDir =
    path.extname(config.socketPath) === '.sock'
      ? path.dirname(config.socketPath)
      : config.socketPath;

  serverInstance = new CredentialProxyServer({
    tokenStore,
    providerKeyStorage,
    socketDir: requestedSocketDir,
    flowFactories,
    refreshCoordinator,
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
