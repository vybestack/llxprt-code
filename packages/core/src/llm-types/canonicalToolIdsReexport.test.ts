/**
 * Copyright 2025 Vybestack LLC
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
 * @plan PLAN-20260702-LLMTYPES.P06
 * @requirement REQ-012.3
 *
 * The neutral tool-call ID canonicalization contract must be reachable from
 * the llm-types barrel so downstream migrations (#2348-#2351) consume it
 * without importing history internals.
 */
import { describe, it, expect } from 'vitest';
import {
  canonicalizeToolCallId,
  canonicalizeToolResponseId,
  type CanonicalToolIdInput,
} from './index.js';

describe('llm-types canonical tool-ID contract re-export', () => {
  it('re-exports canonicalizeToolCallId as a function', () => {
    expect(typeof canonicalizeToolCallId).toBe('function');
  });

  it('re-exports canonicalizeToolResponseId as a function', () => {
    expect(typeof canonicalizeToolResponseId).toBe('function');
  });

  const input: CanonicalToolIdInput = {
    providerName: 'openai',
    rawId: 'call_abc123',
    toolName: 'read_file',
    turnKey: 'turn_fixture',
    callIndex: 0,
  };

  it('canonicalizes a tool call ID into the hist_tool_ namespace', () => {
    const id = canonicalizeToolCallId(input);
    expect(id.startsWith('hist_tool_')).toBe(true);
  });

  it('is deterministic for identical inputs', () => {
    expect(canonicalizeToolCallId(input)).toBe(canonicalizeToolCallId(input));
  });

  it('pairs a tool response with its originating call ID', () => {
    const callId = canonicalizeToolCallId(input);
    const responseId = canonicalizeToolResponseId(input);
    expect(responseId).toBe(callId);
  });
});
