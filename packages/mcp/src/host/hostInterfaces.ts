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
import type { MCPServerConfig, McpExtensionConfig } from '../config/index.js';

export interface McpTrustConfig {
  isTrustedFolder(): boolean;
}

export interface McpApprovalTarget {
  readonly serverName: string;
  readonly toolName: string;
}

export type McpApproval = 'tool-session' | 'server-session' | 'tool-saved';

export interface McpApprovalPolicy {
  evaluate(
    target: McpApprovalTarget,
    args: Record<string, unknown>,
  ): 'allow' | 'ask_user' | 'deny';
  approve(target: McpApprovalTarget, approval: McpApproval): Promise<void>;
}

export interface McpWorkspaceContext {
  getDirectories(): readonly string[];
  onDirectoriesChanged(listener: () => void): () => void;
}

export type DiscoveredMCPPrompt = Prompt & {
  serverName: string;
  invoke: (
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<GetPromptResult>;
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
  getAllowedMcpServers(): string[] | undefined;
  getBlockedMcpServers():
    | Array<{ name: string; extensionName: string }>
    | undefined;
  getMcpServers(): Record<string, MCPServerConfig> | undefined;
  getMcpServerCommand(): string | undefined;
  getWorkspaceDirectories(): readonly string[];
  onWorkspaceDirectoriesChanged(listener: () => void): () => void;
  getDebugMode(): boolean;
  getExtensions(): McpExtensionConfig[];
}
