/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import * as dumpSDKContextModule from '../utils/dumpSDKContext.js';
import * as geminiGenerationExecutionModule from './geminiGenerationExecution.js';
import type { GeminiGenerationSetup } from './geminiGenerationSetup.js';
import type { ReasoningConfig } from './geminiReasoningConfig.js';

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
      { 'x-goog-api-key': 'gk-secret' },
    );

    expect(callOrder).toStrictEqual(['requestDump', 'apiCall']);
    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    expect(dumpSDKRequestContextSpy).toHaveBeenCalledWith(
      'gemini',
      '/v1/models/generateContent',
      apiRequest,
      'https://generativelanguage.googleapis.com',
      {
        headers: { 'x-goog-api-key': 'gk-secret' },
        transport: { type: 'http' },
      },
    );
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

  it('should keep a caller-supplied x-goog-api-key header over the synthesized one (issue #3159)', async () => {
    const { GeminiProvider } = await import('./GeminiProvider.js');
    const provider = new GeminiProvider('test-api-key');

    expect(
      provider['withApiKeyHeader'](
        { 'x-goog-api-key': 'caller-key' },
        'gemini-api-key',
        'gk-secret',
      ),
    ).toStrictEqual({ 'x-goog-api-key': 'caller-key' });
    // Header names are case-insensitive: a caller-supplied variant spelling
    // must also suppress the synthesized lowercase entry.
    expect(
      provider['withApiKeyHeader'](
        { 'X-Goog-Api-Key': 'caller-key' },
        'gemini-api-key',
        'gk-secret',
      ),
    ).toStrictEqual({ 'X-Goog-Api-Key': 'caller-key' });
    expect(
      provider['withApiKeyHeader']({}, 'gemini-api-key', 'gk-secret'),
    ).toStrictEqual({ 'x-goog-api-key': 'gk-secret' });
    expect(
      provider['withApiKeyHeader']({ other: 'header' }, 'vertex-ai', 'tok'),
    ).toStrictEqual({ other: 'header' });
  });

  it('should thread the synthesized API-key header through executeGeneration into the generation call (issue #3159)', async () => {
    const generationSpy = vi
      .spyOn(geminiGenerationExecutionModule, 'executeNonOAuthGeneration')
      .mockResolvedValue({ stream: null, emitted: false });
    const { createProviderCallOptions } = await import(
      '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js'
    );
    const { GeminiProvider } = await import('./GeminiProvider.js');
    const provider = new GeminiProvider('test-api-key');

    const reasoningConfig: ReasoningConfig = {
      enabled: undefined,
      includeInResponse: false,
      stripFromContext: 'all',
      effort: undefined,
      maxTokens: undefined,
      effortWireFormat: 'none',
      enabledWireFormat: 'none',
      effortMap: undefined,
      enabledMap: undefined,
    };
    const setup: GeminiGenerationSetup = {
      authMode: 'gemini-api-key',
      authToken: 'gk-secret',
      currentModel: 'gemini-2.5-pro',
      contentsWithSignatures: [],
      requestConfig: {},
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      httpOptions: { headers: {} },
      mapResponseToChunks: () => [],
      reasoningConfig,
      toolNamesForPrompt: undefined,
      shouldDumpSuccess: true,
      shouldDumpError: true,
    };

    await provider['executeGeneration'](
      createProviderCallOptions({ providerName: 'gemini', contents: [] }),
      setup,
      false,
    );

    expect(generationSpy).toHaveBeenCalledOnce();
    // headers is the trailing parameter of executeNonOAuthGeneration
    const args = generationSpy.mock.calls[0];
    expect(args.at(-1)).toStrictEqual({
      'x-goog-api-key': 'gk-secret',
    });
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

    expect(dumpSDKResponseContextSpy).toHaveBeenCalledTimes(1);
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledWith(
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
    await expect(
      (async () => {
        for await (const chunk of result.stream as AsyncIterable<unknown>) {
          received.push(chunk);
        }
      })(),
    ).rejects.toThrow('Stream interrupted');

    // All chunks yielded before the error should pass through
    expect(received).toStrictEqual(chunks);
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledTimes(1);
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledWith(
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
    await expect(
      (async () => {
        for await (const chunk of result.stream as AsyncIterable<unknown>) {
          received.push(chunk);
        }
      })(),
    ).rejects.toThrow('Gemini stream failed');

    expect(received).toStrictEqual(chunks);
    expect(dumpSDKRequestContextSpy).toHaveBeenCalledOnce();
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledTimes(1);
    expect(dumpSDKResponseContextSpy).toHaveBeenCalledWith(
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
