/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import {
  MCPServerStatus,
  addMCPStatusChangeListener,
  getMCPServerStatus,
  removeMCPStatusChangeListener,
} from '../client/mcp-client.js';
import { MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE } from '../client/mcp-errors.js';
import { generateMcpToolName } from '../client/mcp-tool.js';
import {
  applyFakeServerDiscovery,
  type FakeMcpFixture,
} from './fakeMcpDiscovery.js';

function createToolRegistry(): ToolRegistry {
  return new ToolRegistry({}, { requestConfirmation: async () => false });
}

function fixtureWithTool(name: string, latencyMs?: number): FakeMcpFixture {
  return {
    servers: {
      [name]: {
        tools: [{ name: `${name}_tool` }],
        latencyMs,
      },
    },
  };
}

describe('applyFakeServerDiscovery authorization', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('discards discovery when authorization is revoked during fixture latency', async () => {
    vi.useFakeTimers();
    const name = 'latency-revocation';
    const registry = createToolRegistry();
    let authorized = true;

    const discovery = applyFakeServerDiscovery(
      name,
      registry,
      fixtureWithTool(name, 50),
      () => authorized,
    );
    await vi.advanceTimersByTimeAsync(25);
    authorized = false;
    await vi.advanceTimersByTimeAsync(25);

    await expect(discovery).resolves.toStrictEqual({
      status: MCPServerStatus.DISCONNECTED,
      registeredToolNames: [],
    });
    expect(registry.getTool(`${name}_tool`)).toBeUndefined();
    expect(getMCPServerStatus(name)).toBe(MCPServerStatus.DISCONNECTED);
  });

  it('treats authorization callback failures as revoked authorization', async () => {
    const name = 'authorization-error';
    const registry = createToolRegistry();

    const outcome = await applyFakeServerDiscovery(
      name,
      registry,
      fixtureWithTool(name),
      () => {
        throw new Error('authorization unavailable');
      },
    );

    expect(outcome).toStrictEqual({
      status: MCPServerStatus.DISCONNECTED,
      registeredToolNames: [],
    });
    expect(registry.getTool(`${name}_tool`)).toBeUndefined();
    expect(getMCPServerStatus(name)).toBe(MCPServerStatus.DISCONNECTED);
  });

  it('rolls back the tool whose publication revokes authorization', async () => {
    const name = 'tool-publication-revocation';
    const toolName = generateMcpToolName(name, `${name}_tool`);
    const registry = createToolRegistry();

    const outcome = await applyFakeServerDiscovery(
      name,
      registry,
      fixtureWithTool(name),
      () => registry.getTool(toolName) === undefined,
    );

    expect(outcome).toStrictEqual({
      status: MCPServerStatus.DISCONNECTED,
      registeredToolNames: [],
    });
    expect(registry.getTool(toolName)).toBeUndefined();
    expect(getMCPServerStatus(name)).toBe(MCPServerStatus.DISCONNECTED);
  });

  it('denies invocation through a stale fake tool handle after authorization is revoked', async () => {
    const name = 'stale-handle-revocation';
    const toolName = generateMcpToolName(name, `${name}_tool`);
    const registry = createToolRegistry();
    let authorized = true;

    await applyFakeServerDiscovery(
      name,
      registry,
      fixtureWithTool(name),
      () => authorized,
    );
    const staleInvocation = registry.getTool(toolName)?.build({});
    expect(staleInvocation).toBeDefined();

    authorized = false;
    const result = await staleInvocation?.execute(new AbortController().signal);

    expect(result).toMatchObject({
      error: {
        message: expect.stringContaining(MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE),
      },
    });
  });

  it.each([MCPServerStatus.CONNECTING, MCPServerStatus.CONNECTED])(
    'rolls back when the %s status publication revokes authorization',
    async (revokingStatus) => {
      const name = `status-${revokingStatus}-revocation`;
      const registry = createToolRegistry();
      let authorized = true;
      const revokeOnStatus = (
        serverName: string,
        status: MCPServerStatus,
      ): void => {
        if (serverName === name && status === revokingStatus) {
          authorized = false;
        }
      };
      addMCPStatusChangeListener(revokeOnStatus);

      try {
        const outcome = await applyFakeServerDiscovery(
          name,
          registry,
          fixtureWithTool(name),
          () => authorized,
        );

        expect(outcome).toStrictEqual({
          status: MCPServerStatus.DISCONNECTED,
          registeredToolNames: [],
        });
        expect(registry.getTool(`${name}_tool`)).toBeUndefined();
        expect(getMCPServerStatus(name)).toBe(MCPServerStatus.DISCONNECTED);
      } finally {
        removeMCPStatusChangeListener(revokeOnStatus);
      }
    },
  );
});
