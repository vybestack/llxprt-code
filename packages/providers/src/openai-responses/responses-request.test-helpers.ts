/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import {
  executeOpenAIResponsesRequest,
  type ResponsesExecutorDeps,
} from './openAIResponsesExecutor.js';
import {
  captureResponsesRequest,
  type ResponsesRequest,
} from './responses-request.js';
import { buildDiskTextResponsesContext } from './responses-disk-text-projection.js';

export interface ResponsesTestDeps extends ResponsesExecutorDeps {
  readonly requestBaseURL: string;
  readonly requestHeaders: Record<string, string> | undefined;
  readonly defaultModel: string;
}

/**
 * The request the provider would capture, with the options' history offered as
 * request rows. Responses sends always read rows, so a test that holds its
 * history as an array hands it over this way.
 */
export function captureResponsesTestRequest(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesTestDeps,
): ResponsesRequest {
  const request = captureResponsesRequest(
    options,
    deps.providerName,
    options.resolved.baseURL ?? deps.requestBaseURL,
    deps.requestHeaders,
    deps.defaultModel,
  );
  if (request.requestRows !== undefined) return request;
  return Object.freeze({
    ...request,
    requestRows: copiedRows(request.contents),
    contentCount: request.contents.length,
  });
}

function copiedRows(rows: readonly IContent[]) {
  return Object.freeze({
    callerOwned: true,
    count: rows.length,
    readAt: (index: number, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      return structuredClone(rows[index]);
    },
    openReader: (signal?: AbortSignal) =>
      (async function* (): AsyncGenerator<IContent, void> {
        for (const row of rows) {
          signal?.throwIfAborted();
          yield structuredClone(row);
        }
      })(),
  });
}

/** Sends a captured test request the way the providers do: from its rows. */
export async function* executeResponsesTestRequest(
  request: ResponsesRequest,
  deps: ResponsesExecutorDeps,
): AsyncIterableIterator<IContent> {
  yield* executeOpenAIResponsesRequest(
    request,
    deps,
    await buildDiskTextResponsesContext(request, deps),
  );
}

export function buildNormalizedOptions(
  overrides: Partial<NormalizedGenerateChatOptions> = {},
): NormalizedGenerateChatOptions {
  const settings = new SettingsService();
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: 'test-runtime',
    config: createRuntimeConfigStub(settings, {}),
  });
  const invocation = createRuntimeInvocationContext({
    runtimeId: runtime.runtimeId,
    sessionId: 'test-session',
    runtimeMetadata: runtime.metadata,

    providerName: 'openai-responses',
    ephemeralsSnapshot: {},
    fallbackRuntimeId: 'test-runtime',
  });

  const base: NormalizedGenerateChatOptions = {
    contents: [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello' }],
      },
    ],

    invocation,
    userMemory: undefined,
    tools: undefined,
    metadata: {},
    systemInstruction: 'test system prompt',
    resolved: {
      model: 'gpt-5.6-sol',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      authToken: 'test-token',
    },
  };

  return { ...base, ...overrides };
}

export function buildCodexWebSocketRequest(
  deps: ResponsesTestDeps,
  overrides: Partial<NormalizedGenerateChatOptions> = {},
): ReturnType<typeof captureResponsesTestRequest> {
  return captureResponsesTestRequest(buildNormalizedOptions(overrides), deps);
}
