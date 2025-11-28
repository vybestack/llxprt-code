/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DirectWebFetchTool,
  DirectWebFetchToolParams,
} from './direct-web-fetch.js';
import { Config } from '../config/config.js';
import { ToolInvocation, ToolResult } from './tools.js';
import fetch from 'node-fetch';

vi.mock('node-fetch');
const mockedFetch = fetch as unknown as ReturnType<typeof vi.fn>;

describe('DirectWebFetchTool', () => {
  let config: Config;
  let tool: DirectWebFetchTool;

  beforeEach(() => {
    config = {
      getTargetDir: () => '/mock/target/dir',
    } as unknown as Config;
    tool = new DirectWebFetchTool(config);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should validate URL protocol', async () => {
    const params: DirectWebFetchToolParams = {
      url: 'ftp://example.com',
      format: 'text',
    };
    const invocation = tool.build(params) as ToolInvocation<
      DirectWebFetchToolParams,
      ToolResult
    >;

    const result = await invocation.execute(new AbortController().signal);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Invalid URL protocol');
  });

  it('should fetch and return text content', async () => {
    const params: DirectWebFetchToolParams = {
      url: 'https://example.com',
      format: 'text',
    };
    const invocation = tool.build(params) as ToolInvocation<
      DirectWebFetchToolParams,
      ToolResult
    >;

    const htmlContent = '<html><body><h1>Hello</h1><p>World</p></body></html>';
    mockedFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: (key: string) => {
          if (key === 'content-type') return 'text/html';
          if (key === 'content-length') return htmlContent.length.toString();
          return null;
        },
      },
      arrayBuffer: () => Promise.resolve(Buffer.from(htmlContent)),
    });

    const result = await invocation.execute(new AbortController().signal);

    expect(mockedFetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: expect.stringContaining('text/plain'),
        }),
      }),
    );
    // Cheerio extraction might vary slightly, but should contain "Hello" and "World"
    expect(result.llmContent).toContain('Hello');
    expect(result.llmContent).toContain('World');
  });

  it('should fetch and return markdown content', async () => {
    const params: DirectWebFetchToolParams = {
      url: 'https://example.com',
      format: 'markdown',
    };
    const invocation = tool.build(params) as ToolInvocation<
      DirectWebFetchToolParams,
      ToolResult
    >;

    const htmlContent = '<h1>Hello</h1><p>World</p>';
    mockedFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: (key: string) => {
          if (key === 'content-type') return 'text/html';
          if (key === 'content-length') return htmlContent.length.toString();
          return null;
        },
      },
      arrayBuffer: () => Promise.resolve(Buffer.from(htmlContent)),
    });

    const result = await invocation.execute(new AbortController().signal);

    // Turndown conversion
    expect(result.llmContent).toContain('# Hello');
    expect(result.llmContent).toContain('World');
  });

  it('should handle fetch errors', async () => {
    const params: DirectWebFetchToolParams = {
      url: 'https://example.com',
      format: 'text',
    };
    const invocation = tool.build(params) as ToolInvocation<
      DirectWebFetchToolParams,
      ToolResult
    >;

    mockedFetch.mockRejectedValue(new Error('Network error'));

    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Network error');
  });

  it('should handle large files', async () => {
    const params: DirectWebFetchToolParams = {
      url: 'https://example.com/large',
      format: 'text',
    };
    const invocation = tool.build(params) as ToolInvocation<
      DirectWebFetchToolParams,
      ToolResult
    >;

    mockedFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: (key: string) => {
          if (key === 'content-length') return (10 * 1024 * 1024).toString(); // 10MB
          return null;
        },
      },
    });

    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Response too large');
  });
});
