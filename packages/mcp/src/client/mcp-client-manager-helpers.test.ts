/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import type { PromptRegistry } from './test-support/mcpClientTestSupport.js';
import type { ResourceRegistry } from './test-support/mcpClientTestSupport.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { removeMcpServerArtifacts } from './mcp-client-manager-helpers.js';

describe('removeMcpServerArtifacts', () => {
  it('reports a single cleanup failure through the aggregate contract', () => {
    const cleanupFailure = new Error('tool cleanup failed');
    const toolRegistry = {
      removeMcpToolsByServer: vi.fn(() => {
        throw cleanupFailure;
      }),
    } as unknown as ToolRegistry;
    const promptRegistry = {
      removePromptsByServer: vi.fn(),
    } as unknown as PromptRegistry;
    const resourceRegistry = {
      removeResourcesByServer: vi.fn(),
    } as unknown as ResourceRegistry;

    let failure: unknown;
    try {
      removeMcpServerArtifacts(
        'test-server',
        toolRegistry,
        promptRegistry,
        resourceRegistry,
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      message: "Failed to remove MCP artifacts for 'test-server'",
      errors: [cleanupFailure],
    });
  });
});
