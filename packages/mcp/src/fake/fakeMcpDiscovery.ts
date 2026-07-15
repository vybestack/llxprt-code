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
import { z } from 'zod';
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
import { MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE } from '../client/mcp-errors.js';
import { generateMcpToolName } from '../client/mcp-tool.js';

const FakeMcpFixtureToolSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const FakeMcpFixtureServerSchema = z
  .object({
    tools: z.array(FakeMcpFixtureToolSchema).optional(),
    latencyMs: z.number().finite().nonnegative().optional(),
    failure: z.string().optional(),
  })
  .strict();

const FakeMcpFixtureSchema = z
  .object({
    servers: z.record(FakeMcpFixtureServerSchema),
  })
  .strict();

export type FakeMcpFixtureTool = z.infer<typeof FakeMcpFixtureToolSchema>;
export type FakeMcpFixtureServer = z.infer<typeof FakeMcpFixtureServerSchema>;
export type FakeMcpFixture = z.infer<typeof FakeMcpFixtureSchema>;

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
  const parsed: unknown = JSON.parse(raw);
  const result = FakeMcpFixtureSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid fake MCP fixture '${path}': ${result.error.message}`,
    );
  }
  return result.data;
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
  constructor(
    params: Record<string, unknown>,
    private readonly isAuthorized: () => boolean,
  ) {
    super(params);
  }

  getDescription(): string {
    return 'fake mcp tool invocation';
  }

  async execute(): Promise<ToolResult> {
    if (!isAuthorizedSafely(this.isAuthorized)) {
      return {
        llmContent: MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE,
        returnDisplay: MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE,
        error: { message: MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE },
      };
    }
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

  constructor(
    serverName: string,
    toolName: string,
    description: string,
    private readonly isAuthorized: () => boolean,
  ) {
    super(
      generateMcpToolName(serverName, toolName),
      `${toolName} (${serverName} MCP Server)`,
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
    return new FakeMcpToolInvocation(params, this.isAuthorized);
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
function isAuthorizedSafely(isAuthorized: () => boolean): boolean {
  try {
    return isAuthorized();
  } catch {
    return false;
  }
}

async function waitForLatency(
  latencyMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (latencyMs <= 0 || signal?.aborted === true) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timeout = setTimeout(finish, latencyMs);
    signal?.addEventListener('abort', finish, { once: true });
    if (signal?.aborted === true) finish();
  });
}

function disconnectFakeServer(
  name: string,
  toolRegistry: ToolRegistry,
  failure?: string,
): FakeMcpDiscoveryOutcome {
  try {
    toolRegistry.removeMcpToolsByServer(name);
  } finally {
    updateMCPServerStatus(name, MCPServerStatus.DISCONNECTED);
  }
  return {
    status: MCPServerStatus.DISCONNECTED,
    registeredToolNames: [],
    ...(failure === undefined ? {} : { failure }),
  };
}

export async function applyFakeServerDiscovery(
  name: string,
  toolRegistry: ToolRegistry,
  fixture: FakeMcpFixture,
  isAuthorized: () => boolean,
  signal?: AbortSignal,
): Promise<FakeMcpDiscoveryOutcome> {
  const hasAuthorization = (): boolean =>
    signal?.aborted !== true && isAuthorizedSafely(isAuthorized);
  if (!hasAuthorization()) {
    return disconnectFakeServer(name, toolRegistry);
  }
  if (!Object.prototype.hasOwnProperty.call(fixture.servers, name)) {
    return disconnectFakeServer(name, toolRegistry);
  }
  const server = fixture.servers[name];

  updateMCPServerStatus(name, MCPServerStatus.CONNECTING);
  if (!hasAuthorization()) {
    return disconnectFakeServer(name, toolRegistry);
  }

  await waitForLatency(server.latencyMs ?? 0, signal);
  if (!hasAuthorization()) {
    return disconnectFakeServer(name, toolRegistry);
  }

  if (typeof server.failure === 'string') {
    return disconnectFakeServer(name, toolRegistry, server.failure);
  }

  toolRegistry.removeMcpToolsByServer(name);
  if (!hasAuthorization()) {
    return disconnectFakeServer(name, toolRegistry);
  }
  const registeredToolNames: string[] = [];
  for (const tool of server.tools ?? []) {
    if (tool.enabled === false) continue;
    if (!hasAuthorization()) {
      return disconnectFakeServer(name, toolRegistry);
    }
    toolRegistry.registerTool(
      new FakeMcpTool(
        name,
        tool.name,
        tool.description ?? '',
        hasAuthorization,
      ),
    );
    if (!hasAuthorization()) {
      return disconnectFakeServer(name, toolRegistry);
    }
    registeredToolNames.push(generateMcpToolName(name, tool.name));
  }

  if (!hasAuthorization()) {
    return disconnectFakeServer(name, toolRegistry);
  }
  updateMCPServerStatus(name, MCPServerStatus.CONNECTED);
  return {
    status: MCPServerStatus.CONNECTED,
    registeredToolNames,
  };
}
