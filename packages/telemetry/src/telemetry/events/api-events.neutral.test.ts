/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { type UsageMetadata } from '../types/usage-metadata.js';
import { ApiResponseEvent } from './api-events.js';

describe('neutral UsageMetadata structural assignability', () => {
  it('accepts a minimal usage object', () => {
    const usage: UsageMetadata = {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    };
    expect(usage.promptTokenCount).toBe(10);
  });

  it('accepts all fields used by ApiResponseEvent', () => {
    const usage: UsageMetadata = {
      promptTokenCount: 100,
      candidatesTokenCount: 50,
      cachedContentTokenCount: 20,
      thoughtsTokenCount: 5,
      toolUsePromptTokenCount: 10,
      totalTokenCount: 185,
    };
    expect(usage.toolUsePromptTokenCount).toBe(10);
  });
});

describe('ApiResponseEvent with neutral UsageMetadata', () => {
  it('extracts token counts from neutral usage data', () => {
    const usage: UsageMetadata = {
      promptTokenCount: 100,
      candidatesTokenCount: 50,
      cachedContentTokenCount: 20,
      thoughtsTokenCount: 5,
      toolUsePromptTokenCount: 10,
      totalTokenCount: 185,
    };
    const event = new ApiResponseEvent('gemini-pro', 500, 'prompt-1', usage);
    expect(event.input_token_count).toBe(100);
    expect(event.output_token_count).toBe(50);
    expect(event.cached_content_token_count).toBe(20);
    expect(event.thoughts_token_count).toBe(5);
    expect(event.tool_token_count).toBe(10);
    expect(event.total_token_count).toBe(185);
  });

  it('defaults missing counts to 0 for partial usage data', () => {
    const event = new ApiResponseEvent('gemini-pro', 500, 'prompt-1', {
      promptTokenCount: 7,
    });
    expect(event.input_token_count).toBe(7);
    expect(event.output_token_count).toBe(0);
    expect(event.cached_content_token_count).toBe(0);
    expect(event.thoughts_token_count).toBe(0);
    expect(event.tool_token_count).toBe(0);
    expect(event.total_token_count).toBe(0);
  });

  it('defaults all counts to 0 when usage is undefined', () => {
    const event = new ApiResponseEvent('gemini-pro', 500, 'prompt-1');
    expect(event.input_token_count).toBe(0);
    expect(event.output_token_count).toBe(0);
    expect(event.cached_content_token_count).toBe(0);
    expect(event.thoughts_token_count).toBe(0);
    expect(event.tool_token_count).toBe(0);
    expect(event.total_token_count).toBe(0);
  });
});
