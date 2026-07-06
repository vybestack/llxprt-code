/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gemini boundary conversion helpers. This file lives inside the code_assist
 * enclave, so importing @google/genai is permitted. It converts between the
 * neutral llm-types request/response shapes and the Google SDK shapes so that
 * the neutral ContentGenerator interface can be implemented without leaking
 * Google types to callers.
 */

import {
  type GenerateContentParameters,
  type GenerateContentConfig,
  type CountTokensParameters,
  type CountTokensResponse,
  type EmbedContentResponse,
  type GenerateContentResponse,
  type Candidate,
  type Part,
  type Tool,
  type ToolConfig,
  type FunctionCallingConfig,
  type Content,
  FunctionCallingConfigMode,
} from '@google/genai';
import type { ModelGenerationRequest } from '../llm-types/modelRequest.js';
import type {
  ToolDeclaration,
  ToolChoice,
} from '../llm-types/toolDeclaration.js';
import type { ModelOutput } from '../llm-types/modelEnvelope.js';
import type {
  CountTokensRequest,
  CountTokensResult,
  EmbedContentResult,
} from '../llm-types/tokensAndEmbeddings.js';
import { mapGeminiFinishReason } from '../llm-types/finishReasons.js';
import type { UsageStats, ContentBlock } from '../services/history/IContent.js';
import { ContentConverters } from '../services/history/ContentConverters.js';

/**
 * Convert a neutral ToolChoice into the Gemini ToolConfig shape.
 *
 * Gemini has no explicit "required" concept — it uses mode ANY to force a call.
 * allowedToolNames maps to allowedFunctionNames.
 */
function toGeminiToolConfig(choice: ToolChoice): ToolConfig {
  let mode: FunctionCallingConfigMode;
  if (choice.mode === 'none') {
    mode = FunctionCallingConfigMode.NONE;
  } else if (choice.mode === 'required') {
    mode = FunctionCallingConfigMode.ANY;
  } else {
    mode = FunctionCallingConfigMode.AUTO;
  }
  const config: FunctionCallingConfig = { mode };
  if (choice.allowedToolNames && choice.allowedToolNames.length > 0) {
    config.allowedFunctionNames = choice.allowedToolNames;
  }
  return { functionCallingConfig: config };
}

/**
 * Convert neutral ToolDeclaration[] to Gemini tools shape.
 */
function toGeminiTools(tools: ToolDeclaration[]): Tool[] {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        ...(t.description !== undefined ? { description: t.description } : {}),
        parametersJsonSchema: t.parametersJsonSchema,
      })),
    },
  ];
}

/**
 * Convert a neutral ModelGenerationRequest to Google GenerateContentParameters.
 *
 * Settings are mapped first; modelParams is spread LAST so explicit provider
 * extras win over the neutral settings mapping.
 */
export function toGenerateContentParameters(
  request: ModelGenerationRequest,
): GenerateContentParameters {
  const contents: Content[] = ContentConverters.toGeminiContents(
    request.contents,
  );

  const config: GenerateContentConfig = {};

  const settings = request.settings;
  if (settings) {
    if (settings.temperature !== undefined) {
      config.temperature = settings.temperature;
    }
    if (settings.maxOutputTokens !== undefined) {
      config.maxOutputTokens = settings.maxOutputTokens;
    }
    if (settings.topP !== undefined) {
      config.topP = settings.topP;
    }
    if (settings.systemInstruction !== undefined) {
      config.systemInstruction = settings.systemInstruction;
    }
    if (settings.responseJsonSchema !== undefined) {
      config.responseJsonSchema = settings.responseJsonSchema;
    }
    if (settings.toolChoice !== undefined) {
      config.toolConfig = toGeminiToolConfig(settings.toolChoice);
    }
  }

  if (request.tools && request.tools.length > 0) {
    config.tools = toGeminiTools(request.tools);
  }

  if (request.abortSignal !== undefined) {
    config.abortSignal = request.abortSignal;
  }

  // modelParams spread LAST so explicit provider params win.
  if (request.modelParams) {
    Object.assign(config, request.modelParams);
  }

  const params: GenerateContentParameters = {
    model: request.model ?? '',
    contents: contents as never,
    config,
  };

  return params;
}

/**
 * Convert a Google GenerateContentResponse to a neutral ModelOutput.
 */
export function fromGenerateContentResponse(
  response: GenerateContentResponse,
): ModelOutput {
  const candidate: Candidate | undefined = response.candidates?.[0];

  let blocks: ContentBlock[] = [];
  if (candidate?.content) {
    const icontent = ContentConverters.toIContent(candidate.content);
    blocks = icontent.blocks;
  }

  const output: ModelOutput = {
    content: { speaker: 'ai', blocks },
  };

  const rawFinishReason = candidate?.finishReason;
  if (rawFinishReason !== undefined) {
    const finish = mapGeminiFinishReason(String(rawFinishReason));
    output.finishReason = finish.finishReason;
    output.rawStopReason = finish.rawStopReason;
  }

  const usageMeta = response.usageMetadata as
    | {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
        cachedContentTokenCount?: number;
        thoughtsTokenCount?: number;
      }
    | undefined;

  if (usageMeta) {
    const usage: UsageStats = {
      promptTokens: usageMeta.promptTokenCount ?? 0,
      completionTokens: usageMeta.candidatesTokenCount ?? 0,
      totalTokens: usageMeta.totalTokenCount ?? 0,
    };
    if (usageMeta.cachedContentTokenCount !== undefined) {
      usage.cachedTokens = usageMeta.cachedContentTokenCount;
    }
    if (usageMeta.thoughtsTokenCount !== undefined) {
      usage.reasoningTokens = usageMeta.thoughtsTokenCount;
    }
    output.usage = usage;
  }

  if (response.responseId) {
    output.responseId = response.responseId;
  }

  const providerMetadata: Record<string, unknown> = {};
  if (response.promptFeedback) {
    providerMetadata['gemini.promptFeedback'] = response.promptFeedback;
  }
  if (candidate) {
    const candidateObj = candidate as Record<string, unknown>;
    if (candidateObj.safetyRatings !== undefined) {
      providerMetadata['gemini.safetyRatings'] = candidateObj.safetyRatings;
    }
    if (candidateObj.groundingMetadata !== undefined) {
      providerMetadata['gemini.groundingMetadata'] =
        candidateObj.groundingMetadata;
    }
  }
  if (Object.keys(providerMetadata).length > 0) {
    output.providerMetadata = providerMetadata;
  }

  return output;
}

/**
 * Convert a neutral CountTokensRequest to Google CountTokensParameters.
 * model is optional since the neutral type does not carry it.
 */
export function toCountTokensParameters(
  request: CountTokensRequest,
  model?: string,
): CountTokensParameters {
  const contents: Content[] = ContentConverters.toGeminiContents(
    request.contents,
  );
  return {
    model: model ?? '',
    contents: contents as never,
  };
}

/**
 * Convert a Google CountTokensResponse to neutral CountTokensResult.
 */
export function fromCountTokensResponse(
  response: CountTokensResponse,
): CountTokensResult {
  return {
    totalTokens: response.totalTokens ?? 0,
  };
}

/**
 * Convert a Google EmbedContentResponse to neutral EmbedContentResult.
 */
export function fromEmbedContentResponse(
  response: EmbedContentResponse,
): EmbedContentResult {
  const embeddings = (response.embeddings ?? []).map(
    (emb: { values?: number[] }) => emb.values ?? [],
  );
  return { embeddings };
}

/**
 * Stream wrapper: maps each Google response chunk through
 * fromGenerateContentResponse to produce neutral ModelStreamChunk values.
 */
export async function* mapGeminiStreamToChunks(
  stream: AsyncIterable<GenerateContentResponse>,
): AsyncGenerator<ReturnType<typeof fromGenerateContentResponse>> {
  for await (const chunk of stream) {
    yield fromGenerateContentResponse(chunk);
  }
}

/**
 * Helper to extract the raw parts array from a candidate for testing/diagnostics.
 */
export function extractPartsFromCandidate(
  candidate: Candidate | undefined,
): Part[] {
  return candidate?.content?.parts ?? [];
}
