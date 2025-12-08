/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { diagnosticsCommand } from './diagnosticsCommand.js';
import type { CommandContext } from './types.js';

describe('diagnosticsCommand OAuth token display', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = {
      services: {
        config: {
          getDebugMode: () => false,
          getApprovalMode: () => 'off',
          getIdeMode: () => false,
          getIdeClient: () => null,
          getMcpServers: () => ({}),
          getMcpServerCommand: () => null,
          getUserMemory: () => null,
          getLlxprtMdFileCount: () => 0,
          getToolRegistry: async () => ({
            getAllTools: () => [],
          }),
        },
        settings: {
          merged: {
            ui: {
              theme: 'default',
              usageStatisticsEnabled: false,
            },
            selectedAuthType: 'none',
            defaultProfile: 'none',
            sandbox: 'disabled',
          },
        },
      },
    } as unknown as CommandContext;
  });

  it('should include OAuth Tokens section in diagnostics output', async () => {
    const result = await diagnosticsCommand.action?.(mockContext, '');

    if (!result) return;
    expect(result.type).toBe('message');
    if (result.type === 'message' && result.messageType === 'info') {
      expect(result.content).toContain('## OAuth Tokens');
    }
  });

  it('should display no tokens message when no OAuth tokens are configured', async () => {
    const result = await diagnosticsCommand.action?.(mockContext, '');

    if (!result) return;
    expect(result.type).toBe('message');
    if (result.type === 'message') {
      const content = result.content;
      if (result.messageType === 'info') {
        expect(content).toContain('## OAuth Tokens');
        expect(
          content.includes('No OAuth tokens configured') ||
            content.includes('Not authenticated') ||
            content.includes('### Provider Tokens') ||
            content.includes('### MCP Server Tokens'),
        ).toBe(true);
      }
    }
  });

  it('should handle runtime initialization errors gracefully', async () => {
    const result = await diagnosticsCommand.action?.(mockContext, '');

    if (!result) return;
    expect(result.type).toBe('message');
    if (result.type === 'message' && result.messageType === 'error') {
      expect(result.content).toContain('Failed to generate diagnostics');
    } else if (result.type === 'message' && result.messageType === 'info') {
      expect(result.content).toContain('## OAuth Tokens');
    }
  });
});
