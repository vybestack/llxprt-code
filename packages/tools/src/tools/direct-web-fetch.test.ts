/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { Readable } from 'node:stream';
import type { DirectWebFetchToolParams } from './direct-web-fetch.js';
import { DirectWebFetchTool } from './direct-web-fetch.js';
import { ToolErrorType } from '../types/tool-error.js';
import type { IToolHost, ToolResult as _ToolResult } from '../index.js';

const { mockedFetch } = { mockedFetch: vi.fn() };
void vi.mock('node-fetch', () => ({
  default: mockedFetch,
}));

function mockBody(text: string): Readable {
  return Readable.from([Buffer.from(text)]);
}

describe('DirectWebFetchTool', () => {
  let config: IToolHost;
  let tool: DirectWebFetchTool;

  beforeEach(() => {
    config = {
      getTargetDir: () => '/mock/target/dir',
      getWorkspaceRoots: () => ['/mock/target/dir'],
      getApprovalMode: () => 'auto',
      setApprovalMode: () => {},
      isInteractive: () => false,
      hasFeatureFlag: () => false,
      getFileService: () => ({
        shouldGitIgnoreFile: () => false,
        shouldLlxprtIgnoreFile: () => false,
        shouldIgnoreFile: () => false,
        filterFiles: (paths: string[]) => paths,
      }),
      getFileFilteringOptions: () => ({
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
      getFileExclusions: () => [],
      getReadManyFilesExclusions: () => [],
      getFileFilteringRespectLlxprtIgnore: () => true,
      getLlxprtIgnoreFilePath: () => null,
      recordFileRead: () => {},
      getLlxprtIgnorePatterns: () => [],
      getEphemeralSettings: () => ({}),
      getDebugMode: () => false,
    };
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
      body: mockBody(htmlContent),
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
      body: mockBody(htmlContent),
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
    expect(result.error?.message).toMatch(/exceeds/i);
  });

  it('returns FETCH_ERROR when the body exceeds the size limit and does not retry body acquisition', async () => {
    const params: DirectWebFetchToolParams = {
      url: 'https://example.com/overflow',
      format: 'text',
    };
    const invocation = tool.build(params);

    const overflowBody = mockBody('x'.repeat(100));
    mockedFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: (key: string) => {
          if (key === 'content-length') return '9999999';
          return null;
        },
      },
      body: overflowBody,
    });

    const result = await invocation.execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.FETCH_ERROR);
    expect(result.error?.message).toMatch(/exceeds/i);
    expect(overflowBody.destroyed).toBe(true);
    // Body overflow happens after a successful fetch — no retry is triggered.
    expect(mockedFetch).toHaveBeenCalledTimes(1);
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
          body: mockBody(htmlContent),
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
          body: mockBody(htmlContent),
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
            if (signal?.aborted === true) {
              reject(
                new DOMException('The operation was aborted', 'AbortError'),
              );
              return;
            }
            const timer = setTimeout(() => {
              resolve({
                ok: true,
                headers: { get: () => null },
                body: mockBody('data'),
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

  describe('non-success response body disposal', () => {
    it('destroys the 4xx response body without reading it', async () => {
      const params: DirectWebFetchToolParams = {
        url: 'https://example.com/notfound',
        format: 'text',
      };
      const invocation = tool.build(params);

      const errorBody = mockBody('404 Not Found Body');
      mockedFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: { get: () => null },
        body: errorBody,
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(mockedFetch).toHaveBeenCalledTimes(1);
      expect(result.error?.message).toContain('404');
      expect((errorBody as unknown as { destroyed: boolean }).destroyed).toBe(
        true,
      );
    });

    it('destroys the 5xx retryable body on each retry attempt', async () => {
      const params: DirectWebFetchToolParams = {
        url: 'https://example.com/server-error',
        format: 'text',
      };
      const invocation = tool.build(params);

      const firstErrorBody = mockBody('503 Error Body');
      const successBody = mockBody('<html><body>OK</body></html>');
      let attempt = 0;
      mockedFetch.mockImplementation(async () => {
        attempt++;
        if (attempt === 1) {
          return {
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
            headers: { get: () => null },
            body: firstErrorBody,
          };
        }
        return {
          ok: true,
          status: 200,
          headers: {
            get: (key: string) => (key === 'content-type' ? 'text/html' : null),
          },
          body: successBody,
        };
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(mockedFetch).toHaveBeenCalledTimes(2);
      expect(result.error).toBeUndefined();
      // The 503 error body must have been destroyed without being read.
      expect(
        (firstErrorBody as unknown as { destroyed: boolean }).destroyed,
      ).toBe(true);
    });

    it('destroys every 5xx body when all retries are exhausted', async () => {
      const params: DirectWebFetchToolParams = {
        url: 'https://example.com/always-500',
        format: 'text',
      };
      const invocation = tool.build(params);

      const bodies: Readable[] = [];
      mockedFetch.mockImplementation(async () => {
        const body = mockBody('500 Server Error');
        bodies.push(body);
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: { get: () => null },
          body,
        };
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(mockedFetch.mock.calls.length).toBeGreaterThan(1);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('500');
      // Every error response body must have been destroyed.
      for (const body of bodies) {
        expect((body as unknown as { destroyed: boolean }).destroyed).toBe(
          true,
        );
      }
    });
  });

  describe('observed-byte boundary (no Content-Length)', () => {
    const FETCH_BUDGET = 5 * 1024 * 1024; // 5 MiB

    /**
     * Generate a stream that emits exactly `totalBytes` of 0x78 ('x') in
     * 64 KiB chunks without materializing the entire buffer at once.
     */
    function sizedStream(totalBytes: number): Readable {
      const chunkSize = Math.min(64 * 1024, totalBytes);
      let sent = 0;
      return new Readable({
        read() {
          if (sent >= totalBytes) {
            this.push(null);
            return;
          }
          const remaining = totalBytes - sent;
          const size = Math.min(chunkSize, remaining);
          this.push(Buffer.alloc(size, 0x78));
          sent += size;
        },
      });
    }

    it('succeeds when observed bytes exactly equal the 5 MiB budget', async () => {
      const params: DirectWebFetchToolParams = {
        url: 'https://example.com/exact',
        format: 'text',
      };
      const invocation = tool.build(params);

      mockedFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        body: sizedStream(FETCH_BUDGET),
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      const content =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(content.length).toBe(FETCH_BUDGET);
    });

    it('fails without body-acquisition retry when observed bytes are 5 MiB + 1', async () => {
      const params: DirectWebFetchToolParams = {
        url: 'https://example.com/overflow',
        format: 'text',
      };
      const invocation = tool.build(params);

      mockedFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        body: sizedStream(FETCH_BUDGET + 1),
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(result.error?.type).toBe(ToolErrorType.FETCH_ERROR);
      expect(result.error?.message).toMatch(/exceeds/i);
      // Body overflow is detected during acquisition — no retry is triggered.
      expect(mockedFetch).toHaveBeenCalledTimes(1);
    });
  });
});
