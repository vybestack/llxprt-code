/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  GetPromptResult,
  Prompt,
  Resource,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  MCPServerConfig,
  McpExtensionConfig,
} from '../config/mcpServerConfig.js';

export interface McpTrustConfig {
  isTrustedFolder(): boolean;
}

export interface McpWorkspaceContext {
  getDirectories(): readonly string[];
  onDirectoriesChanged(listener: () => void): () => void;
}

export type DiscoveredMCPPrompt = Prompt & {
  serverName: string;
  invoke: (params: Record<string, unknown>) => Promise<GetPromptResult>;
};

export interface McpPromptRegistry {
  registerPrompt(prompt: DiscoveredMCPPrompt): void;
  removePromptsByServer(serverName: string): void;
}

export interface McpResourceRegistry {
  setResourcesForServer(serverName: string, resources: Resource[]): void;
  removeResourcesByServer(serverName: string): void;
}

export interface McpHostConfig extends McpTrustConfig {
  refreshMcpContext(): Promise<void>;
  getAllowedMcpServers(): string[] | undefined;
  getBlockedMcpServers():
    | Array<{ name: string; extensionName: string }>
    | undefined;
  getMcpServers(): Record<string, MCPServerConfig> | undefined;
  getMcpServerCommand(): string | undefined;
  getPromptRegistry(): McpPromptRegistry;
  getResourceRegistry(): McpResourceRegistry;
  getWorkspaceContext(): McpWorkspaceContext;
  getDebugMode(): boolean;
  getExtensions(): McpExtensionConfig[];
}
