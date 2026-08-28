/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Resource } from '@modelcontextprotocol/sdk/types.js';
import type {
  MCPServerConfig,
  McpExtensionConfig,
} from '../../config/mcpServerConfig.js';
import type {
  DiscoveredMCPPrompt,
  McpHostConfig,
  McpWorkspaceContext,
} from '../../host/hostInterfaces.js';

export type Config = McpHostConfig;
export type LlxprtExtension = McpExtensionConfig;
export type { MCPServerConfig };

export class WorkspaceContext implements McpWorkspaceContext {
  private directories: readonly string[];
  private readonly listeners = new Set<() => void>();

  constructor(directory: string, additionalDirectories: string[] = []) {
    this.directories = [directory, ...additionalDirectories];
  }

  getDirectories(): readonly string[] {
    return this.directories;
  }

  setDirectories(directories: readonly string[]): void {
    this.directories = [...directories];
    for (const listener of this.listeners) {
      listener();
    }
  }

  onDirectoriesChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export class PromptRegistry {
  private readonly prompts = new Map<string, DiscoveredMCPPrompt>();

  registerPrompt(prompt: DiscoveredMCPPrompt): void {
    this.prompts.set(prompt.name, prompt);
  }

  getAllPrompts(): DiscoveredMCPPrompt[] {
    return [...this.prompts.values()];
  }

  getPrompt(name: string): DiscoveredMCPPrompt | undefined {
    return this.prompts.get(name);
  }

  removePromptsByServer(serverName: string): void {
    for (const [name, prompt] of this.prompts) {
      if (prompt.serverName === serverName) {
        this.prompts.delete(name);
      }
    }
  }
}

interface TestResource extends Resource {
  readonly serverName: string;
}

export class ResourceRegistry {
  private readonly resources = new Map<string, TestResource>();

  setResourcesForServer(serverName: string, resources: Resource[]): void {
    this.removeResourcesByServer(serverName);
    for (const resource of resources) {
      if (resource.uri) {
        this.resources.set(`${serverName}::${resource.uri}`, {
          ...resource,
          serverName,
        });
      }
    }
  }

  getAllResources(): TestResource[] {
    return [...this.resources.values()];
  }

  removeResourcesByServer(serverName: string): void {
    for (const key of this.resources.keys()) {
      if (key.startsWith(`${serverName}::`)) {
        this.resources.delete(key);
      }
    }
  }
}
