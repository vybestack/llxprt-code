/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fetch from 'node-fetch';

import { CodeSearchTool, type CodeSearchToolParams } from './codesearch.js';

vi.mock('node-fetch');
const mockedFetch = fetch as unknown as ReturnType<typeof vi.fn>;

describe('CodeSearchTool', () => {
  const keyStorage = { resolveKey: vi.fn() };
  const settingsService = {
    getSetting: vi.fn(),
    getSettingsService: vi.fn(() => ({ get: vi.fn() })),
  };
  let tool: CodeSearchTool;

  beforeEach(() => {
    vi.clearAllMocks();
    keyStorage.resolveKey.mockResolvedValue(null);
    settingsService.getSetting.mockReturnValue(undefined);
    tool = new CodeSearchTool({ keyStorage, settingsService });
  });

  it('validates parameters correctly', () => {
    const params: CodeSearchToolParams = { query: 'test query' };
    expect(tool.validateToolParams(params)).toBeNull();
  });

  it('executes search successfully with default tokens', async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          'data: {"result":{"content":[{"text":"Here is some React hooks documentation..."}]}}\n',
        ),
    });

    const result = await tool
      .build({ query: 'react hooks' })
      .execute(new AbortController().signal);

    const callArgs = mockedFetch.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    expect(callArgs[0]).toBe('https://mcp.exa.ai/mcp');
    expect(requestBody.params.arguments.tokensNum).toBe(5000);
    expect(result.llmContent).toBe('Here is some React hooks documentation...');
  });

  it('caps tokensNum with settings value when params exceed it', async () => {
    settingsService.getSetting.mockReturnValue(2000);
    mockedFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });

    await tool
      .build({ query: 'test', tokensNum: 4000 })
      .execute(new AbortController().signal);

    const requestBody = JSON.parse(mockedFetch.mock.calls[0][1].body);
    expect(requestBody.params.arguments.tokensNum).toBe(2000);
  });

  it('appends exaApiKey query parameter when key is available', async () => {
    keyStorage.resolveKey.mockResolvedValue('sk-test-key');
    mockedFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });

    await tool
      .build({ query: 'test query' })
      .execute(new AbortController().signal);

    expect(mockedFetch.mock.calls[0][0]).toBe(
      'https://mcp.exa.ai/mcp?exaApiKey=sk-test-key',
    );
  });

  it('handles API errors', async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    const result = await tool
      .build({ query: 'error' })
      .execute(new AbortController().signal);

    expect(result.error?.message).toContain('Code search error (500)');
  });
});
