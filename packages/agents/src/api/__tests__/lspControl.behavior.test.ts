/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P05
 *
 * BEHAVIORAL RED suite for the `agent.lsp` sub-controller
 * (AgentLspControl). Drives through the PUBLIC ROOT via the buildAgent
 * harness over a real FakeProvider. The REAL LSP surface is reached through
 * Config.getLspConfig()/getLspServiceClient() with ZERO mocking.
 *
 * The `agent.lsp` sub-controller is wired through the real LspControl
 * delegation to Config.getLspConfig()/getLspServiceClient().
 */

import { describe, it, expect } from 'vitest';
import type {
  AgentLspConfig,
  AgentLspServerConfig,
} from '@vybestack/llxprt-code-agents';
import { buildAgent } from './helpers/agentHarness.js';

describe('agent.lsp control @plan:PLAN-20260626-RUNTIMEBOUNDARY.P05', () => {
  it('status resolves to a snapshot object with a disabled flag @scenario:status @given:an agent built normally (LSP typically not configured in tests) @when:agent.lsp.status() @then:the result has a "disabled" boolean property', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const status = await agent.lsp.status();
      expect(typeof status).toBe('object');
      expect(status).not.toBeNull();
      expect('disabled' in status).toBe(true);
      expect(typeof status.disabled).toBe('boolean');
    } finally {
      await cleanup();
    }
  });

  it('status reports disabled:true when no LSP is configured @scenario:disabled-when-unconfigured @given:an agent built without any LSP config @when:agent.lsp.status() @then:status.disabled === true (no LSP servers configured)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const status = await agent.lsp.status();
      // Without LSP configuration, the snapshot reports disabled: true.
      expect(status.disabled).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('status snapshot includes a servers array @scenario:servers-array @given:an agent built normally @when:agent.lsp.status() @then:the result has a "servers" property that is an array', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const status = await agent.lsp.status();
      expect('servers' in status).toBe(true);
      expect(Array.isArray(status.servers)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('reports configured servers as unavailable when the LSP client is not alive @scenario:configured-unavailable @given:an agent with one LSP server whose client cannot start @when:agent.lsp.status() @then:the configured server is projected as unhealthy instead of being dropped', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      lsp: {
        servers: [
          {
            id: 'ts-lsp',
            command: '/definitely/not/a/real/lsp',
          },
        ],
      },
    });
    try {
      const status = await agent.lsp.status();
      expect(status.servers).toStrictEqual([
        expect.objectContaining({
          serverId: 'ts-lsp',
          healthy: false,
        }),
      ]);
    } finally {
      await cleanup();
    }
  });

  it('rejects malformed LSP configs before runtime projection @scenario:lsp-schema-server-id @given:agent configs with missing servers or server id @when:createAgent parses config @then:construction rejects instead of exposing undefined server ids', async () => {
    await expect(
      buildAgent('plain-text.jsonl', {
        lsp: {} as unknown as AgentLspConfig,
      }),
    ).rejects.toBeInstanceOf(Error);

    await expect(
      buildAgent('plain-text.jsonl', {
        lsp: {
          servers: [
            {
              command: 'definitely-not-a-real-lsp-command',
            } as unknown as AgentLspServerConfig,
          ],
        } as unknown as AgentLspConfig,
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});
