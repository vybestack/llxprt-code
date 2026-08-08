/**
 * @license
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Shared harness for the issue #3134 Codex statefulness behavioral tests.
 *
 * These tests exercise real code paths: the transport derives its metadata
 * from a REAL SSE byte stream through parseResponsesStream (using the
 * completingScript harness), and turn-2 history is fed verbatim from turn-1's
 * ACTUAL yielded IContents, proving the stateful chain works end-to-end.
 */

import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResponsesExecutorDeps } from './openAIResponsesExecutor.js';
import type { NormalizedGenerateChatOptions } from './../BaseProvider.js';

export const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
export const TEST_RUNTIME_ID = 'codex-stateful-remediation-test';

export function buildCodexOAuthManager(): object {
  return {
    getOAuthToken: async () => ({
      access_token: 'codex-token',
      token_type: 'Bearer',
      expires_in: 3600,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'test-refresh',
      scope: 'openid',
      account_id: 'acct_codex_123',
    }),
  };
}

export function sseResponse(
  id: string,
  text: string,
  responsesStored: boolean,
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (text) {
        controller.enqueue(
          encoder.encode(
            `data: {"type":"response.output_text.delta","delta":${JSON.stringify(text)}}\n\n`,
          ),
        );
      }
      const stored = responsesStored ? ',"responsesStored":true' : '';
      void stored;
      controller.enqueue(
        encoder.encode(
          `data: {"type":"response.completed","response":{"id":${JSON.stringify(id)},"status":"completed"}}\n\n`,
        ),
      );
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

export function errorResponse(status: number, message: string): Response {
  const body = JSON.stringify({
    error: { message, type: 'invalid_request_error' },
  });
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function drain(
  iterator: AsyncIterableIterator<IContent>,
): Promise<IContent[]> {
  const out: IContent[] = [];
  for await (const chunk of iterator) out.push(chunk);
  return out;
}

export function buildOptions(
  contents: IContent[],
  ephemerals: Record<string, unknown> = {},
): NormalizedGenerateChatOptions {
  const settings = new SettingsService();
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: TEST_RUNTIME_ID,
  });
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: 'openai-responses',
    ephemeralsSnapshot: ephemerals,
  });
  // `ephemerals` is the real ProviderCallOptionsInit key; `ephemeralSettings`
  // is silently dropped as an excess property (test files are not typechecked,
  // so the mistake is invisible there — this module IS typechecked).
  return createProviderCallOptions({
    providerName: 'openai-responses',
    settings,
    config: createRuntimeConfigStub(settings),
    runtime,
    invocation,
    contents,
    ephemerals,
    resolved: {
      model: 'gpt-5.6-sol',
      baseURL: CODEX_BASE_URL,
      authToken: 'test-token',
    },
  }) as unknown as NormalizedGenerateChatOptions;
}

export function buildDeps(
  overrides: Partial<ResponsesExecutorDeps> = {},
): ResponsesExecutorDeps {
  return {
    providerName: 'openai-responses',
    logger: {
      debug: () => undefined,
    } as unknown as ResponsesExecutorDeps['logger'],
    getProviderBaseURL: () => CODEX_BASE_URL,
    getCustomHeaders: () => ({ 'X-Provider': 'p' }),
    isCodexBaseURL: (url) => (url ?? '').includes('backend-api/codex'),
    getCodexAccountId: async () => 'codex-account',
    resolveAuthTokenForPrompt: async () => 'codex-token',
    shouldRetryOnError: () => false,
    getDefaultModel: () => 'gpt-5.6-sol',
    getGlobalConfig: () => undefined,
    ...overrides,
  };
}

export function metadataOf(
  messages: readonly IContent[],
): IContent['metadata'] {
  const found = messages.find(
    (m) => m.metadata !== undefined && m.blocks.length === 0,
  );
  return found?.metadata;
}
