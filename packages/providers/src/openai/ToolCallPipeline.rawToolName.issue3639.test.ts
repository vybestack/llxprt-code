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
import { ToolCallPipeline } from './ToolCallPipeline.js';

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

  it('keeps the last non-empty name when a name is split across streaming fragments', async () => {
    pipeline.addFragment(0, { name: 'read_' });
    pipeline.addFragment(0, { name: 'file_thing' });
    pipeline.addFragment(0, { args: '{}' });

    const result = await pipeline.process();

    expect(result.normalized).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    // The collector's override semantics mean the last non-empty name wins;
    // the raw last-emitted name survives normalization unchanged.
    expect(result.normalized[0].name).toBe('file_thing');
  });
});
