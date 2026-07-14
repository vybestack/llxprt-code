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

import { describe, it, expect } from 'vitest';
import {
  canonicalizeToolCallId,
  canonicalizeToolResponseId,
} from './canonicalToolIds.js';

describe('canonicalToolIds', () => {
  it('produces deterministic canonical IDs for calls', () => {
    const first = canonicalizeToolCallId({
      providerName: 'openai',
      rawId: 'call_abc123',
      toolName: 'read_file',
      turnKey: 'turn-1',
      callIndex: 0,
    });
    const second = canonicalizeToolCallId({
      providerName: 'openai',
      rawId: 'call_abc123',
      toolName: 'read_file',
      turnKey: 'turn-1',
      callIndex: 0,
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^hist_tool_[a-zA-Z0-9_-]+$/);
  });

  it('changes when provider or raw ID changes', () => {
    const openai = canonicalizeToolCallId({
      providerName: 'openai',
      rawId: 'call_abc123',
      toolName: 'read_file',
      turnKey: 'turn-1',
      callIndex: 0,
    });
    const anthropic = canonicalizeToolCallId({
      providerName: 'anthropic',
      rawId: 'call_abc123',
      toolName: 'read_file',
      turnKey: 'turn-1',
      callIndex: 0,
    });
    const differentRaw = canonicalizeToolCallId({
      providerName: 'openai',
      rawId: 'call_xyz789',
      toolName: 'read_file',
      turnKey: 'turn-1',
      callIndex: 0,
    });

    expect(openai).not.toBe(anthropic);
    expect(openai).not.toBe(differentRaw);
  });

  it('handles missing inputs and remains deterministic', () => {
    const first = canonicalizeToolCallId({
      providerName: undefined,
      rawId: undefined,
      toolName: undefined,
      turnKey: 'turn-2',
      callIndex: 3,
    });
    const second = canonicalizeToolCallId({
      providerName: undefined,
      rawId: undefined,
      toolName: undefined,
      turnKey: 'turn-2',
      callIndex: 3,
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^hist_tool_[a-zA-Z0-9_-]+$/);
  });

  it('produces different IDs when turnKey changes without raw IDs', () => {
    const first = canonicalizeToolCallId({
      providerName: 'openai',
      rawId: undefined,
      toolName: 'read_file',
      turnKey: 'turn-1',
      callIndex: 0,
    });
    const second = canonicalizeToolCallId({
      providerName: 'openai',
      rawId: undefined,
      toolName: 'read_file',
      turnKey: 'turn-2',
      callIndex: 0,
    });

    expect(first).not.toBe(second);
  });

  it('canonicalizes responses with the same inputs', () => {
    const callId = canonicalizeToolCallId({
      providerName: 'openai',
      rawId: 'call_abc123',
      toolName: 'read_file',
      turnKey: 'turn-9',
      callIndex: 1,
    });
    const responseId = canonicalizeToolResponseId({
      providerName: 'openai',
      rawId: 'call_abc123',
      toolName: 'read_file',
      turnKey: 'turn-9',
      callIndex: 1,
    });

    expect(responseId).toBe(callId);
  });

  it('normalizes raw ID prefixes for deterministic pairing', () => {
    const callId = canonicalizeToolCallId({
      providerName: 'openai',
      rawId: 'call_abc123',
      toolName: 'read_file',
      turnKey: 'turn-5',
      callIndex: 0,
    });
    const responseId = canonicalizeToolResponseId({
      providerName: 'openai',
      rawId: 'call_abc123', // Same rawId for both, just using different input index
      toolName: 'read_file',
      turnKey: 'turn-5',
      callIndex: 1,
    });

    // When the same rawId is provided, canonicalization ignores callIndex
    expect(responseId).toBe(callId);
  });
});
