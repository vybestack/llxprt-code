import type { OAuthFetch } from '@vybestack/llxprt-code-auth/types.js';
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
import { type OAuthToken, type TokenStore } from '@vybestack/llxprt-code-auth';
import { AnthropicDeviceFlow } from '@vybestack/llxprt-code-auth';
import { CodexDeviceFlow } from '@vybestack/llxprt-code-auth/flows/codex-device-flow.js';
import { ProviderKeyStorage } from '@vybestack/llxprt-code-storage';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  CredentialProxyServer,
  type OAuthFlowInterface,
} from './credential-proxy-server.js';
import { RefreshCoordinator } from './refresh-coordinator.js';
import { createGitHubBrokerHandler } from './github-broker.js';

export interface SandboxProxyConfig {
  tokenStore: TokenStore;
  socketPath: string;
  idleTimeoutMs?: number;
  /**
   * Fired on every handshake that presents a valid capability token —
   * proof the token reached the process inside the container. Lets the
   * caller release the capability env file that delivered it; the
   * callback must be idempotent (issue #3524). The callback runs on the
   * proxy connection's frame-processing path: a throw does not reach
   * this caller but surfaces as a connection error that destroys that
   * socket, so the callback must not throw — consumers handle their
   * own failures.
   */
  onSandboxHandshake?: () => void;
}

export interface SandboxProxyHandle {
  readonly socketPath: string;
  readonly capabilityToken: string;
  stop(): Promise<void>;
}

/**
 * Adapter that wraps CodexDeviceFlow to match OAuthFlowInterface.
 * Codex uses buildAuthorizationUrl() for browser redirect flow, but the proxy
 * interface expects initiateDeviceFlow(). This adapter bridges that gap.
 *
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P08
 */
class CodexFlowAdapter implements OAuthFlowInterface {
  private flow: CodexDeviceFlow;

  constructor(requestFetch: OAuthFetch) {
    this.flow = new CodexDeviceFlow(requestFetch);
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
function createSandboxOAuthFlows(
  requestFetch: OAuthFetch,
): Map<string, () => OAuthFlowInterface> {
  return new Map([
    [
      'anthropic',
      () => new AnthropicDeviceFlow(requestFetch) as OAuthFlowInterface,
    ],
    ['codex', () => new CodexFlowAdapter(requestFetch)],
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
  requestFetch: OAuthFetch,
): Promise<SandboxProxyHandle> {
  const { tokenStore } = config;
  const providerKeyStorage = new ProviderKeyStorage();

  // Build flow factories for OAuth initiation
  const flowFactories = createSandboxOAuthFlows(requestFetch);

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

  const capabilityToken = crypto.randomBytes(32).toString('hex');
  const server = new CredentialProxyServer({
    tokenStore,
    providerKeyStorage,
    socketDir: requestedSocketDir,
    flowFactories,
    refreshCoordinator,
    capabilityToken,
    onSandboxHandshake: config.onSandboxHandshake,
    extraHandlers: { github: createGitHubBrokerHandler().handler },
  });
  let socketPath: string;
  try {
    socketPath = await server.start();
  } catch (error) {
    try {
      await server.stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Credential proxy startup and cleanup failed',
      );
    }
    throw error;
  }
  let stopping: Promise<void> | undefined;
  return {
    socketPath,
    capabilityToken,
    stop: () => (stopping ??= server.stop()),
  };
}
