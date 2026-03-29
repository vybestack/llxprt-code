/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DirectWebFetchTool,
  type DirectWebFetchToolParams,
} from './direct-web-fetch.js';
import type { Config } from '../config/config.js';
import type { ToolResult as _ToolResult } from './tools.js';
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
    const invocation = tool.build(params);

    const result = await invocation.execute(new AbortController().signal);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Invalid URL protocol');
  });

  it('should fetch and return text content', async () => {
    const params: DirectWebFetchToolParams = {
      url: 'https://example.com',
      format: 'text',
    };
    const invocation = tool.build(params);

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
    const invocation = tool.build(params);

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
    const invocation = tool.build(params);

    mockedFetch.mockRejectedValue(new Error('Network error'));

    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Network error');
  });

  it('should preserve error cause chain in ToolResult', async () => {
    const params: DirectWebFetchToolParams = {
      url: 'https://example.com',
      format: 'text',
    };
    const invocation = tool.build(params);

    // Create an error with a cause chain
    const rootCause = new Error('ENOTFOUND');
    const fetchError = new Error('fetch failed', { cause: rootCause });
    mockedFetch.mockRejectedValue(fetchError);

    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('fetch failed');
    // The error message should include the cause information
    expect(result.error?.message).toContain('ENOTFOUND');
  });

  it('should handle large files', async () => {
    const params: DirectWebFetchToolParams = {
      url: 'https://example.com/large',
      format: 'text',
    };
    const invocation = tool.build(params);

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

  describe('retry behavior', () => {
    it('retries ENOTFOUND once and succeeds', async () => {
      const params: DirectWebFetchToolParams = {
        url: 'https://example.com',
        format: 'text',
      };
      const invocation = tool.build(params);

      const htmlContent = '<html><body>Success after retry</body></html>';
      let attemptCount = 0;

      mockedFetch.mockImplementation(async () => {
        attemptCount++;
        if (attemptCount === 1) {
          const error = new Error('getaddrinfo ENOTFOUND example.com');
          (error as { code?: string }).code = 'ENOTFOUND';
          throw error;
        }
        return {
          ok: true,
          headers: {
            get: (key: string) => {
              if (key === 'content-type') return 'text/html';
              if (key === 'content-length')
                return htmlContent.length.toString();
              return null;
            },
          },
          arrayBuffer: () => Promise.resolve(Buffer.from(htmlContent)),
        };
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(mockedFetch).toHaveBeenCalledTimes(2);
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Success after retry');
    });

    it('does not retry non-retryable 4xx', async () => {
      const params: DirectWebFetchToolParams = {
        url: 'https://example.com',
        format: 'text',
      };
      const invocation = tool.build(params);

      mockedFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: {
          get: () => null,
        },
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(mockedFetch).toHaveBeenCalledTimes(1);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('400');
    });

    it('retries retryable 5xx when status is preserved', async () => {
      const params: DirectWebFetchToolParams = {
        url: 'https://example.com',
        format: 'text',
      };
      const invocation = tool.build(params);

      const htmlContent = '<html><body>Success after 503</body></html>';
      let attemptCount = 0;

      mockedFetch.mockImplementation(async () => {
        attemptCount++;
        if (attemptCount === 1) {
          return {
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
            headers: {
              get: () => null,
            },
          };
        }
        return {
          ok: true,
          headers: {
            get: (key: string) => {
              if (key === 'content-type') return 'text/html';
              if (key === 'content-length')
                return htmlContent.length.toString();
              return null;
            },
          },
          arrayBuffer: () => Promise.resolve(Buffer.from(htmlContent)),
        };
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(mockedFetch).toHaveBeenCalledTimes(2);
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Success after 503');
    });

    it('pre-aborted signal returns ToolResult.error and does not call fetch', async () => {
      const params: DirectWebFetchToolParams = {
        url: 'https://example.com',
        format: 'text',
      };
      const invocation = tool.build(params);

      const abortController = new AbortController();
      abortController.abort();

      const result = await invocation.execute(abortController.signal);

      expect(mockedFetch).not.toHaveBeenCalled();
      expect(result.error).toBeDefined();
      expect(result.error?.message).toMatch(/abort|cancel/i);
    });

    it('timeout abort returns ToolResult.error and cancels retries', async () => {
      const params: DirectWebFetchToolParams = {
        url: 'https://example.com',
        format: 'text',
        timeout: 1, // 1 second timeout
      };
      const invocation = tool.build(params);

      // Mock fetch that respects abort signal (like real node-fetch)
      mockedFetch.mockImplementation(
        (_url: string, opts?: { signal?: AbortSignal }) =>
          new Promise((resolve, reject) => {
            const signal = opts?.signal;
            if (signal?.aborted) {
              reject(
                new DOMException('The operation was aborted', 'AbortError'),
              );
              return;
            }
            const timer = setTimeout(() => {
              resolve({
                ok: true,
                headers: { get: () => null },
                arrayBuffer: () => Promise.resolve(Buffer.from('data')),
              });
            }, 5000);
            signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(
                new DOMException('The operation was aborted', 'AbortError'),
              );
            });
          }),
      );

      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toMatch(/abort|timeout/i);
      expect(mockedFetch.mock.calls.length).toBeGreaterThan(0);
      expect(mockedFetch.mock.calls.length).toBeLessThan(10);
    });
  });
});
