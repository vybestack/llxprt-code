/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as dumpSDKContextModule from '../utils/dumpSDKContext.js';

describe('Gemini non-OAuth non-streaming generate separate dump', () => {
  let dumpSDKRequestContextSpy: ReturnType<typeof vi.spyOn>;
  let dumpSDKResponseContextSpy: ReturnType<typeof vi.spyOn>;
  let dumpSDKContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dumpSDKRequestContextSpy = vi.spyOn(
      dumpSDKContextModule,
      'dumpSDKRequestContext',
    );
    dumpSDKRequestContextSpy.mockResolvedValue({
      baseId: '20260101-120000-gemini-test12',
      requestFilename: '20260101-120000-gemini-test12-request.json',
      dumpDir: '/tmp/.llxprt/dumps',
    });

    dumpSDKResponseContextSpy = vi.spyOn(
      dumpSDKContextModule,
      'dumpSDKResponseContext',
    );
    dumpSDKResponseContextSpy.mockResolvedValue(
      '20260101-120000-gemini-test12-response.json',
    );

    dumpSDKContextSpy = vi.spyOn(dumpSDKContextModule, 'dumpSDKContext');
    dumpSDKContextSpy.mockResolvedValue('legacy-dump.json');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call dumpSDKRequestContext before SDK call and dumpSDKResponseContext after for on mode', async () => {
    const callOrder: string[] = [];

    dumpSDKRequestContextSpy.mockImplementation(async () => {
      callOrder.push('requestDump');
      return {
        baseId: '20260101-120000-gemini-test12',
        requestFilename: '20260101-120000-gemini-test12-request.json',
        dumpDir: '/tmp/.llxprt/dumps',
      };
    });

    const mockResponse = {
      candidates: [{ content: { parts: [{ text: 'Hello' }] } }],
    };

    const mockContentGenerator = {
      generateContent: vi.fn().mockImplementation(async () => {
        callOrder.push('apiCall');
        return mockResponse;
      }),
    };

    const apiRequest = {
      model: 'gemini-2.5-pro',
      contents: [],
      config: {},
    };

    const mapResponseToChunks = vi
      .fn()
      .mockReturnValue([
        { speaker: 'ai', blocks: [{ type: 'text', text: 'Hello' }] },
      ]);

    const { GeminiProvider } = await import('./GeminiProvider.js');
    const provider = new GeminiProvider('test-api-key');

    const result = await provider['nonOAuthNonStreamingGenerate'](
      mockContentGenerator,
      apiRequest,
      true,
      false,
      undefined,
      mapResponseToChunks,
      true,
    );

    expect(callOrder).toStrictEqual(['requestDump', 'apiCall']);
    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledOnce();
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
    expect(result.chunks).toBeDefined();
    expect(result.chunks!.length).toBeGreaterThan(0);
  });

  it('should write separate related request and error response dumps in error mode', async () => {
    const mockContentGenerator = {
      generateContent: vi.fn().mockRejectedValue(new Error('API Error')),
    };

    const apiRequest = {
      model: 'gemini-2.5-pro',
      contents: [],
      config: {},
    };

    const mapResponseToChunks = vi.fn();

    const { GeminiProvider } = await import('./GeminiProvider.js');
    const provider = new GeminiProvider('test-api-key');

    await expect(
      provider['nonOAuthNonStreamingGenerate'](
        mockContentGenerator,
        apiRequest,
        false,
        true,
        undefined,
        mapResponseToChunks,
        true,
      ),
    ).rejects.toThrow('API Error');

    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledWith(
      '20260101-120000-gemini-test12',
      'gemini',
      { error: 'API Error' },
      true,
    );
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });

  it('should send API request when request dump fails', async () => {
    dumpSDKRequestContextSpy.mockRejectedValueOnce(new Error('disk full'));
    const mockResponse = {
      candidates: [{ content: { parts: [{ text: 'Hello' }] } }],
    };
    const mockContentGenerator = {
      generateContent: vi.fn().mockResolvedValue(mockResponse),
    };
    const mapResponseToChunks = vi
      .fn()
      .mockReturnValue([
        { speaker: 'ai', blocks: [{ type: 'text', text: 'Hello' }] },
      ]);
    const { GeminiProvider } = await import('./GeminiProvider.js');
    const provider = new GeminiProvider('test-api-key');

    await provider['nonOAuthNonStreamingGenerate'](
      mockContentGenerator,
      { model: 'gemini-2.5-pro', contents: [], config: {} },
      true,
      false,
      undefined,
      mapResponseToChunks,
      true,
    );

    expect(mockContentGenerator.generateContent).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).not.toHaveBeenCalled();
  });

  it('should link on-mode API errors to the pre-request dump without legacy dumpSDKContext', async () => {
    const callOrder: string[] = [];
    dumpSDKRequestContextSpy.mockImplementation(async () => {
      callOrder.push('requestDump');
      return {
        baseId: '20260101-120000-gemini-error',
        requestFilename: '20260101-120000-gemini-error-request.json',
        dumpDir: '/tmp/.llxprt/dumps',
      };
    });

    const mockContentGenerator = {
      generateContent: vi.fn().mockImplementation(async () => {
        callOrder.push('apiCall');
        throw new Error('API Error');
      }),
    };
    const mapResponseToChunks = vi.fn();
    const { GeminiProvider } = await import('./GeminiProvider.js');
    const provider = new GeminiProvider('test-api-key');

    await expect(
      provider['nonOAuthNonStreamingGenerate'](
        mockContentGenerator,
        { model: 'gemini-2.5-pro', contents: [], config: {} },
        true,
        true,
        undefined,
        mapResponseToChunks,
        true,
      ),
    ).rejects.toThrow('API Error');

    expect(callOrder).toStrictEqual(['requestDump', 'apiCall']);
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledWith(
      '20260101-120000-gemini-error',
      'gemini',
      { error: 'API Error' },
      true,
    );
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });
});

describe('Gemini non-OAuth streaming generate separate dump', () => {
  let dumpSDKRequestContextSpy: ReturnType<typeof vi.spyOn>;
  let dumpSDKResponseContextSpy: ReturnType<typeof vi.spyOn>;
  let dumpSDKContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dumpSDKRequestContextSpy = vi.spyOn(
      dumpSDKContextModule,
      'dumpSDKRequestContext',
    );
    dumpSDKRequestContextSpy.mockResolvedValue({
      baseId: '20260101-120000-gemini-test12',
      requestFilename: '20260101-120000-gemini-test12-request.json',
      dumpDir: '/tmp/.llxprt/dumps',
    });

    dumpSDKResponseContextSpy = vi.spyOn(
      dumpSDKContextModule,
      'dumpSDKResponseContext',
    );
    dumpSDKResponseContextSpy.mockResolvedValue(
      '20260101-120000-gemini-test12-response.json',
    );

    dumpSDKContextSpy = vi.spyOn(dumpSDKContextModule, 'dumpSDKContext');

    dumpSDKContextSpy.mockResolvedValue('legacy-dump.json');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should wrap stream to capture chunks and write response dump after stream completes', async () => {
    const chunks = [
      { candidates: [{ content: { parts: [{ text: 'Hello' }] } }] },
      { candidates: [{ content: { parts: [{ text: ' world' }] } }] },
    ];

    const mockStream = (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    })();

    const mockContentGenerator = {
      generateContentStream: vi.fn().mockResolvedValue(mockStream),
    };

    const apiRequest = {
      model: 'gemini-2.5-pro',
      contents: [],
      config: {},
    };

    const { GeminiProvider } = await import('./GeminiProvider.js');
    const provider = new GeminiProvider('test-api-key');

    const result = await provider['nonOAuthStreamingGenerate'](
      mockContentGenerator,
      apiRequest,
      true,
      false,
      undefined,
    );

    // Request dump should have been called before stream creation
    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();

    // Response dump should NOT have been called yet - stream hasn't been consumed
    // (wrapStreamWithDump defers the response dump until after stream completes)
    expect(dumpSDKResponseContextSpy).not.toHaveBeenCalled();

    // Consume the stream
    const received: unknown[] = [];
    for await (const chunk of result.stream as AsyncIterable<unknown>) {
      received.push(chunk);
    }

    // All chunks should pass through unchanged
    expect(received).toStrictEqual(chunks);

    expect(dumpSDKResponseContextSpy).toHaveBeenCalledExactlyOnceWith(
      '20260101-120000-gemini-test12',
      'gemini',
      { streaming: true, chunks, completed: true },
      false,
    );
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });

  it('should pass through chunks even when stream errors mid-iteration', async () => {
    const chunks = [
      { candidates: [{ content: { parts: [{ text: 'partial' }] } }] },
    ];

    const mockStream = (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
      throw new Error('Stream interrupted');
    })();

    const mockContentGenerator = {
      generateContentStream: vi.fn().mockResolvedValue(mockStream),
    };

    const apiRequest = {
      model: 'gemini-2.5-pro',
      contents: [],
      config: {},
    };

    const { GeminiProvider } = await import('./GeminiProvider.js');
    const provider = new GeminiProvider('test-api-key');

    const result = await provider['nonOAuthStreamingGenerate'](
      mockContentGenerator,
      apiRequest,
      true,
      false,
      undefined,
    );

    const received: unknown[] = [];
    await expect(async () => {
      for await (const chunk of result.stream as AsyncIterable<unknown>) {
        received.push(chunk);
      }
    }).rejects.toThrow('Stream interrupted');

    // All chunks yielded before the error should pass through
    expect(received).toStrictEqual(chunks);
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledExactlyOnceWith(
      '20260101-120000-gemini-test12',
      'gemini',
      {
        streaming: true,
        chunks,
        error: 'Error: Stream interrupted',
        completed: false,
      },
      true,
    );
  });

  it('should dump stream iteration errors in error mode after passing through chunks', async () => {
    const chunks = [
      { candidates: [{ content: { parts: [{ text: 'partial' }] } }] },
    ];
    const mockStream = (async function* () {
      yield chunks[0];
      throw new Error('Gemini stream failed');
    })();
    const mockContentGenerator = {
      generateContentStream: vi.fn().mockResolvedValue(mockStream),
    };
    const apiRequest = {
      model: 'gemini-2.5-pro',
      contents: [],
      config: {},
    };

    const { GeminiProvider } = await import('./GeminiProvider.js');
    const provider = new GeminiProvider('test-api-key');

    const result = await provider['nonOAuthStreamingGenerate'](
      mockContentGenerator,
      apiRequest,
      false,
      true,
      undefined,
    );

    const received: unknown[] = [];
    await expect(async () => {
      for await (const chunk of result.stream as AsyncIterable<unknown>) {
        received.push(chunk);
      }
    }).rejects.toThrow('Gemini stream failed');

    expect(received).toStrictEqual(chunks);
    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledExactlyOnceWith(
      '20260101-120000-gemini-test12',
      'gemini',
      {
        streaming: true,
        chunks,
        error: 'Error: Gemini stream failed',
        completed: false,
      },
      true,
    );
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });

  it('should write separate related dumps for error during stream creation in error mode', async () => {
    const mockContentGenerator = {
      generateContentStream: vi
        .fn()
        .mockRejectedValue(new Error('Connection error')),
    };

    const apiRequest = {
      model: 'gemini-2.5-pro',
      contents: [],
      config: {},
    };

    const { GeminiProvider } = await import('./GeminiProvider.js');
    const provider = new GeminiProvider('test-api-key');

    await expect(
      provider['nonOAuthStreamingGenerate'](
        mockContentGenerator,
        apiRequest,
        false,
        true,
        undefined,
      ),
    ).rejects.toThrow('Connection error');

    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledWith(
      '20260101-120000-gemini-test12',
      'gemini',
      { error: 'Connection error' },
      true,
    );
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });
});

describe('Gemini OAuth streaming generate separate dump', () => {
  let dumpSDKRequestContextSpy: ReturnType<typeof vi.spyOn>;
  let dumpSDKResponseContextSpy: ReturnType<typeof vi.spyOn>;
  let dumpSDKContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dumpSDKRequestContextSpy = vi.spyOn(
      dumpSDKContextModule,
      'dumpSDKRequestContext',
    );
    dumpSDKRequestContextSpy.mockResolvedValue({
      baseId: '20260101-120000-gemini-test12',
      requestFilename: '20260101-120000-gemini-test12-request.json',
      dumpDir: '/tmp/.llxprt/dumps',
    });

    dumpSDKResponseContextSpy = vi.spyOn(
      dumpSDKContextModule,
      'dumpSDKResponseContext',
    );
    dumpSDKResponseContextSpy.mockResolvedValue(
      '20260101-120000-gemini-test12-response.json',
    );

    dumpSDKContextSpy = vi.spyOn(dumpSDKContextModule, 'dumpSDKContext');
    dumpSDKContextSpy.mockResolvedValue('legacy-dump.json');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should wrap stream to capture chunks and write response dump after stream completes', async () => {
    const chunks = [
      { candidates: [{ content: { parts: [{ text: 'OAuth Hello' }] } }] },
      { candidates: [{ content: { parts: [{ text: ' world' }] } }] },
    ];

    const mockStream = (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    })();

    const mockGeneratorWithStream = {
      generateContentStream: vi.fn().mockResolvedValue(mockStream),
    };

    const oauthRequest = {
      model: 'gemini-2.5-pro',
      contents: [],
      config: {},
    };

    const { GeminiProvider } = await import('./GeminiProvider.js');
    const provider = new GeminiProvider('test-api-key');

    const result = await provider['oauthStreamingGenerate'](
      mockGeneratorWithStream,
      oauthRequest,
      'runtime-1',
      'session-1',
      true,
      true,
      false,
      undefined,
    );

    // Request dump should have been called before stream creation
    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();

    // Response dump should NOT have been called yet - stream hasn't been consumed
    expect(dumpSDKResponseContextSpy).not.toHaveBeenCalled();

    // Consume the stream
    const received: unknown[] = [];
    for await (const chunk of result.stream as AsyncIterable<unknown>) {
      received.push(chunk);
    }

    // All chunks should pass through unchanged
    expect(received).toStrictEqual(chunks);

    expect(dumpSDKResponseContextSpy).toHaveBeenCalledExactlyOnceWith(
      '20260101-120000-gemini-test12',
      'gemini',
      { streaming: true, chunks, completed: true },
      false,
    );
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });

  it('should write separate related dumps for OAuth error during stream creation in error mode', async () => {
    const mockGeneratorWithStream = {
      generateContentStream: vi
        .fn()
        .mockRejectedValue(new Error('OAuth error')),
    };

    const oauthRequest = {
      model: 'gemini-2.5-pro',
      contents: [],
      config: {},
    };

    const { GeminiProvider } = await import('./GeminiProvider.js');
    const provider = new GeminiProvider('test-api-key');

    await expect(
      provider['oauthStreamingGenerate'](
        mockGeneratorWithStream,
        oauthRequest,
        'runtime-1',
        'session-1',
        true,
        false,
        true,
        undefined,
      ),
    ).rejects.toThrow('OAuth error');

    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledWith(
      '20260101-120000-gemini-test12',
      'gemini',
      { error: 'OAuth error' },
      true,
    );
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });
});

describe('Gemini OAuth non-streaming generate separate dump', () => {
  let dumpSDKRequestContextSpy: ReturnType<typeof vi.spyOn>;
  let dumpSDKResponseContextSpy: ReturnType<typeof vi.spyOn>;
  let dumpSDKContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dumpSDKRequestContextSpy = vi.spyOn(
      dumpSDKContextModule,
      'dumpSDKRequestContext',
    );
    dumpSDKRequestContextSpy.mockResolvedValue({
      baseId: '20260101-120000-gemini-oauth',
      requestFilename: '20260101-120000-gemini-oauth-request.json',
      dumpDir: '/tmp/.llxprt/dumps',
    });

    dumpSDKResponseContextSpy = vi.spyOn(
      dumpSDKContextModule,
      'dumpSDKResponseContext',
    );
    dumpSDKResponseContextSpy.mockResolvedValue(
      '20260101-120000-gemini-oauth-response.json',
    );

    dumpSDKContextSpy = vi.spyOn(dumpSDKContextModule, 'dumpSDKContext');
    dumpSDKContextSpy.mockResolvedValue('legacy-dump.json');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should link on-mode API errors to the pre-request dump without legacy dumpSDKContext', async () => {
    const callOrder: string[] = [];
    dumpSDKRequestContextSpy.mockImplementation(async () => {
      callOrder.push('requestDump');
      return {
        baseId: '20260101-120000-gemini-oauth-error',
        requestFilename: '20260101-120000-gemini-oauth-error-request.json',
        dumpDir: '/tmp/.llxprt/dumps',
      };
    });

    const mockGeneratorWithStream = {
      generateContentStream: vi.fn(),
      generateContent: vi.fn().mockImplementation(async () => {
        callOrder.push('apiCall');
        throw new Error('OAuth API Error');
      }),
    };
    const mapResponseToChunks = vi.fn();
    const { GeminiProvider } = await import('./GeminiProvider.js');
    const provider = new GeminiProvider('test-api-key');

    await expect(
      provider['oauthNonStreamingGenerate'](
        mockGeneratorWithStream,
        { model: 'gemini-2.5-pro', contents: [], config: {} },
        'session-1',
        true,
        true,
        undefined,
        mapResponseToChunks,
        true,
      ),
    ).rejects.toThrow('OAuth API Error');

    expect(callOrder).toStrictEqual(['requestDump', 'apiCall']);
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledWith(
      '20260101-120000-gemini-oauth-error',
      'gemini',
      { error: 'OAuth API Error' },
      true,
    );
    expect(dumpSDKContextSpy).not.toHaveBeenCalled();
  });
});
