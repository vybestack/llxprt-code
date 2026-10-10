/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { ResponsesExecutorDeps } from './openAIResponsesExecutor.js';
import {
  captureResponsesRequest,
  type ResponsesRequest,
} from './responses-request.js';

export interface ResponsesTestDeps extends ResponsesExecutorDeps {
  readonly requestBaseURL: string;
  readonly requestHeaders: Record<string, string> | undefined;
  readonly defaultModel: string;
}

export function captureResponsesTestRequest(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesTestDeps,
): ResponsesRequest {
  return captureResponsesRequest(
    options,
    deps.providerName,
    options.resolved.baseURL ?? deps.requestBaseURL,
    deps.requestHeaders,
    deps.defaultModel,
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
