/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FilePart,
  LanguageModelV4FunctionTool,
  LanguageModelV4Prompt,
  LanguageModelV4ProviderTool,
  LanguageModelV4ReasoningPart,
  LanguageModelV4TextPart,
  LanguageModelV4ToolCallPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';

/** Parts an assistant turn may carry in the shapes this provider emits. */
type AssistantPart =
  | LanguageModelV4TextPart
  | LanguageModelV4ReasoningPart
  | LanguageModelV4ToolCallPart;

/** Parts a user turn may carry. */
type UserPart = LanguageModelV4TextPart | LanguageModelV4FilePart;
import type {
  Content,
  GenerateContentParameters,
  GenerateContentResponse,
  GenerateContentResponseUsageMetadata,
  Part,
} from './geminiWireTypes.js';

/**
 * Translation between the Gemini generateContent wire format that this
 * provider builds and reads, and the AI SDK language-model interface that
 * carries it.
 *
 * The AI SDK owns transport, auth, base URL resolution and SSE parsing. Only
 * shape translation lives here.
 */

/** Config keys the AI SDK accepts as first-class call options. */
interface GeminiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  tools?: Array<{
    functionDeclarations?: FunctionDeclarationLike[];
    googleSearch?: Record<string, unknown>;
    urlContext?: Record<string, unknown>;
    codeExecution?: Record<string, unknown>;
  }>;
  [key: string]: unknown;
}

/**
 * Gemini server tools, keyed by their wire name.
 *
 * These arrive as bare markers such as `{ googleSearch: {} }` rather than as
 * function declarations, and the AI SDK expects provider tools with a
 * namespaced id. web_search and web_fetch depend on this mapping: without it
 * the markers are dropped and the request carries no tools at all.
 */
const SERVER_TOOL_IDS: Readonly<Record<string, `${string}.${string}`>> = {
  googleSearch: 'google.google_search',
  urlContext: 'google.url_context',
  codeExecution: 'google.code_execution',
};

interface FunctionDeclarationLike {
  name?: string;
  description?: string;
  parameters?: unknown;
  parametersJsonSchema?: unknown;
}

/** Config keys that are Gemini-specific and travel as provider options. */
const PROVIDER_OPTION_KEYS = [
  'thinkingConfig',
  'safetySettings',
  'responseMimeType',
  'responseSchema',
  'cachedContent',
  'responseModalities',
  'seed',
  'presencePenalty',
  'frequencyPenalty',
  'candidateCount',
  'audioTimestamp',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalises `contents`, which the wire format allows in several shapes. */
export function normaliseContents(
  contents: GenerateContentParameters['contents'],
): Content[] {
  if (typeof contents === 'string') {
    return [{ role: 'user', parts: [{ text: contents }] }];
  }
  if (Array.isArray(contents)) {
    return contents;
  }
  return [contents];
}

/**
 * Builds the AI SDK prompt from Gemini contents.
 *
 * Gemini uses a single `model` role carrying both prose and function calls,
 * and puts function responses in a `user` turn. The AI SDK separates
 * assistant output from tool results, so function-response parts are split
 * into their own `tool` message.
 */
export function toPrompt(
  contents: Content[],
  systemInstruction: string | undefined,
): LanguageModelV4Prompt {
  const prompt: LanguageModelV4Prompt = [];

  if (systemInstruction !== undefined && systemInstruction !== '') {
    prompt.push({ role: 'system', content: systemInstruction });
  }

  for (const content of contents) {
    const parts = content.parts ?? [];
    const toolResults = parts.filter((p) => p.functionResponse !== undefined);
    const rest = parts.filter((p) => p.functionResponse === undefined);

    if (toolResults.length > 0) {
      prompt.push({
        role: 'tool',
        content: toolResults.map((part) => {
          const fr = part.functionResponse ?? {};
          return {
            type: 'tool-result' as const,
            toolCallId: fr.id ?? fr.name ?? '',
            toolName: fr.name ?? '',
            output: {
              type: 'json' as const,
              value: (fr.response ?? {}) as never,
            },
          };
        }),
      });
    }

    if (rest.length === 0) {
      continue;
    }

    if (content.role === 'model') {
      prompt.push({ role: 'assistant', content: rest.map(toAssistantPart) });
    } else {
      prompt.push({
        role: 'user',
        content: rest
          .filter(
            (p) =>
              p.text !== undefined ||
              p.inlineData !== undefined ||
              p.fileData !== undefined,
          )
          .map(toUserPart),
      });
    }
  }

  return prompt;
}

function toAssistantPart(part: Part): AssistantPart {
  if (part.functionCall !== undefined) {
    return {
      type: 'tool-call',
      toolCallId: part.functionCall.id ?? part.functionCall.name ?? '',
      toolName: part.functionCall.name ?? '',
      // Passed as an object. doGenerate RETURNS input as a JSON string, but the
      // prompt side takes the parsed value: stringifying here double-encodes it
      // and the API rejects the turn with INVALID_ARGUMENT on
      // function_call.args.
      input: part.functionCall.args ?? {},
      // Gemini 3 carries the thought signature on the function-call part, and
      // the API rejects a replayed turn whose signature is missing. The AI SDK
      // reads it from providerOptions.google, so it has to travel there or it
      // is silently dropped between the wire format and the request.
      ...(part.thoughtSignature !== undefined
        ? {
            providerOptions: {
              google: { thoughtSignature: part.thoughtSignature },
            },
          }
        : {}),
    };
  }
  if (part.thought === true) {
    return {
      type: 'reasoning',
      text: part.text ?? '',
      ...(part.thoughtSignature !== undefined
        ? {
            providerOptions: {
              google: { thoughtSignature: part.thoughtSignature },
            },
          }
        : {}),
    };
  }
  return { type: 'text', text: part.text ?? '' };
}

function toUserPart(part: Part): UserPart {
  // V4 file data is a tagged union: inline bytes are `{ type: 'data' }` and a
  // remote reference is `{ type: 'url' }`.
  if (part.inlineData !== undefined) {
    return {
      type: 'file',
      mediaType: part.inlineData.mimeType ?? 'application/octet-stream',
      data: { type: 'data', data: part.inlineData.data ?? '' },
    };
  }
  if (part.fileData !== undefined) {
    return {
      type: 'file',
      mediaType: part.fileData.mimeType ?? 'application/octet-stream',
      data: { type: 'url', url: new URL(part.fileData.fileUri ?? '') },
    };
  }
  return { type: 'text', text: part.text ?? '' };
}

/** Maps Gemini function declarations onto AI SDK function tools. */
/**
 * Gemini schema type names, as the `Type` constants tool authors use.
 *
 * Tool schemas in this repo are written with Gemini's uppercase spelling
 * (`Type.STRING`, `Type.OBJECT`). That IS the Gemini wire form, so
 * `@google/genai` took it verbatim. `@ai-sdk/google` does its own JSON Schema
 * to Gemini conversion and therefore expects lowercase JSON Schema types, so
 * the uppercase spelling has to be normalised at this boundary or the schema is
 * converted twice.
 *
 * It surfaces first on enums, where the SDK rejects `type: 'STRING'` against
 * string values outright, but every uppercase type is wrong here, not just the
 * ones attached to an enum.
 */
const GEMINI_TYPE_NAMES: ReadonlySet<string> = new Set([
  'STRING',
  'NUMBER',
  'INTEGER',
  'BOOLEAN',
  'ARRAY',
  'OBJECT',
  'NULL',
]);

function lowerGeminiType(value: unknown): unknown {
  if (typeof value === 'string') {
    return GEMINI_TYPE_NAMES.has(value) ? value.toLowerCase() : value;
  }
  if (Array.isArray(value)) {
    return value.map(lowerGeminiType);
  }
  return value;
}

function normaliseSchemaTypes(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(normaliseSchemaTypes);
  }
  if (!isRecord(node)) {
    return node;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] =
      key === 'type' ? lowerGeminiType(value) : normaliseSchemaTypes(value);
  }
  return out;
}

export function toTools(
  config: GeminiGenerationConfig | undefined,
):
  | Array<LanguageModelV4FunctionTool | LanguageModelV4ProviderTool>
  | undefined {
  const groups = config?.tools;
  if (!Array.isArray(groups)) {
    return undefined;
  }
  const tools: Array<
    LanguageModelV4FunctionTool | LanguageModelV4ProviderTool
  > = [];
  for (const group of groups) {
    for (const decl of group.functionDeclarations ?? []) {
      tools.push({
        type: 'function',
        name: decl.name ?? '',
        description: decl.description,
        inputSchema: normaliseSchemaTypes(
          decl.parametersJsonSchema ?? decl.parameters ?? {},
        ) as never,
      });
    }
    for (const [wireName, id] of Object.entries(SERVER_TOOL_IDS)) {
      const args = (group as Record<string, unknown>)[wireName];
      if (args !== undefined) {
        tools.push({
          type: 'provider',
          id,
          name: wireName,
          args: isRecord(args) ? args : {},
        });
      }
    }
  }
  return tools.length > 0 ? tools : undefined;
}

/** Splits the Gemini config into AI SDK call options and provider options. */
export function toCallOptions(
  params: GenerateContentParameters & { systemInstruction?: string },
): Omit<LanguageModelV4CallOptions, 'prompt'> & {
  prompt: LanguageModelV4Prompt;
} {
  const config = (params.config ?? {}) as GeminiGenerationConfig;
  const providerOptions: Record<string, unknown> = {};
  for (const key of PROVIDER_OPTION_KEYS) {
    if (config[key] !== undefined) {
      providerOptions[key] = config[key];
    }
  }

  return {
    prompt: toPrompt(
      normaliseContents(params.contents),
      params.systemInstruction,
    ),
    ...(config.maxOutputTokens !== undefined
      ? { maxOutputTokens: config.maxOutputTokens }
      : {}),
    ...(config.temperature !== undefined
      ? { temperature: config.temperature }
      : {}),
    ...(config.topP !== undefined ? { topP: config.topP } : {}),
    ...(config.topK !== undefined ? { topK: config.topK } : {}),
    ...(config.stopSequences !== undefined
      ? { stopSequences: config.stopSequences }
      : {}),
    ...(toTools(config) !== undefined ? { tools: toTools(config) } : {}),
    ...(Object.keys(providerOptions).length > 0
      ? { providerOptions: { google: providerOptions } as never }
      : {}),
  };
}

/**
 * Maps AI SDK usage back to Gemini usage metadata.
 *
 * `usage.raw` carries the provider's own usageMetadata when available, which
 * is preferred over the normalised counts because it preserves fields the AI
 * SDK does not model.
 */
export function toUsageMetadata(
  usage: LanguageModelV4Usage | undefined,
): GenerateContentResponseUsageMetadata | undefined {
  if (usage === undefined) {
    return undefined;
  }
  if (isRecord(usage.raw)) {
    return usage.raw as GenerateContentResponseUsageMetadata;
  }
  const promptTokenCount = usage.inputTokens.total;
  const candidatesTokenCount = usage.outputTokens.text;
  const thoughtsTokenCount = usage.outputTokens.reasoning;
  const outputTotal = usage.outputTokens.total;
  return {
    ...(promptTokenCount !== undefined ? { promptTokenCount } : {}),
    ...(candidatesTokenCount !== undefined ? { candidatesTokenCount } : {}),
    ...(thoughtsTokenCount !== undefined ? { thoughtsTokenCount } : {}),
    ...(promptTokenCount !== undefined && outputTotal !== undefined
      ? { totalTokenCount: promptTokenCount + outputTotal }
      : {}),
  };
}

const FINISH_REASONS: Record<string, string> = {
  stop: 'STOP',
  length: 'MAX_TOKENS',
  'content-filter': 'SAFETY',
  'tool-calls': 'STOP',
  error: 'OTHER',
  other: 'OTHER',
  unknown: 'FINISH_REASON_UNSPECIFIED',
};

/**
 * V4 reports both a unified reason and the provider's own string. The raw
 * value is preferred: it is the literal Gemini finish reason, which callers
 * pass through as rawStopReason.
 */
export function toFinishReason(
  reason: { unified?: string; raw?: string } | string | undefined,
): string | undefined {
  if (reason === undefined) {
    return undefined;
  }
  if (typeof reason === 'string') {
    return FINISH_REASONS[reason] ?? reason.toUpperCase();
  }
  if (typeof reason.raw === 'string' && reason.raw !== '') {
    return reason.raw;
  }
  if (typeof reason.unified === 'string') {
    return FINISH_REASONS[reason.unified] ?? reason.unified.toUpperCase();
  }
  return undefined;
}

/**
 * Maps AI SDK content back to Gemini parts.
 *
 * Tool-call `input` arrives as a JSON string. It must be parsed into `args`,
 * because replaying a stringified value makes the API reject the turn with
 * INVALID_ARGUMENT on `function_call.args`.
 */
export function toParts(content: readonly LanguageModelV4Content[]): Part[] {
  const parts: Part[] = [];
  for (const item of content) {
    switch (item.type) {
      case 'text':
        parts.push({ text: item.text });
        break;
      case 'reasoning': {
        const signature = extractThoughtSignature(item);
        parts.push({
          text: item.text,
          thought: true,
          ...(signature !== undefined ? { thoughtSignature: signature } : {}),
        });
        break;
      }
      case 'tool-call': {
        const signature = extractThoughtSignature(item);
        parts.push({
          functionCall: {
            ...(item.toolCallId !== '' ? { id: item.toolCallId } : {}),
            name: item.toolName,
            args: parseToolInput(item.input),
          },
          ...(signature !== undefined ? { thoughtSignature: signature } : {}),
        });
        break;
      }
      case 'tool-result':
        parts.push({
          functionResponse: {
            ...(item.toolCallId !== '' ? { id: item.toolCallId } : {}),
            name: item.toolName,
            response: asRecord(item.result),
          },
        });
        break;
      default:
        break;
    }
  }
  return parts;
}

function extractThoughtSignature(item: unknown): string | undefined {
  if (!isRecord(item)) {
    return undefined;
  }
  // `providerOptions` on the prompt side, `providerMetadata` on the result
  // side; both carry the same google-scoped payload.
  const options = isRecord(item['providerOptions'])
    ? item['providerOptions']
    : item['providerMetadata'];
  if (!isRecord(options)) {
    return undefined;
  }
  const google = options['google'];
  if (!isRecord(google)) {
    return undefined;
  }
  const signature = google['thoughtSignature'];
  return typeof signature === 'string' ? signature : undefined;
}

function parseToolInput(input: unknown): Record<string, unknown> {
  if (isRecord(input)) {
    return input;
  }
  if (typeof input !== 'string' || input === '') {
    return {};
  }
  const parsed: unknown = JSON.parse(input);
  return isRecord(parsed) ? parsed : {};
}

function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    const inner = value['value'];
    if (value['type'] === 'json' && isRecord(inner)) {
      return inner;
    }
    return value;
  }
  return {};
}

/** Assembles a Gemini response envelope from AI SDK result pieces. */
export function toGenerateContentResponse(result: {
  content: readonly LanguageModelV4Content[];
  finishReason?: { unified?: string; raw?: string } | string;
  usage?: LanguageModelV4Usage;
  providerMetadata?: Record<string, unknown>;
  response?: { id?: string; modelId?: string };
}): GenerateContentResponse {
  const google = isRecord(result.providerMetadata)
    ? result.providerMetadata['google']
    : undefined;
  const grounding = isRecord(google) ? google['groundingMetadata'] : undefined;
  const urlContext = isRecord(google)
    ? google['urlContextMetadata']
    : undefined;
  const usageMetadata = toUsageMetadata(result.usage);
  const finishReason = toFinishReason(result.finishReason);

  return {
    candidates: [
      {
        content: { role: 'model', parts: toParts(result.content) },
        ...(finishReason !== undefined ? { finishReason } : {}),
        ...(grounding !== undefined && grounding !== null
          ? { groundingMetadata: grounding as never }
          : {}),
        // Null, not undefined, when the provider reports the key without
        // content; carrying that through would fabricate empty metadata.
        ...(urlContext !== undefined && urlContext !== null
          ? { urlContextMetadata: urlContext as never }
          : {}),
      },
    ],
    ...(usageMetadata !== undefined ? { usageMetadata } : {}),
    ...(result.response?.id !== undefined
      ? { responseId: result.response.id }
      : {}),
    ...(result.response?.modelId !== undefined
      ? { modelVersion: result.response.modelId }
      : {}),
  };
}
