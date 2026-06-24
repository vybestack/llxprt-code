/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P12
 * @requirement:REQ-013
 * @requirement:REQ-017
 *
 * In-memory fake MCP server/transport (infra fake — NOT the Agent under test).
 * Lives under __tests__/helpers/ so deep imports of core/McpClient/etc. types
 * are permitted here while staying excluded from the T17 boundary scan.
 *
 * The fake exposes a small control surface to set the tools a server "serves",
 * simulate discovery latency, and force a discovery FAILURE so specs can drive
 * the real public Agent MCP discovery path through realistic infra without
 * spinning up an actual stdio/http MCP server.
 */

import { afterEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolInfo } from '@vybestack/llxprt-code-agents';
import type { MCPServerConfig } from '@vybestack/llxprt-code-core/config/config.js';

// Clear the shipped fake-MCP seam env var after every test so the fixture path
// never leaks into a sibling spec sharing the same worker process. The seam is
// strictly opt-in: an unset LLXPRT_FAKE_MCP disables fake discovery entirely.
afterEach(() => {
  delete process.env.LLXPRT_FAKE_MCP;
});

/**
 * Shipped fake MCP discovery fixture shape (mirrors
 * packages/mcp/src/fake/fakeMcpDiscovery.ts). The registry serializes its
 * in-memory state into this shape and points `LLXPRT_FAKE_MCP` at it so the
 * REAL McpClientManager drives discovery through the shipped fake seam — no
 * production code reads anything from __tests__.
 */
interface FakeMcpFixtureServerShape {
  readonly tools?: readonly FakeMcpTool[];
  readonly latencyMs?: number;
  readonly failure?: string;
}
interface FakeMcpFixtureShape {
  readonly servers: Record<string, FakeMcpFixtureServerShape>;
}

/** A fake tool descriptor the fake server "serves" to discovery. */
export interface FakeMcpTool {
  readonly name: string;
  readonly description?: string;
  readonly enabled?: boolean;
}

/** Per-server controls for the in-memory fake MCP registry. */
export interface FakeMcpServerHandle {
  readonly name: string;
  readonly config: MCPServerConfig;
  setTools(tools: readonly FakeMcpTool[]): void;
  setDiscoveryLatencyMs(ms: number): void;
  failDiscovery(message: string): void;
  /** Snapshot of the currently-served fake tool names. */
  servedToolNames(): readonly string[];
}

/** Registry-wide controls for the fake MCP infra. */
export interface FakeMcpRegistry {
  registerServer(name: string, config: MCPServerConfig): FakeMcpServerHandle;
  getServer(name: string): FakeMcpServerHandle | undefined;
  listServerNames(): readonly string[];
  /** Aggregated ToolInfo projection across all registered servers. */
  projectedTools(): readonly ToolInfo[];
  /** True if any registered server is configured to fail discovery. */
  anyDiscoveryFailure(): boolean;
  reset(): void;
}

const SERVER_DEFAULTS = {
  latencyMs: 0,
};

class FakeMcpServerHandleImpl implements FakeMcpServerHandle {
  readonly name: string;
  readonly config: MCPServerConfig;
  private tools: FakeMcpTool[] = [];
  private latencyMs = SERVER_DEFAULTS.latencyMs;
  private failureMessage: string | null = null;
  private readonly onMutate: () => void;

  constructor(name: string, config: MCPServerConfig, onMutate: () => void) {
    this.name = name;
    this.config = config;
    this.onMutate = onMutate;
  }

  setTools(tools: readonly FakeMcpTool[]): void {
    this.tools = [...tools];
    this.onMutate();
  }

  setDiscoveryLatencyMs(ms: number): void {
    this.latencyMs = ms;
    this.onMutate();
  }

  failDiscovery(message: string): void {
    this.failureMessage = message;
    this.onMutate();
  }

  servedToolNames(): readonly string[] {
    return this.tools.map((t) => t.name);
  }

  getDiscoveryLatencyMs(): number {
    return this.latencyMs;
  }

  getFailureMessage(): string | null {
    return this.failureMessage;
  }

  snapshotTools(): FakeMcpTool[] {
    return [...this.tools];
  }
}

class FakeMcpRegistryImpl implements FakeMcpRegistry {
  private servers = new Map<string, FakeMcpServerHandleImpl>();
  private readonly fixturePath: string;

  constructor() {
    const dir = mkdtempSync(join(tmpdir(), 'llxprt-fake-mcp-'));
    this.fixturePath = join(dir, 'mcp-fixture.json');
    // Activate the shipped fake MCP discovery seam for this process. The
    // McpClientManager reads LLXPRT_FAKE_MCP at discovery time and replays the
    // fixture into the REAL tool registry + status channel.
    process.env.LLXPRT_FAKE_MCP = this.fixturePath;
    this.sync();
  }

  /** Serializes the current registry state into the shipped fixture file. */
  private sync(): void {
    const servers: Record<string, FakeMcpFixtureServerShape> = {};
    for (const [name, handle] of this.servers.entries()) {
      const failure = handle.getFailureMessage();
      servers[name] = {
        tools: handle.snapshotTools(),
        latencyMs: handle.getDiscoveryLatencyMs(),
        ...(failure !== null ? { failure } : {}),
      };
    }
    const fixture: FakeMcpFixtureShape = { servers };
    writeFileSync(this.fixturePath, JSON.stringify(fixture), 'utf8');
  }

  registerServer(name: string, config: MCPServerConfig): FakeMcpServerHandle {
    const handle = new FakeMcpServerHandleImpl(name, config, () => this.sync());
    this.servers.set(name, handle);
    this.sync();
    return handle;
  }

  getServer(name: string): FakeMcpServerHandle | undefined {
    return this.servers.get(name);
  }

  listServerNames(): readonly string[] {
    return [...this.servers.keys()];
  }

  projectedTools(): readonly ToolInfo[] {
    const out: ToolInfo[] = [];
    for (const server of this.servers.values()) {
      for (const t of server.snapshotTools()) {
        out.push({
          name: t.name,
          description: t.description,
          source: 'mcp',
          server: server.name,
          enabled: t.enabled ?? true,
        });
      }
    }
    return out;
  }

  anyDiscoveryFailure(): boolean {
    for (const server of this.servers.values()) {
      if (server.getFailureMessage() !== null) {
        return true;
      }
    }
    return false;
  }

  reset(): void {
    this.servers.clear();
    this.sync();
  }
}

/**
 * Builds a fresh, isolated fake MCP registry. Each call yields an independent
 * registry so tests do not leak server state between one another.
 */
export function createFakeMcpRegistry(): FakeMcpRegistry {
  return new FakeMcpRegistryImpl();
}

/**
 * Convenience: a minimal valid MCPServerConfig for a stdio fake. The command
 * is never actually executed — the Agent discovery path is driven by the
 * registry's projected tools, not by spawning a real process at RED.
 */
export function stdioFakeConfig(command: string): MCPServerConfig {
  return {
    command,
    args: [],
    env: {},
    cwd: process.cwd(),
    transport: 'stdio',
  } as MCPServerConfig;
}

/**
 * Convenience: builds a registry pre-populated with one server serving the
 * given tools. Used by specs that need a single-server happy-path scenario.
 */
export function fakeRegistryWithServer(
  name: string,
  tools: readonly FakeMcpTool[],
  config?: MCPServerConfig,
): {
  readonly registry: FakeMcpRegistry;
  readonly server: FakeMcpServerHandle;
} {
  const registry = createFakeMcpRegistry();
  const server = registry.registerServer(
    name,
    config ?? stdioFakeConfig('fake-mcp-binary'),
  );
  server.setTools(tools);
  return { registry, server };
}
