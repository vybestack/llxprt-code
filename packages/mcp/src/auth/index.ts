/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Auth barrel exports
export { MCPOAuthProvider } from './oauth-provider.js';
export type {
  MCPOAuthConfig,
  OAuthAuthorizationResponse,
  OAuthClientRegistrationRequest,
  OAuthClientRegistrationResponse,
} from './oauth-provider.js';
export { MCPOAuthTokenStorage } from './oauth-token-storage.js';
export type {
  MCPOAuthToken,
  MCPOAuthCredentials,
} from './oauth-token-storage.js';
export { getMcpServerOAuthStatus } from './oauth-status.js';
export type { McpOAuthStatus } from './oauth-status.js';
export { BaseTokenStore } from './token-store.js';
export type {
  MCPOAuthToken as MCPOAuthTokenInterface,
  MCPOAuthCredentials as MCPOAuthCredentialsInterface,
} from './token-store.js';

export {
  OAuthUtils,
  ResourceMismatchError,
  FIVE_MIN_BUFFER_MS,
} from './oauth-utils.js';
export type {
  OAuthAuthorizationServerMetadata,
  OAuthProtectedResourceMetadata,
} from './oauth-utils.js';
export type { McpAuthProvider } from './auth-provider.js';
export { AuthProviderType } from './auth-types.js';
export type {
  McpAuthProviderFactory,
  McpAuthFactoryContribution,
  McpAuthFactoryRegistry,
} from './mcp-auth-factory.js';
export {
  buildMcpAuthFactoryRegistry,
  registerMcpAuthFactories,
  getRegisteredMcpAuthFactoryRegistry,
} from './mcp-auth-factory.js';
