/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
import { mergeSystemInstruction } from '../utils/systemInstructionMerge.js';

/** Result of a generation execution path. */
export interface GeminiGenerationResult {
  stream: AsyncIterable<GenerateContentResponse> | null;
  emitted: boolean;
  chunks?: IContent[];
}

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

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
  const coreSystemInstruction = await buildSystemInstruction(
    options,
    globalConfig,
    toolNamesForPrompt,
    currentModel,
  );
  // Issue #2410: Merge caller-supplied system instruction (e.g. subagent
  // persona) with the core system prompt so task directives reach the model.
  const systemInstruction = mergeSystemInstruction(
    coreSystemInstruction,
    options.systemInstruction,
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
