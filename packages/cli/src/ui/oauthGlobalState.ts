/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

interface OAuthGlobalState {
  __oauth_auth_complete?: boolean;
  __oauth_browser_auth_complete?: boolean;
  __oauth_needs_code?: boolean;
  __oauth_provider?: string;
}

export function getOAuthGlobalState(): OAuthGlobalState {
  return global as OAuthGlobalState;
}

export function getPendingOAuthProvider(): string | undefined {
  return getOAuthGlobalState().__oauth_provider;
}
