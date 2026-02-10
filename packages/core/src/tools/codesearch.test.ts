/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodeSearchTool, CodeSearchToolParams } from './codesearch.js';
import { Config } from '../config/config.js';
import { ToolInvocation, ToolResult } from './tools.js';
import fetch from 'node-fetch';

vi.mock('node-fetch');
const mockedFetch = fetch as unknown as ReturnType<typeof vi.fn>;

describe('CodeSearchTool', () => {
  let config: Config;
  let tool: CodeSearchTool;
  let mockSettingsService: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockSettingsService = {
      get: vi.fn(),
    };
    config = {
      getTargetDir: () => '/mock/target/dir',
      getSettingsService: () => mockSettingsService,
    } as unknown as Config;
    tool = new CodeSearchTool(config);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should validate parameters correctly', () => {
    const params: CodeSearchToolParams = { query: 'test query' };
    expect(tool.validateToolParams(params)).toBeNull();
  });

  it('should fail validation if query is missing', () => {
    // @ts-expect-error Testing invalid params which are not allowed by types
    const params: CodeSearchToolParams = {};
    expect(() => tool.build(params)).toThrow();
  });

  it('should execute search successfully with default tokens', async () => {
    const params: CodeSearchToolParams = { query: 'react hooks' };
    const invocation = tool.build(params) as ToolInvocation<
      CodeSearchToolParams,
      ToolResult
    >;

    const mockResponseData = {
      jsonrpc: '2.0',
      result: {
        content: [
          {
            type: 'text',
            text: 'Here is some React hooks documentation...',
          },
        ],
      },
    };

    const mockResponseText = `data: ${JSON.stringify(mockResponseData)}\n\n`;

    mockedFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockResponseText),
    });

    const result = await invocation.execute(new AbortController().signal);

    expect(mockedFetch).toHaveBeenCalledWith(
      'https://mcp.exa.ai/mcp',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('react hooks'),
      }),
    );

    // Verify default tokensNum (5000) is sent
    const callArgs = mockedFetch.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    expect(requestBody.params.arguments.tokensNum).toBe(5000);

    expect(result.llmContent).toBe('Here is some React hooks documentation...');
  });

  it('should use tokensNum from params', async () => {
    const params: CodeSearchToolParams = { query: 'test', tokensNum: 2000 };
    const invocation = tool.build(params) as ToolInvocation<
      CodeSearchToolParams,
      ToolResult
    >;

    mockedFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
    await invocation.execute(new AbortController().signal);

    const callArgs = mockedFetch.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    expect(requestBody.params.arguments.tokensNum).toBe(2000);
  });

  it('should use tokensNum from settings if param missing', async () => {
    mockSettingsService.get.mockReturnValue(3000);
    const params: CodeSearchToolParams = { query: 'test' };
    const invocation = tool.build(params) as ToolInvocation<
      CodeSearchToolParams,
      ToolResult
    >;

    mockedFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
    await invocation.execute(new AbortController().signal);

    const callArgs = mockedFetch.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    expect(requestBody.params.arguments.tokensNum).toBe(3000);
  });

  it('should cap tokensNum with settings value when params exceed it', async () => {
    mockSettingsService.get.mockReturnValue(2000);
    const params: CodeSearchToolParams = { query: 'test', tokensNum: 4000 };
    const invocation = tool.build(params) as ToolInvocation<
      CodeSearchToolParams,
      ToolResult
    >;

    mockedFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
    await invocation.execute(new AbortController().signal);

    const callArgs = mockedFetch.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    expect(requestBody.params.arguments.tokensNum).toBe(2000); // Capped at 2000
  });

  it('should use params when lower than settings cap', async () => {
    mockSettingsService.get.mockReturnValue(4000);
    const params: CodeSearchToolParams = { query: 'test', tokensNum: 2000 };
    const invocation = tool.build(params) as ToolInvocation<
      CodeSearchToolParams,
      ToolResult
    >;

    mockedFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
    await invocation.execute(new AbortController().signal);

    const callArgs = mockedFetch.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    expect(requestBody.params.arguments.tokensNum).toBe(2000); // Not capped
  });

  it('should clamp to absolute API limits', async () => {
    // Test Min (Absolute limit 1000)
    // Set setting to 100 (below min), params to 2000 (valid)
    // Logic: min(2000, 100) = 100 -> max(1000, 100) = 1000
    mockSettingsService.get.mockReturnValue(100);
    const paramsMin: CodeSearchToolParams = { query: 'test', tokensNum: 2000 };
    const invocationMin = tool.build(paramsMin) as ToolInvocation<
      CodeSearchToolParams,
      ToolResult
    >;
    mockedFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
    await invocationMin.execute(new AbortController().signal);
    const bodyMin = JSON.parse(mockedFetch.mock.calls[0][1].body);
    expect(bodyMin.params.arguments.tokensNum).toBe(1000);

    vi.clearAllMocks();

    // Test Max (Absolute limit 50000)
    // Set setting to 60000 (above max), params to 50000 (valid max)
    // Logic: min(50000, 60000) = 50000 -> max(1000, 50000) = 50000
    mockSettingsService.get.mockReturnValue(60000);
    const paramsMax: CodeSearchToolParams = { query: 'test', tokensNum: 50000 };
    const invocationMax = tool.build(paramsMax) as ToolInvocation<
      CodeSearchToolParams,
      ToolResult
    >;
    mockedFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
    await invocationMax.execute(new AbortController().signal);
    const bodyMax = JSON.parse(mockedFetch.mock.calls[0][1].body);
    expect(bodyMax.params.arguments.tokensNum).toBe(50000);
  });

  it('should clamp settings tokensNum to min/max', async () => {
    // Test Min via Settings with default params
    // Params default 5000, setting 100 -> min(5000, 100) = 100 -> max(1000, 100) = 1000
    mockSettingsService.get.mockReturnValue(100);
    const paramsMin: CodeSearchToolParams = { query: 'test' };
    const invocationMin = tool.build(paramsMin) as ToolInvocation<
      CodeSearchToolParams,
      ToolResult
    >;
    mockedFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
    await invocationMin.execute(new AbortController().signal);
    const bodyMin = JSON.parse(mockedFetch.mock.calls[0][1].body);
    expect(bodyMin.params.arguments.tokensNum).toBe(1000);

    vi.clearAllMocks();

    // Test Max via Settings with valid params
    // Params 40000, setting 100000 -> min(40000, 100000) = 40000 -> max(1000, 40000) = 40000
    // This confirms setting doesn't artificially raise it above params/max
    mockSettingsService.get.mockReturnValue(100000);
    const paramsMax: CodeSearchToolParams = { query: 'test', tokensNum: 40000 };
    const invocationMax = tool.build(paramsMax) as ToolInvocation<
      CodeSearchToolParams,
      ToolResult
    >;
    mockedFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
    await invocationMax.execute(new AbortController().signal);
    const bodyMax = JSON.parse(mockedFetch.mock.calls[0][1].body);
    expect(bodyMax.params.arguments.tokensNum).toBe(40000);
  });

  it('should handle no results found', async () => {
    const params: CodeSearchToolParams = { query: 'nonexistent' };
    const invocation = tool.build(params) as ToolInvocation<
      CodeSearchToolParams,
      ToolResult
    >;

    mockedFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''), // Empty response or no data events
    });

    const result = await invocation.execute(new AbortController().signal);

    expect(result.llmContent).toContain(
      'No code snippets or documentation found',
    );
  });

  it('should handle API errors', async () => {
    const params: CodeSearchToolParams = { query: 'error' };
    const invocation = tool.build(params) as ToolInvocation<
      CodeSearchToolParams,
      ToolResult
    >;

    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Code search error (500)');
  });

  /**
   * Integration tests for tool key URL parameter injection.
   * Uses vi.doMock on tool-key-storage to control resolveKey() return values.
   * Behavioral assertions are on the fetch URL (with or without ?exaApiKey=).
   *
   * @plan PLAN-20260206-TOOLKEY.P10
   */
  describe('API key integration', () => {
    let resolveKeyMock: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      vi.clearAllMocks();

      // Mock tool-key-storage module — same pattern as exa-web-search tests.
      // The behavioral output under test is the fetch URL.
      resolveKeyMock = vi.fn().mockResolvedValue(null);
      const mockInstance = { resolveKey: resolveKeyMock };
      vi.doMock('./tool-key-storage.js', () => ({
        ToolKeyStorage: vi.fn().mockImplementation(() => mockInstance),
        getToolKeyStorage: vi.fn().mockReturnValue(mockInstance),
      }));

      // Re-import to pick up the mock
      const mod = await import('./codesearch.js');
      const CodeSearchToolFresh = mod.CodeSearchTool;

      config = {
        getTargetDir: () => '/mock/target/dir',
        getSettingsService: () => mockSettingsService,
      } as unknown as Config;

      tool = new CodeSearchToolFresh(config);
    });

    /** @plan PLAN-20260206-TOOLKEY.P10 @requirement REQ-004.1, REQ-004.2 */
    it('should append exaApiKey query parameter when key is available', async () => {
      resolveKeyMock.mockResolvedValue('sk-test-key');

      const mockResponseData = {
        jsonrpc: '2.0',
        result: {
          content: [{ type: 'text', text: 'Code results' }],
        },
      };
      const mockResponseText = `data: ${JSON.stringify(mockResponseData)}\n\n`;

      mockedFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockResponseText),
      });

      const invocation = tool.build({ query: 'test query' }) as ToolInvocation<
        CodeSearchToolParams,
        ToolResult
      >;
      await invocation.execute(new AbortController().signal);

      const fetchCall = mockedFetch.mock.calls[0];
      expect(fetchCall[0]).toBe('https://mcp.exa.ai/mcp?exaApiKey=sk-test-key');
    });

    /** @plan PLAN-20260206-TOOLKEY.P10 @requirement REQ-004.3 */
    it('should use base URL without query parameter when no key configured', async () => {
      resolveKeyMock.mockResolvedValue(null);

      mockedFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
      });

      const invocation = tool.build({ query: 'test query' }) as ToolInvocation<
        CodeSearchToolParams,
        ToolResult
      >;
      await invocation.execute(new AbortController().signal);

      const fetchCall = mockedFetch.mock.calls[0];
      expect(fetchCall[0]).toBe('https://mcp.exa.ai/mcp');
    });
  });
});
