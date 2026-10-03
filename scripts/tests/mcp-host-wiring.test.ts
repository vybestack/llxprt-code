/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  CoreEvent,
  coreEvents,
  openBrowserSecurely,
  type UserFeedbackPayload,
} from '@vybestack/llxprt-code-core';
import {
  defaultHostServices,
  deliverHostFeedback,
  MCP_CLIENT_UPDATE_EVENT,
} from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import { agentMcpFeedback } from '../../packages/agents/src/api/mcpHostWiring.js';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

describe('application MCP host ports', () => {
  it('delivers agent feedback through core events without changing error identity', () => {
    const received: UserFeedbackPayload[] = [];
    const listener = (payload: UserFeedbackPayload): void => {
      received.push(payload);
    };
    const failure = new Error('MCP failure');
    coreEvents.on(CoreEvent.UserFeedback, listener);
    try {
      deliverHostFeedback(agentMcpFeedback, 'error', 'Server failed', failure);
    } finally {
      coreEvents.off(CoreEvent.UserFeedback, listener);
    }
    expect(received).toEqual([
      { severity: 'error', message: 'Server failed', error: failure },
    ]);
  });

  it('rejects unsafe browser launch through the secure core launcher', async () => {
    await expect(openBrowserSecurely('javascript:alert(1)')).rejects.toThrow();
  });

  it('preserves standalone manual browser fallback and the update event identity', async () => {
    expect(MCP_CLIENT_UPDATE_EVENT).toBe(CoreEvent.McpClientUpdate);
    await expect(
      defaultHostServices.openBrowser('https://example.test'),
    ).rejects.toThrow('No browser launcher registered by the host');
  });

  it('passes host ports on the owning Config rather than registering at startup', () => {
    for (const file of [
      'packages/cli/src/config/configBuilder.ts',
      'packages/agents/src/api/createAgent.ts',
    ]) {
      const source = readFileSync(join(repoRoot, file), 'utf8');
      expect(source).toContain('mcpFeedback:');
      expect(source).toContain('mcpBrowser:');
    }
    for (const file of [
      'packages/cli/src/cli.tsx',
      'packages/agents/src/api/createAgent.ts',
      'packages/agents/src/api/fromConfig.ts',
    ]) {
      expect(readFileSync(join(repoRoot, file), 'utf8')).not.toContain(
        'wireMcpHostServices',
      );
    }
  });
});
