/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MCPOAuthProvider,
  type McpOAuthBinding,
  type TokenStorage,
} from '@vybestack/llxprt-code-mcp';
import { EventEmitter } from 'node:events';
import type { McpControlDeps } from './control/mcpControl.js';

export function assembleRuntimeOAuth(oauth: McpOAuthBinding): {
  binding: McpOAuthBinding;
  readCredentials: TokenStorage['getCredentials'];
} {
  const binding = {
    getAuthProviderFactory: oauth.getAuthProviderFactory,
    tokenStorage: oauth.tokenStorage,
    openBrowser: oauth.openBrowser,
  };
  return {
    binding,
    readCredentials: binding.tokenStorage.getCredentials.bind(
      binding.tokenStorage,
    ),
  };
}

export function assembleMcpOAuthOperation(
  oauth: () => McpOAuthBinding,
  assertOpen: () => void,
): NonNullable<McpControlDeps['performOAuth']> {
  return async (server, config, url, signal, onDisplayMessage) => {
    assertOpen();
    const events = new EventEmitter();
    if (onDisplayMessage) events.on('oauth-display-message', onDisplayMessage);
    await MCPOAuthProvider.authenticate(
      oauth(),
      server,
      config,
      url,
      events,
      signal,
    );
  };
}
