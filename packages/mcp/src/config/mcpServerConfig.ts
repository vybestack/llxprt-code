/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AuthProviderType } from '@vybestack/llxprt-code-auth/mcp-auth-provider-type.js';
import type { MCPOAuthConfig } from '../auth/oauth-provider.js';

/** The extension state MCP needs while reconciling configured servers. */
export interface McpExtensionConfig {
  readonly name: string;
  readonly isActive: boolean;
  readonly mcpServers?: Readonly<Record<string, MCPServerConfig>>;
}

/** Configuration accepted by an MCP server connection. */
export interface MCPServerConfig {
  readonly command?: string;
  readonly args?: string[];
  readonly env?: Record<string, string>;
  readonly cwd?: string;
  readonly url?: string;
  readonly httpUrl?: string;
  readonly headers?: Record<string, string>;
  readonly tcp?: string;
  readonly type?: 'sse' | 'http' | 'streamable-http';
  readonly timeout?: number;
  readonly trust?: boolean;
  readonly description?: string;
  readonly includeTools?: string[];
  readonly excludeTools?: string[];
  readonly extensionName?: string;
  readonly extension?: McpExtensionConfig;
  readonly oauth?: MCPOAuthConfig;
  readonly authProviderType?: AuthProviderType;
  readonly targetAudience?: string;
  readonly targetServiceAccount?: string;
}
