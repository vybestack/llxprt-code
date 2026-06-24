/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P22
 * @requirement:REQ-013
 * @requirement:REQ-017
 *
 * Shipped fake MCP discovery seam — the MCP analogue of FakeProvider.
 *
 * When the environment variable `LLXPRT_FAKE_MCP` points at a JSON fixture
 * file, {@link McpClientManager} drives discovery through this module instead
 * of spawning a real stdio/http MCP server. The fixture declares, per server,
 * the tools that server "serves", an optional discovery latency, and an
 * optional discovery failure.
 *
 * This is a legitimate, shipped test double (like FakeProvider in the
 * providers package): production code never imports from any `__tests__`
 * directory. The fake replays into the REAL {@link ToolRegistry} and the REAL
 * discovery state machine — discovered tools become real registry entries
 * carrying a `serverName`, and server status flows through the real
 * `updateMCPServerStatus` channel. Callers therefore exercise genuine
 * discovery-gate, ToolRegistry, and status-mapping logic; nothing is hardcoded
 * in the Agent's public surface.
 */

import { readFileSync } from 'node:fs';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from '@vybestack/llxprt-code-tools';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import {
  MCPServerStatus,
  updateMCPServerStatus,
} from '../client/mcp-client.js';

/** A single tool the fake server "serves" to discovery. */
export interface FakeMcpFixtureTool {
  readonly name: string;
  readonly description?: string;
  readonly enabled?: boolean;
}

/** Per-server fixture entry. */
export interface FakeMcpFixtureServer {
  readonly tools?: readonly FakeMcpFixtureTool[];
  readonly latencyMs?: number;
  /** When present, discovery for this server fails with this message. */
  readonly failure?: string;
}

/** The full on-disk fake MCP fixture shape. */
export interface FakeMcpFixture {
  readonly servers: Readonly<Record<string, FakeMcpFixtureServer>>;
}

/** Outcome of applying fake discovery for a single server. */
export interface FakeMcpDiscoveryOutcome {
  readonly status: MCPServerStatus;
  readonly registeredToolNames: readonly string[];
  readonly failure?: string;
}

const FAKE_MCP_ENV = 'LLXPRT_FAKE_MCP';

/**
 * True when the fake MCP discovery seam is active (the `LLXPRT_FAKE_MCP`
 * environment variable points at a fixture file).
 */
export function isFakeMcpDiscoveryActive(): boolean {
  const value = process.env[FAKE_MCP_ENV];
  return typeof value === 'string' && value.length > 0;
}

/**
 * Loads and parses the fake MCP fixture referenced by `LLXPRT_FAKE_MCP`.
 * Returns `undefined` when the seam is inactive.
 */
export function loadFakeMcpFixture(): FakeMcpFixture | undefined {
  const path = process.env[FAKE_MCP_ENV];
  if (typeof path !== 'string' || path.length === 0) {
    return undefined;
  }
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as FakeMcpFixture;
  return parsed;
}

/**
 * A minimal, real {@link BaseDeclarativeTool} representing a tool discovered
 * from a fake MCP server. It carries a non-empty `serverName`, which is the
 * marker {@link ToolRegistry.isDiscoveredMcpTool} uses to classify a tool as
 * MCP-originated. Execution is intentionally inert (the fake provider never
 * issues tool calls during these scenarios), but the tool is a genuine
 * registry entry so listing/grouping logic runs for real.
 */
class FakeMcpToolInvocation extends BaseToolInvocation<
  Record<string, unknown>,
  ToolResult
> {
  getDescription(): string {
    return 'fake mcp tool invocation';
  }

  async execute(): Promise<ToolResult> {
    return {
      llmContent: '',
      returnDisplay: '',
    };
  }
}

export class FakeMcpTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  readonly serverName: string;

  constructor(serverName: string, toolName: string, description: string) {
    super(
      toolName,
      toolName,
      description,
      Kind.Other,
      { type: 'object', properties: {} },
      true,
      false,
    );
    this.serverName = serverName;
  }

  protected createInvocation(
    params: Record<string, unknown>,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    return new FakeMcpToolInvocation(params);
  }
}

/**
 * Applies fake discovery for a single server against the REAL tool registry
 * and the REAL server-status channel. Honors the fixture's discovery latency
 * and failure directives.
 *
 * On success: registers a {@link FakeMcpTool} per served tool and marks the
 * server CONNECTED. On failure: registers no tools, marks the server in an
 * error (DISCONNECTED) state, and returns the failure message so the manager
 * can surface it through the normal discovery-failure path.
 */
export async function applyFakeServerDiscovery(
  name: string,
  toolRegistry: ToolRegistry,
  fixture: FakeMcpFixture,
): Promise<FakeMcpDiscoveryOutcome> {
  if (!Object.prototype.hasOwnProperty.call(fixture.servers, name)) {
    updateMCPServerStatus(name, MCPServerStatus.DISCONNECTED);
    return { status: MCPServerStatus.DISCONNECTED, registeredToolNames: [] };
  }
  const server = fixture.servers[name];

  updateMCPServerStatus(name, MCPServerStatus.CONNECTING);

  const latencyMs = server.latencyMs ?? 0;
  if (latencyMs > 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, latencyMs);
    });
  }

  if (typeof server.failure === 'string') {
    updateMCPServerStatus(name, MCPServerStatus.DISCONNECTED);
    return {
      status: MCPServerStatus.DISCONNECTED,
      registeredToolNames: [],
      failure: server.failure,
    };
  }

  toolRegistry.removeMcpToolsByServer(name);
  const registeredToolNames: string[] = [];
  for (const tool of server.tools ?? []) {
    const enabled = tool.enabled ?? true;
    if (!enabled) {
      continue;
    }
    toolRegistry.registerTool(
      new FakeMcpTool(name, tool.name, tool.description ?? ''),
    );
    registeredToolNames.push(tool.name);
  }

  updateMCPServerStatus(name, MCPServerStatus.CONNECTED);
  return {
    status: MCPServerStatus.CONNECTED,
    registeredToolNames,
  };
}
