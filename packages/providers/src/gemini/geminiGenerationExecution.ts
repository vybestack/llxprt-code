/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import {
  type Part,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from '@google/genai';
import { type Config } from '@vybestack/llxprt-code-core/config/config.js';
import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { type NormalizedGenerateChatOptions } from '../BaseProvider.js';
import {
  bestEffortDump,
  dumpSDKErrorRequestResponse,
  dumpSDKRequestContext,
  dumpSDKResponseContext,
  wrapStreamWithDump,
  wrapStreamWithSDKErrorDump,
} from '../utils/dumpSDKContext.js';
import { type ResponseToChunksMapper } from './geminiResponseMapper.js';
import { buildSystemInstruction } from './geminiRequestBuilding.js';

/** Result of a generation execution path. */
export interface GeminiGenerationResult {
  stream: AsyncIterable<GenerateContentResponse> | null;
  emitted: boolean;
  chunks?: IContent[];
  preludeChunks?: IContent[];
}

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

/** Build the OAuth content generator via the code_assist dynamic import. */
export type OAuthContentGeneratorFactory = (
  httpOptions: Record<string, unknown>,
  config: Config,
  baseURL?: string,
) => Promise<{
  generateContentStream: (
    params: GenerateContentParameters,
    sessionId?: string,
  ) =>
    | AsyncIterable<GenerateContentResponse>
    | Promise<AsyncIterable<GenerateContentResponse>>;
  generateContent?: (
    params: GenerateContentParameters,
    sessionId?: string,
  ) => Promise<GenerateContentResponse>;
}>;

/** Create a minimal OAuth config when globalConfig is not set. */
export function createOAuthConfig(globalConfig: Config | undefined): Config {
  return (globalConfig ?? {
    getProxy: () => undefined,
    isBrowserLaunchSuppressed: () => false,
    getNoBrowser: () => false,
    getUserMemory: () => '',
  }) as Config;
}

interface OAuthRequestContext {
  oauthRequest: GenerateContentParameters & { systemInstruction: string };
  runtimeId: string;
  sessionId: string;
}

async function buildOAuthRequestContext(
  options: NormalizedGenerateChatOptions,
  globalConfig: Config | undefined,
  toolNamesForPrompt: string[] | undefined,
  currentModel: string,
  contentsWithSignatures: Array<{ role: string; parts: Part[] }>,
  requestConfig: Record<string, unknown>,
): Promise<OAuthRequestContext> {
  const systemInstruction = await buildSystemInstruction(
    options,
    globalConfig,
    toolNamesForPrompt,
    currentModel,
  );
  const runtimeId = options.runtime?.runtimeId ?? 'default';
  return {
    oauthRequest: {
      model: currentModel,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `<system>\n${systemInstruction}\n</system>\n\nUser provided conversation begins here:`,
            },
          ],
        },
        ...contentsWithSignatures,
      ],
      systemInstruction,
      config: { ...requestConfig },
    },
    runtimeId,
    sessionId: `oauth-session:${runtimeId}:${randomUUID()}`,
  };
}

function buildOAuthStreamingPrelude(
  runtimeId: string,
  sessionId: string,
): IContent[] {
  return [
    {
      speaker: 'ai',
      blocks: [],
      metadata: {
        session: sessionId,
        runtime: runtimeId,
        authMode: 'oauth',
      },
    } as IContent,
  ];
}

async function dumpError(
  shouldDumpError: boolean,
  requestBaseId: string | undefined,
  endpoint: string,
  request: GenerateContentParameters,
  baseURL: string,
  error: unknown,
): Promise<void> {
  if (!shouldDumpError) {
    return;
  }
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (requestBaseId) {
    await bestEffortDump('error-response', 'gemini', () =>
      dumpSDKResponseContext(
        requestBaseId,
        'gemini',
        { error: errorMessage },
        true,
      ),
    );
    return;
  }
  await dumpSDKErrorRequestResponse(
    'gemini',
    endpoint,
    request,
    { error: errorMessage },
    baseURL,
    dumpSDKRequestContext,
    dumpSDKResponseContext,
  );
}

/**
 * Execute OAuth generation path. Returns stream + emitted, or yielded chunks
 * if non-streaming completed.
 */
export async function executeOAuthGeneration(
  options: NormalizedGenerateChatOptions,
  globalConfig: Config | undefined,
  httpOptions: Record<string, unknown>,
  contentsWithSignatures: Array<{ role: string; parts: Part[] }>,
  requestConfig: Record<string, unknown>,
  currentModel: string,
  toolNamesForPrompt: string[] | undefined,
  streamingEnabled: boolean,
  shouldDumpSuccess: boolean,
  shouldDumpError: boolean,
  baseURL: string | undefined,
  mapResponseToChunks: ResponseToChunksMapper,
  reasoningIncludeInResponse: boolean,
  oauthContentGeneratorFactory: OAuthContentGeneratorFactory,
): Promise<GeminiGenerationResult> {
  const contentGenerator = await oauthContentGeneratorFactory(
    httpOptions,
    createOAuthConfig(globalConfig),
    undefined,
  );
  const { oauthRequest, runtimeId, sessionId } = await buildOAuthRequestContext(
    options,
    globalConfig,
    toolNamesForPrompt,
    currentModel,
    contentsWithSignatures,
    requestConfig,
  );

  if (!streamingEnabled && contentGenerator.generateContent) {
    return oauthNonStreamingGenerate(
      contentGenerator,
      oauthRequest,
      sessionId,
      shouldDumpSuccess,
      shouldDumpError,
      baseURL,
      mapResponseToChunks,
      reasoningIncludeInResponse,
    );
  }
  return oauthStreamingGenerate(
    contentGenerator,
    oauthRequest,
    runtimeId,
    sessionId,
    streamingEnabled,
    shouldDumpSuccess,
    shouldDumpError,
    baseURL,
  );
}

export async function oauthNonStreamingGenerate(
  generator: {
    generateContent?: (
      params: GenerateContentParameters,
      sessionId?: string,
    ) => Promise<GenerateContentResponse>;
  },
  oauthRequest: GenerateContentParameters,
  sessionId: string,
  shouldDumpSuccess: boolean,
  shouldDumpError: boolean,
  baseURL: string | undefined,
  mapResponseToChunks: ResponseToChunksMapper,
  reasoningIncludeInResponse: boolean,
): Promise<GeminiGenerationResult> {
  const resolvedBase = baseURL ?? DEFAULT_BASE_URL;
  let requestBaseId: string | undefined;

  if (shouldDumpSuccess) {
    const reqResult = await bestEffortDump('request', 'gemini', () =>
      dumpSDKRequestContext(
        'gemini',
        '/v1/models/generateContent',
        oauthRequest,
        resolvedBase,
      ),
    );
    requestBaseId = reqResult?.baseId;
  }

  const generateContent = generator.generateContent;
  if (generateContent === undefined) {
    throw new Error(
      'OAuth content generator does not support non-streaming generation',
    );
  }

  try {
    const response = await generateContent(oauthRequest, sessionId);
    if (shouldDumpSuccess && requestBaseId) {
      await bestEffortDump('response', 'gemini', () =>
        dumpSDKResponseContext(requestBaseId, 'gemini', response, false),
      );
    }
    return {
      stream: null,
      emitted: false,
      chunks: mapResponseToChunks(response, reasoningIncludeInResponse),
    };
  } catch (error) {
    await dumpError(
      shouldDumpError,
      requestBaseId,
      '/v1/models/generateContent',
      oauthRequest,
      resolvedBase,
      error,
    );
    throw error;
  }
}

export async function oauthStreamingGenerate(
  generator: {
    generateContentStream: (
      params: GenerateContentParameters,
      sessionId?: string,
    ) =>
      | AsyncIterable<GenerateContentResponse>
      | Promise<AsyncIterable<GenerateContentResponse>>;
  },
  oauthRequest: GenerateContentParameters,
  runtimeId: string,
  sessionId: string,
  streamingEnabled: boolean,
  shouldDumpSuccess: boolean,
  shouldDumpError: boolean,
  baseURL: string | undefined,
): Promise<GeminiGenerationResult> {
  const resolvedBase = baseURL ?? DEFAULT_BASE_URL;
  let requestBaseId: string | undefined;

  if (shouldDumpSuccess) {
    const reqResult = await bestEffortDump('request', 'gemini', () =>
      dumpSDKRequestContext(
        'gemini',
        '/v1/models/streamGenerateContent',
        oauthRequest,
        resolvedBase,
      ),
    );
    requestBaseId = reqResult?.baseId;
  }

  try {
    const oauthStream = await Promise.resolve(
      generator.generateContentStream(oauthRequest, sessionId),
    );
    const streamForReturn = wrapGeminiStreamForDump(
      oauthStream,
      oauthRequest,
      shouldDumpSuccess,
      shouldDumpError,
      requestBaseId,
      resolvedBase,
    );
    if (streamingEnabled) {
      return {
        stream: streamForReturn,
        emitted: true,
        preludeChunks: buildOAuthStreamingPrelude(runtimeId, sessionId),
      };
    }
    return { stream: streamForReturn, emitted: false };
  } catch (error) {
    await dumpError(
      shouldDumpError,
      requestBaseId,
      '/v1/models/streamGenerateContent',
      oauthRequest,
      resolvedBase,
      error,
    );
    throw error;
  }
}

function wrapGeminiStreamForDump(
  stream: AsyncIterable<GenerateContentResponse>,
  request: GenerateContentParameters,
  shouldDumpSuccess: boolean,
  shouldDumpError: boolean,
  requestBaseId: string | undefined,
  baseURL: string,
): AsyncIterable<GenerateContentResponse> {
  if (shouldDumpSuccess && requestBaseId) {
    return wrapStreamWithDump(
      stream,
      requestBaseId,
      'gemini',
      dumpSDKResponseContext,
    );
  }
  if (shouldDumpError) {
    return wrapStreamWithSDKErrorDump(
      stream,
      'gemini',
      '/v1/models/streamGenerateContent',
      request,
      baseURL,
      dumpSDKRequestContext,
      dumpSDKResponseContext,
    );
  }
  return stream;
}

/** Interface for the non-OAuth content generator (GoogleGenAI models). */
export interface NonOAuthContentGenerator {
  generateContent: (
    params: GenerateContentParameters,
  ) => Promise<GenerateContentResponse>;
  generateContentStream: (
    params: GenerateContentParameters,
  ) => Promise<AsyncIterable<GenerateContentResponse>>;
}

/**
 * Execute non-OAuth (API key / Vertex AI) generation path.
 */
export async function executeNonOAuthGeneration(
  options: NormalizedGenerateChatOptions,
  globalConfig: Config | undefined,
  contentsWithSignatures: Array<{ role: string; parts: Part[] }>,
  requestConfig: Record<string, unknown>,
  currentModel: string,
  toolNamesForPrompt: string[] | undefined,
  streamingEnabled: boolean,
  shouldDumpSuccess: boolean,
  shouldDumpError: boolean,
  mapResponseToChunks: ResponseToChunksMapper,
  reasoningIncludeInResponse: boolean,
  createContentGenerator: () => Promise<NonOAuthContentGenerator>,
  baseURL: string | undefined,
): Promise<GeminiGenerationResult> {
  const contentGenerator = await createContentGenerator();
  const systemInstruction = await buildSystemInstruction(
    options,
    globalConfig,
    toolNamesForPrompt,
    currentModel,
  );
  const apiRequest: GenerateContentParameters & { systemInstruction: string } =
    {
      model: currentModel,
      contents: contentsWithSignatures,
      systemInstruction,
      config: { ...requestConfig },
    };

  if (streamingEnabled) {
    return nonOAuthStreamingGenerate(
      contentGenerator,
      apiRequest,
      shouldDumpSuccess,
      shouldDumpError,
      baseURL,
      mapResponseToChunks,
      reasoningIncludeInResponse,
    );
  }
  return nonOAuthNonStreamingGenerate(
    contentGenerator,
    apiRequest,
    shouldDumpSuccess,
    shouldDumpError,
    baseURL,
    mapResponseToChunks,
    reasoningIncludeInResponse,
  );
}

export async function nonOAuthNonStreamingGenerate(
  contentGenerator: NonOAuthContentGenerator,
  apiRequest: GenerateContentParameters,
  shouldDumpSuccess: boolean,
  shouldDumpError: boolean,
  baseURL: string | undefined,
  mapResponseToChunks: ResponseToChunksMapper,
  reasoningIncludeInResponse: boolean,
): Promise<GeminiGenerationResult> {
  let requestBaseId: string | undefined;

  if (shouldDumpSuccess) {
    const reqResult = await bestEffortDump('request', 'gemini', () =>
      dumpSDKRequestContext(
        'gemini',
        '/v1/models/generateContent',
        apiRequest,
        baseURL ?? DEFAULT_BASE_URL,
      ),
    );
    requestBaseId = reqResult?.baseId;
  }

  try {
    const response = await contentGenerator.generateContent(apiRequest);
    if (shouldDumpSuccess && requestBaseId) {
      await bestEffortDump('response', 'gemini', () =>
        dumpSDKResponseContext(requestBaseId, 'gemini', response, false),
      );
    }
    return {
      stream: null,
      emitted: false,
      chunks: mapResponseToChunks(response, reasoningIncludeInResponse),
    };
  } catch (error) {
    await dumpError(
      shouldDumpError,
      requestBaseId,
      '/v1/models/generateContent',
      apiRequest,
      baseURL ?? DEFAULT_BASE_URL,
      error,
    );
    throw error;
  }
}

export async function nonOAuthStreamingGenerate(
  contentGenerator: NonOAuthContentGenerator,
  apiRequest: GenerateContentParameters,
  shouldDumpSuccess: boolean,
  shouldDumpError: boolean,
  baseURL: string | undefined,
  _mapResponseToChunks: ResponseToChunksMapper,
  _reasoningIncludeInResponse: boolean,
): Promise<GeminiGenerationResult> {
  let requestBaseId: string | undefined;

  if (shouldDumpSuccess) {
    const reqResult = await bestEffortDump('request', 'gemini', () =>
      dumpSDKRequestContext(
        'gemini',
        '/v1/models/streamGenerateContent',
        apiRequest,
        baseURL ?? DEFAULT_BASE_URL,
      ),
    );
    requestBaseId = reqResult?.baseId;
  }

  try {
    const stream = await contentGenerator.generateContentStream(apiRequest);
    const streamForReturn = wrapGeminiStreamForDump(
      stream,
      apiRequest,
      shouldDumpSuccess,
      shouldDumpError,
      requestBaseId,
      baseURL ?? DEFAULT_BASE_URL,
    );
    return { stream: streamForReturn, emitted: false };
  } catch (error) {
    await dumpError(
      shouldDumpError,
      requestBaseId,
      '/v1/models/streamGenerateContent',
      apiRequest,
      baseURL ?? DEFAULT_BASE_URL,
      error,
    );
    throw error;
  }
}

async function* yieldGeminiMappedChunks(
  stream: AsyncIterable<GenerateContentResponse>,
  mapResponseToChunks: ResponseToChunksMapper,
  reasoningIncludeInResponse: boolean,
): AsyncIterableIterator<IContent> {
  for await (const response of stream) {
    const mapped = mapResponseToChunks(response, reasoningIncludeInResponse);
    for (const chunk of mapped) {
      yield chunk;
    }
  }
}

/**
 * Consume a stream and yield mapped chunks.
 */
export async function* consumeGeminiStream(
  stream: AsyncIterable<GenerateContentResponse> | null,
  mapResponseToChunks: ResponseToChunksMapper,
  reasoningIncludeInResponse: boolean,
  emitted: boolean,
): AsyncIterableIterator<IContent> {
  let hasEmitted = emitted;
  if (stream !== null) {
    for await (const chunk of yieldGeminiMappedChunks(
      stream,
      mapResponseToChunks,
      reasoningIncludeInResponse,
    )) {
      hasEmitted = true;
      yield chunk;
    }
  }
  if (!hasEmitted) {
    yield { speaker: 'ai', blocks: [] } as IContent;
  }
}
