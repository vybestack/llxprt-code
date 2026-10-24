/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildNormalizedOptions } from '../../openai-responses/responses-request.test-helpers.js';
import { captureResponsesRequest } from '../../openai-responses/responses-request.js';
import {
  prepareNativeResponsesPrompt,
  type NativeResponsesPrompt,
  type NativeResponsesSelection,
} from '../../openai-responses/native-responses-body.js';
import type { ResponsesInputItem } from '../../openai-responses/OpenAIResponsesTypes.js';
import type { ResponsesInputBuildContext } from '../../openai-responses/OpenAIResponsesInputBuilder.js';
import { resolveRequestMedia } from '../../utils/request-media-resolution.js';
import {
  canonicalizePromptValue,
  type ProjectionImageEntry,
} from '../promptEnvelopeProjections.js';

export function nativeRows(rows: readonly IContent[]): ProviderRequestRows {
  return {
    callerOwned: true,
    count: rows.length,
    readAt: (at, signal) => {
      signal?.throwIfAborted();
      return rows[at];
    },
    async *openReader(signal) {
      for (const row of rows) {
        signal?.throwIfAborted();
        yield row;
      }
    },
  };
}

export async function nativePrompt(
  rows: ProviderRequestRows,
  options: {
    readonly model: string;
    readonly context: ResponsesInputBuildContext;
    readonly instructions?: string;
    readonly tools?: unknown;
    readonly signal?: AbortSignal;
    readonly selection?: NativeResponsesSelection;
  },
): Promise<NativeResponsesPrompt> {
  const captured = captureResponsesRequest(
    buildNormalizedOptions(),
    'openai-responses',
    'https://example.test/v1',
    undefined,
    options.model,
  );
  const request = {
    ...captured,
    contents: [],
    requestRows: rows,
    contentCount: rows.count,
    resolved: { ...captured.resolved, model: options.model },
    invocation: { ...captured.invocation, signal: options.signal },
    pdfEnabled: options.context.mediaPdfEnabled,
    includeReasoningInContext: options.context.includeReasoningInContext,
    outputLimits: options.context.outputLimits,
  };
  const promptKeys: Readonly<Record<string, unknown>> = {
    tools: options.tools,
  };
  const mediaRequest = await resolveRequestMedia(
    { requestId: 'native-responses-test' },
    [],
    options.signal,
  );
  return prepareNativeResponsesPrompt(
    request,
    {
      providerName: 'openai-responses',
      logger: new DebugLogger('native-responses-test'),
      isCodexMode: () => false,
      getCodexAccountId: async () => '',
      resolveAuthTokenForPrompt: async () => 'test',
      shouldRetryOnError: () => false,
      getUnallowedModelParameters: () => new Set(),
    },
    {
      request: {
        model: options.model,
        input: [],
        instructions: options.instructions,
        stream: true,
        ...promptKeys,
      },
      mediaRequest,
      rawBaseURL: 'https://example.test/v1',
      isCodex: false,
      includeThinkingInResponse: false,
      responsesStored: false,
    },
    options.context.reasoningIdTime ?? 1700000000000,
    options.selection ?? {
      stateful: {
        enabled: options.context.serverSideParentActive === true,
        parentId:
          options.context.serverSideParentActive === true
            ? 'parent'
            : undefined,
      },
      skipRows: 0,
    },
  );
}

export async function nativePromptKeys(
  prompt: NativeResponsesPrompt,
): Promise<string[]> {
  const envelope = prompt.envelope();
  const input: ResponsesInputItem[] = [];
  for await (const item of prompt.items(0, true)) input.push(item);
  return ['instructions', 'input', 'tools'].flatMap((key) => {
    const value: unknown = key === 'input' ? input : Reflect.get(envelope, key);
    if (value === undefined) return [];
    const normalized = canonicalizePromptValue(value, key, []);
    return [
      typeof normalized === 'string' && key !== 'input'
        ? normalized
        : JSON.stringify(normalized),
    ];
  });
}

export async function nativeImages(
  prompt: NativeResponsesPrompt,
): Promise<ProjectionImageEntry[]> {
  const images: ProjectionImageEntry[] = [];
  const envelope = prompt.envelope();
  canonicalizePromptValue(envelope.instructions, 'instructions', images);
  for await (const item of prompt.items(0, true))
    canonicalizePromptValue(item, 'input', images);
  canonicalizePromptValue(envelope.tools, 'tools', images);
  return images;
}
