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
 * Raw tool name passthrough pin (issue #3639).
 *
 * ToolCallPipeline is the live streaming path OpenAIStreamProcessor drives via
 * addFragment/process. These tests pin the contract that a tool name the model
 * emits flows through exactly as sent, modulo the pipeline's existing
 * trim/lowercase normalization: no fabricated stand-in name, no fuzzy or case
 * "correction" toward a registered tool, no substitution of any kind. Core
 * dispatch is responsible for failing unregistered names.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { GemmaToolCallParser } from '@vybestack/llxprt-code-core/parsers/TextToolCallParser.js';
import type {
  IContent,
  ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ToolCallPipeline } from './ToolCallPipeline.js';
import { type StreamProcessorDeps } from './OpenAIStreamProcessor.js';
import {
  type StreamingState,
  createStreamingState,
} from './OpenAIStreamProcessorState.js';
import { emitCombinedTerminalContent } from './OpenAIStreamTerminalContent.js';

describe('ToolCallPipeline raw tool name passthrough (issue #3639)', () => {
  let pipeline: ToolCallPipeline;

  beforeEach(() => {
    pipeline = new ToolCallPipeline();
  });

  it('emits an unregistered tool name as-is after trim+lowercase, neither dropped nor rewritten', async () => {
    pipeline.addFragment(0, { name: 'Totally_Bogus_Tool' });
    pipeline.addFragment(0, { args: '{}' });

    const result = await pipeline.process();

    expect(result.normalized).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.normalized[0].name).toBe('totally_bogus_tool');
    expect(result.normalized[0].args).toStrictEqual({});
  });

  it('never fabricates a tool_name_not_found or missing_tool_name stand-in anywhere in the result', async () => {
    pipeline.addFragment(0, { name: 'Totally_Bogus_Tool' });
    pipeline.addFragment(0, { args: '{}' });

    const result = await pipeline.process();

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('tool_name_not_found');
    expect(serialized).not.toContain('missing_tool_name');
  });

  it('passes a name containing punctuation and whitespace through after trim+lowercase without rewriting', async () => {
    pipeline.addFragment(0, { name: 'invalid-tool name!' });
    pipeline.addFragment(0, { args: '{}' });

    const result = await pipeline.process();

    expect(result.normalized).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.normalized[0].name).toBe('invalid-tool name!');
  });

  it('does not fuzzy- or case-correct a partial name toward a similar real tool name', async () => {
    pipeline.addFragment(0, { name: 'Read_Fil' });
    pipeline.addFragment(0, { args: '{}' });

    const result = await pipeline.process();

    expect(result.normalized).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.normalized[0].name).toBe('read_fil');
  });

  it('drops a call with no name fragment entirely instead of emitting one with a fabricated name', async () => {
    pipeline.addFragment(0, { args: '{}' });

    const result = await pipeline.process();

    expect(result.normalized).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain('missing_tool_name');
  });

  it('keeps the latest complete name fragment via collector override (no concatenation)', async () => {
    pipeline.addFragment(0, { name: 'read_' });
    pipeline.addFragment(0, { name: 'file_thing' });
    pipeline.addFragment(0, { args: '{}' });

    const result = await pipeline.process();

    expect(result.normalized).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    // The collector's override semantics mean the latest non-empty name wins;
    // the OpenAI wire format sends function.name once per call, so repeat name
    // fragments override rather than concatenate. This pins override, not
    // split-name reassembly, and the raw last-emitted name survives unchanged.
    expect(result.normalized[0].name).toBe('file_thing');
  });

  // The only sanctioned rewrites under issue #3639 are outer-whitespace trim,
  // Kimi-K2 concatenated-prefix stripping, and lowercasing. The pipeline has
  // no registry of real tools, so an exact-value assertion pins that the name
  // stays itself and is never rewritten toward any registered tool.
  it('trims outer whitespace from a tool name without further rewriting', async () => {
    pipeline.addFragment(0, { name: '  totally_bogus_tool  ' });
    pipeline.addFragment(0, { args: '{}' });

    const result = await pipeline.process();

    expect(result.normalized).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.normalized[0].name).toBe('totally_bogus_tool');
  });

  it('strips a concatenated functions prefix and keeps the rest of the name', async () => {
    pipeline.addFragment(0, { name: 'functionstotally_bogus_tool' });
    pipeline.addFragment(0, { args: '{}' });

    const result = await pipeline.process();

    expect(result.normalized).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.normalized[0].name).toBe('totally_bogus_tool');
  });

  it('strips a concatenated call_functions prefix with trailing digits', async () => {
    pipeline.addFragment(0, { name: 'call_functionstotally_bogus_tool3' });
    pipeline.addFragment(0, { args: '{}' });

    const result = await pipeline.process();

    expect(result.normalized).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.normalized[0].name).toBe('totally_bogus_tool');
  });
});

/**
 * Provider-to-dispatch emission seam (issue #3639): the terminal-content
 * generator copies each normalizedCall.name verbatim into its ToolCallBlock,
 * so an unregistered name reaches dispatch exactly as the pipeline produced
 * it. Failing such a name at dispatch (TOOL_NOT_REGISTERED) is covered by
 * existing packages/agents tests (tool-dispatcher.test.ts,
 * nonInteractiveToolExecutor.test.ts); only the provider-side half of the
 * seam is pinned here.
 */
describe('ToolCallPipeline -> emitCombinedTerminalContent emission handoff (issue #3639)', () => {
  let pipeline: ToolCallPipeline;

  beforeEach(() => {
    pipeline = new ToolCallPipeline();
  });

  function buildDeps(): StreamProcessorDeps {
    return {
      toolCallPipeline: pipeline,
      textToolParser: new GemmaToolCallParser(),
      logger: new DebugLogger('llxprt:test:issue3639-emission'),
      getBaseURL: () => undefined,
    };
  }

  function collect(
    state: StreamingState,
    deps: StreamProcessorDeps,
  ): IContent[] {
    const yielded: IContent[] = [];
    for (const content of emitCombinedTerminalContent(
      state,
      'test-model',
      deps,
    )) {
      yielded.push(content);
    }
    return yielded;
  }

  it('emits an unregistered name verbatim as the tool_call block with no stand-in', async () => {
    pipeline.addFragment(0, { name: 'Totally_Bogus_Tool' });
    pipeline.addFragment(0, { args: '{}' });

    const result = await pipeline.process();

    const state = createStreamingState();
    state.cachedPipelineResult = result;

    const yielded = collect(state, buildDeps());

    expect(yielded).toHaveLength(1);
    const toolCallBlocks = yielded[0].blocks.filter(
      (block): block is ToolCallBlock => block.type === 'tool_call',
    );
    expect(toolCallBlocks).toHaveLength(1);
    expect(toolCallBlocks[0]?.name).toBe('totally_bogus_tool');

    const serialized = JSON.stringify(yielded[0]);
    expect(serialized).not.toContain('tool_name_not_found');
    expect(serialized).not.toContain('missing_tool_name');
  });

  it('emits nothing for a nameless call instead of fabricating a name', async () => {
    pipeline.addFragment(0, { args: '{}' });

    const result = await pipeline.process();

    const state = createStreamingState();
    state.cachedPipelineResult = result;

    const yielded = collect(state, buildDeps());

    expect(yielded).toHaveLength(0);
  });
});
