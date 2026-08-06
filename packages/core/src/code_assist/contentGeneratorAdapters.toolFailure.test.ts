/**
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
 * Issue #3076 — the Google code-assist request path
 * (`contentGeneratorAdapters.toGenerateContentParameters`) is the ONLY live
 * consumer of the outbound failure encoding produced by ContentConverters.
 * These proofs drive the real adapter with real IContent fixtures (no mocks)
 * and assert that a failed tool_response reaches the wire carrying an explicit
 * failure signal rather than masquerading as a success.
 */

import { describe, it, expect } from 'bun:test';
import {
  toGenerateContentParameters,
  toCountTokensParameters,
} from './contentGeneratorAdapters.js';
import type { ModelGenerationRequest } from '../llm-types/modelRequest.js';
import type { CountTokensRequest } from '../llm-types/tokensAndEmbeddings.js';
import type { IContent } from '../services/history/IContent.js';

function failedToolContent(): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'hist_tool_fail1',
        toolName: 'failingTool',
        result: { output: 'partial data' },
        error: 'boom',
      },
    ],
  };
}

describe('contentGeneratorAdapters tool-failure (issue #3076)', () => {
  it('toGenerateContentParameters emits an explicit failure signal for a failed tool_response', () => {
    const request: ModelGenerationRequest = {
      contents: [failedToolContent()],
      model: 'gemini-2.5-pro',
    };
    const params = toGenerateContentParameters(request);
    const response = params.contents[0]?.parts?.[0]?.functionResponse?.response;

    expect(response?.status).toBe('error');
    expect(response?.error).toBe('boom');
    expect(response?.result).toEqual({ output: 'partial data' });
  });

  it('toGenerateContentParameters emits a byte-identical raw response for a successful tool_response (regression guard)', () => {
    const result = { found: true, nested: { a: 1 } };
    const successContent: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'hist_tool_ok1',
          toolName: 'okTool',
          result,
        },
      ],
    };
    const request: ModelGenerationRequest = {
      contents: [successContent],
      model: 'gemini-2.5-pro',
    };
    const params = toGenerateContentParameters(request);
    const response = params.contents[0]?.parts?.[0]?.functionResponse?.response;

    expect(response).toStrictEqual(result);
    expect(response).not.toHaveProperty('status');
    expect(response).not.toHaveProperty('error');
  });

  it('toCountTokensParameters counts the same failure-shaped response', () => {
    const request: CountTokensRequest = { contents: [failedToolContent()] };
    const params = toCountTokensParameters(request, 'gemini-2.5-pro');
    const response = params.contents[0]?.parts?.[0]?.functionResponse?.response;

    expect(response?.status).toBe('error');
  });
});
