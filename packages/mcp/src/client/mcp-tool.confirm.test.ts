/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Mocked } from 'vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscoveredMCPTool } from './mcp-tool.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type { CallableTool } from '@google/genai';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

// DiscoveredMCPToolInvocation stores an allowlist on its constructor (static).
// This type centralizes the one unavoidable internal-state access for tests.
type InvocationWithAllowlist = {
  constructor: { allowlist: Set<string> };
};

// We only need to mock the parts of CallableTool that DiscoveredMCPTool uses.
const mockCallTool = vi.fn();
const mockToolMethod = vi.fn();

const mockCallableToolInstance: Mocked<CallableTool> = {
  tool: mockToolMethod as unknown as CallableTool['tool'],
  callTool: mockCallTool as unknown as CallableTool['callTool'],
  // Add other methods if DiscoveredMCPTool starts using them
};

describe('DiscoveredMCPTool', () => {
  const serverName = 'mock-mcp-server';
  const serverToolName = 'actual-server-tool-name';
  const baseDescription = 'A test MCP tool.';
  const inputSchema: Record<string, unknown> = {
    type: 'object' as const,
    properties: { param: { type: 'string' } },
    required: ['param'],
  };

  let tool: DiscoveredMCPTool;

  beforeEach(() => {
    mockCallTool.mockClear();
    mockToolMethod.mockClear();
    tool = new DiscoveredMCPTool(
      mockCallableToolInstance,
      serverName,
      serverToolName,
      baseDescription,
      inputSchema,
    );
    const invocation = tool.build({
      param: 'mock',
    }) as unknown as InvocationWithAllowlist;
    invocation.constructor.allowlist.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('shouldConfirmExecute', () => {
    it('should return false if trust is true', async () => {
      const trustedTool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        true,
        undefined,
        { isTrustedFolder: () => true } as unknown as Config,
      );
      const invocation = trustedTool.build({ param: 'mock' });
      expect(
        await invocation.shouldConfirmExecute(new AbortController().signal),
      ).toBe(false);
    });

    it('should return false if server is allowlisted', async () => {
      const invocation = tool.build({
        param: 'mock',
      }) as unknown as InvocationWithAllowlist;
      invocation.constructor.allowlist.add(serverName);
      expect(
        await invocation.shouldConfirmExecute(new AbortController().signal),
      ).toBe(false);
    });

    it('should return false if tool is allowlisted', async () => {
      const toolAllowlistKey = `${serverName}.${serverToolName}`;
      const invocation = tool.build({
        param: 'mock',
      }) as unknown as InvocationWithAllowlist;
      invocation.constructor.allowlist.add(toolAllowlistKey);
      expect(
        await invocation.shouldConfirmExecute(new AbortController().signal),
      ).toBe(false);
    });

    it('should return confirmation details if not trusted and not allowlisted', async () => {
      const invocation = tool.build({ param: 'mock' });
      const confirmation = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );

      // Assert confirmation is not false and has the expected structure
      expect(confirmation).not.toBe(false);
      expect(confirmation).toBeTruthy();

      // Type assertion after verification
      const typedConfirmation = confirmation as {
        type: string;
        serverName?: string;
        toolName?: string;
      };
      expect(typedConfirmation.type).toBe('mcp');
      expect(typedConfirmation.serverName).toBe(serverName);
      expect(typedConfirmation.toolName).toBe(serverToolName);
    });

    it('should add server to allowlist on ProceedAlwaysServer', async () => {
      const invocation = tool.build({
        param: 'mock',
      }) as unknown as InvocationWithAllowlist;
      const confirmation = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );

      // Assert confirmation has expected structure
      expect(confirmation).not.toBe(false);
      expect(confirmation).toBeTruthy();
      expect(confirmation).toHaveProperty('onConfirm');

      // Type assertion after verification
      const typedConfirmation = confirmation as {
        onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
      };
      await typedConfirmation.onConfirm(
        ToolConfirmationOutcome.ProceedAlwaysServer,
      );
      expect(invocation.constructor.allowlist.has(serverName)).toBe(true);
    });

    it('should add tool to allowlist on ProceedAlwaysTool', async () => {
      const toolAllowlistKey = `${serverName}.${serverToolName}`;
      const invocation = tool.build({
        param: 'mock',
      }) as unknown as InvocationWithAllowlist;
      const confirmation = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );

      // Assert confirmation has expected structure
      expect(confirmation).not.toBe(false);
      expect(confirmation).toBeTruthy();
      expect(confirmation).toHaveProperty('onConfirm');

      // Type assertion after verification
      const typedConfirmation = confirmation as {
        onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
      };
      await typedConfirmation.onConfirm(
        ToolConfirmationOutcome.ProceedAlwaysTool,
      );
      expect(invocation.constructor.allowlist.has(toolAllowlistKey)).toBe(true);
    });

    it('should handle Cancel confirmation outcome', async () => {
      const invocation = tool.build({
        param: 'mock',
      }) as unknown as InvocationWithAllowlist;
      const confirmation = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );

      // Assert confirmation has expected structure
      expect(confirmation).not.toBe(false);
      expect(confirmation).toBeTruthy();
      expect(confirmation).toHaveProperty('onConfirm');

      // Type assertion after verification - Cancel should not add anything to allowlist
      const typedConfirmation = confirmation as {
        onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
      };
      await typedConfirmation.onConfirm(ToolConfirmationOutcome.Cancel);
      expect(invocation.constructor.allowlist.has(serverName)).toBe(false);
      expect(
        invocation.constructor.allowlist.has(`${serverName}.${serverToolName}`),
      ).toBe(false);
    });

    it('should handle ProceedOnce confirmation outcome', async () => {
      const invocation = tool.build({
        param: 'mock',
      }) as unknown as InvocationWithAllowlist;
      const confirmation = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );

      // Assert confirmation has expected structure
      expect(confirmation).not.toBe(false);
      expect(confirmation).toBeTruthy();
      expect(confirmation).toHaveProperty('onConfirm');

      // Type assertion after verification - ProceedOnce should not add anything to allowlist
      const typedConfirmation = confirmation as {
        onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>;
      };
      await typedConfirmation.onConfirm(ToolConfirmationOutcome.ProceedOnce);
      expect(invocation.constructor.allowlist.has(serverName)).toBe(false);
      expect(
        invocation.constructor.allowlist.has(`${serverName}.${serverToolName}`),
      ).toBe(false);
    });
  });

  describe('shouldConfirmExecute with folder trust', () => {
    const mockConfig = (isTrusted: boolean | undefined) => ({
      isTrustedFolder: () => isTrusted,
    });

    it('should return false if trust is true and folder is trusted', async () => {
      const trustedTool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        true, // trust = true
        undefined,
        mockConfig(true) as unknown as Config,
      );
      const invocation = trustedTool.build({ param: 'mock' });
      expect(
        await invocation.shouldConfirmExecute(new AbortController().signal),
      ).toBe(false);
    });

    it('should return confirmation details if trust is true but folder is not trusted', async () => {
      const trustedTool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        true, // trust = true
        undefined,
        mockConfig(false) as unknown as Config,
      );
      const invocation = trustedTool.build({ param: 'mock' });
      const confirmation = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );
      expect(confirmation).not.toBe(false);
      expect(confirmation).toHaveProperty('type', 'mcp');
    });

    it('should return confirmation details if trust is false, even if folder is trusted', async () => {
      const untrustedTool = new DiscoveredMCPTool(
        mockCallableToolInstance,
        serverName,
        serverToolName,
        baseDescription,
        inputSchema,
        false, // trust = false
        undefined,
        mockConfig(true) as unknown as Config,
      );
      const invocation = untrustedTool.build({ param: 'mock' });
      const confirmation = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );
      expect(confirmation).not.toBe(false);
      expect(confirmation).toHaveProperty('type', 'mcp');
    });
  });

  describe('DiscoveredMCPToolInvocation', () => {
    it('should return the stringified params from getDescription', () => {
      const params = { param: 'testValue', param2: 'anotherOne' };
      const invocation = tool.build(params);
      const description = invocation.getDescription();
      expect(description).toBe('{"param":"testValue","param2":"anotherOne"}');
    });
  });
});
