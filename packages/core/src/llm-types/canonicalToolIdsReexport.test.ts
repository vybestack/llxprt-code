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

  it('canonicalizeToolResponseId produces the expected hist_tool_ format', () => {
    const id = canonicalizeToolResponseId(input);
    expect(id.startsWith('hist_tool_')).toBe(true);
    // Total length = 10 (prefix) + 24 (hash slice)
    expect(id).toHaveLength(34);
    // Deterministic: identical inputs yield identical IDs
    expect(canonicalizeToolResponseId(input)).toBe(
      canonicalizeToolResponseId(input),
    );
  });

  it('canonicalizes a tool call ID into the hist_tool_ namespace', () => {
    const id = canonicalizeToolCallId(input);
    expect(id.startsWith('hist_tool_')).toBe(true);
    // Total length = 10 (prefix) + 24 (hash slice)
    expect(id).toHaveLength(34);
    // The suffix after the prefix must be base64url-safe
    expect(id.slice('hist_tool_'.length)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is deterministic for identical inputs and varies for distinct inputs', () => {
    expect(canonicalizeToolCallId(input)).toBe(canonicalizeToolCallId(input));

    // Changing rawId (which participates in the hash seed) yields a distinct ID
    const differentInput: CanonicalToolIdInput = {
      ...input,
      rawId: 'call_different456',
    };
    expect(canonicalizeToolCallId(differentInput)).not.toBe(
      canonicalizeToolCallId(input),
    );
  });

  it('falls back to turnKey+callIndex seeding when rawId is undefined', () => {
    const noRawId: CanonicalToolIdInput = {
      providerName: 'openai',
      toolName: 'read_file',
      turnKey: 'turn_fixture',
      callIndex: 0,
    };
    const id = canonicalizeToolCallId(noRawId);
    expect(id.startsWith('hist_tool_')).toBe(true);
    expect(id).toHaveLength(34);
    // Distinct callIndex with undefined rawId must yield distinct IDs
    const differentIndex: CanonicalToolIdInput = { ...noRawId, callIndex: 1 };
    expect(canonicalizeToolCallId(differentIndex)).not.toBe(id);
  });

  it('is idempotent when rawId is already hist_tool_-prefixed', () => {
    const alreadyPrefixed: CanonicalToolIdInput = {
      providerName: 'openai',
      rawId: 'hist_tool_existingvalue',
      toolName: 'read_file',
      turnKey: 'turn_fixture',
      callIndex: 0,
    };
    const id = canonicalizeToolCallId(alreadyPrefixed);
    // When rawId already starts with hist_tool_, buildCanonicalToolId returns
    // it verbatim (no re-hashing).
    expect(id).toBe('hist_tool_existingvalue');
  });

  it('normalizes bare call+token prefix (no underscore)', () => {
    const bareCallToken: CanonicalToolIdInput = {
      providerName: 'openai',
      rawId: 'callAbcd1234efgh',
      toolName: 'read_file',
      turnKey: 'turn_fixture',
      callIndex: 0,
    };
    const id = canonicalizeToolCallId(bareCallToken);
    expect(id.startsWith('hist_tool_')).toBe(true);
    expect(id).toHaveLength(34);
  });

  it('normalizes different provider prefixes to the same canonical ID when rawId core matches', () => {
    // normalizeRawId strips known prefixes: call_, toolu_, and bare call+token.
    // 'call_abc123' and 'toolu_abc123' both normalize to 'abc123', so they
    // produce the same canonical ID when other seed parts are identical.
    const withCallPrefix: CanonicalToolIdInput = {
      providerName: 'openai',
      rawId: 'call_abc123',
      toolName: 'read_file',
      turnKey: 'turn_fixture',
      callIndex: 0,
    };
    const withTooluPrefix: CanonicalToolIdInput = {
      providerName: 'openai',
      rawId: 'toolu_abc123',
      toolName: 'read_file',
      turnKey: 'turn_fixture',
      callIndex: 0,
    };
    expect(canonicalizeToolCallId(withCallPrefix)).toBe(
      canonicalizeToolCallId(withTooluPrefix),
    );
  });
});
