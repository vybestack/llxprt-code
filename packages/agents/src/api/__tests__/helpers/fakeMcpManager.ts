/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P22
 * @requirement:REQ-013
 *
 * Focused infra fake for the MCP control surface (NOT the Agent under test).
 * Lives under __tests__/helpers/ so deep imports of core/mcp types are
 * permitted here while staying excluded from the T17 boundary scan.
 *
 * Builds a fully-controllable `McpControlDeps` backed by an in-memory manager
 * view. The manager view drives the SAME public methods the production
 * McpClientManager exposes (getMcpServers / getDiscoveryFailures /
 * getDiscoveryState / restartServer / restart) plus the global core server
 * status channel (updateMCPServerStatus). McpControl reads these exactly as it
 * does in production — no production code reads anything from this fake.
 */

import {
  MCPServerStatus,
  MCPDiscoveryState,
  updateMCPServerStatus,
} from '@vybestack/llxprt-code-core';
import type { McpClientManager } from '@vybestack/llxprt-code-core';
import type { MCPServerConfig } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  McpControlDeps,
  McpToolRegistryView,
} from '../../control/mcpControl.js';

export { MCPServerStatus, MCPDiscoveryState };

/** A tool entry the fake registry view exposes to McpControl. */
export interface FakeRegistryTool {
  readonly name: string;
  readonly description?: string;
  readonly serverName?: string;
  readonly enabled?: boolean;
}

/** Controllable in-memory state for a fake MCP manager view. */
export interface FakeMcpManagerView {
  setServers(servers: Record<string, MCPServerConfig>): void;
  setDiscoveryState(state: MCPDiscoveryState): void;
  setFailure(server: string, message: string): void;
  clearFailures(): void;
  /** Number of restart() calls observed (for sequencing assertions). */
  restartAllCount(): number;
  /** Servers passed to restartServer(name), in call order. */
  restartedServers(): readonly string[];
}

interface FakeManagerInternal extends FakeMcpManagerView {
  getMcpServers(): Record<string, MCPServerConfig>;
  getDiscoveryFailures(): ReadonlyMap<string, string>;
  getDiscoveryState(): MCPDiscoveryState;
  restart(): Promise<void>;
  restartServer(name: string): Promise<void>;
}

class FakeManager implements FakeManagerInternal {
  private servers: Record<string, MCPServerConfig> = {};
  private state: MCPDiscoveryState = MCPDiscoveryState.NOT_STARTED;
  private readonly failures = new Map<string, string>();
  private restartAll = 0;
  private readonly restartedNames: string[] = [];

  setServers(servers: Record<string, MCPServerConfig>): void {
    this.servers = { ...servers };
  }

  setDiscoveryState(state: MCPDiscoveryState): void {
    this.state = state;
  }

  setFailure(server: string, message: string): void {
    this.failures.set(server, message);
  }

  clearFailures(): void {
    this.failures.clear();
  }

  restartAllCount(): number {
    return this.restartAll;
  }

  restartedServers(): readonly string[] {
    return [...this.restartedNames];
  }

  getMcpServers(): Record<string, MCPServerConfig> {
    return { ...this.servers };
  }

  getDiscoveryFailures(): ReadonlyMap<string, string> {
    return new Map(this.failures);
  }

  getDiscoveryState(): MCPDiscoveryState {
    return this.state;
  }

  async restart(): Promise<void> {
    this.restartAll += 1;
  }

  async restartServer(name: string): Promise<void> {
    this.restartedNames.push(name);
  }
}

class FakeToolRegistry implements McpToolRegistryView {
  constructor(private readonly tools: readonly FakeRegistryTool[]) {}

  getAllTools(): ReadonlyArray<{
    readonly name: string;
    readonly description?: string;
    readonly serverName?: string;
  }> {
    return this.tools.map((t) => ({
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      ...(t.serverName !== undefined ? { serverName: t.serverName } : {}),
    }));
  }

  getEnabledTools(): ReadonlyArray<{ readonly name: string }> {
    return this.tools
      .filter((t) => t.enabled !== false)
      .map((t) => ({ name: t.name }));
  }
}

export interface FakeMcpDepsResult {
  readonly deps: McpControlDeps;
  readonly manager: FakeMcpManagerView;
}

export interface FakeMcpDepsOptions {
  readonly servers?: Record<string, MCPServerConfig>;
  readonly tools?: readonly FakeRegistryTool[];
  readonly authenticatedServers?: readonly string[];
  /** When false, getManager() returns undefined (pre-initialize path). */
  readonly hasManager?: boolean;
  /** When false, getToolRegistry() returns undefined (pre-initialize path). */
  readonly hasRegistry?: boolean;
}

/**
 * Builds an McpControlDeps + a handle to mutate the underlying fake manager.
 * The McpClientManager type is structurally satisfied by FakeManager for the
 * methods McpControl actually invokes; the single cast is isolated here in the
 * infra helper (never in a consumer spec).
 */
export function createFakeMcpDeps(
  opts: FakeMcpDepsOptions = {},
): FakeMcpDepsResult {
  const manager = new FakeManager();
  if (opts.servers !== undefined) {
    manager.setServers(opts.servers);
  }
  const registry = new FakeToolRegistry(opts.tools ?? []);
  const authed = new Set(opts.authenticatedServers ?? []);
  const hasManager = opts.hasManager ?? true;
  const hasRegistry = opts.hasRegistry ?? true;

  const deps: McpControlDeps = {
    isMcpAuthenticated: (server: string): boolean => authed.has(server),
    getManager: (): McpClientManager | undefined =>
      hasManager ? (manager as unknown as McpClientManager) : undefined,
    getToolRegistry: (): McpToolRegistryView | undefined =>
      hasRegistry ? registry : undefined,
  };

  return { deps, manager };
}

/** Convenience: a minimal stdio MCPServerConfig for fake servers. */
export function fakeServerConfig(
  overrides: Partial<MCPServerConfig> = {},
): MCPServerConfig {
  return {
    command: 'fake-mcp-binary',
    args: [],
    env: {},
    cwd: process.cwd(),
    ...overrides,
  } as MCPServerConfig;
}

/** Sets the global core server-status channel McpControl reads via getMCPServerStatus. */
export function setServerStatus(name: string, status: MCPServerStatus): void {
  updateMCPServerStatus(name, status);
}
