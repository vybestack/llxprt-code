/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #207: applyResponseMetadata must carry IContent.metadata.id onto the
 * synthetic GenerateContentResponse via the repo-owned responseId carrier so
 * it survives the Gemini intermediate and reaches recorded history.
 */

import { describe, it, expect } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { convertIContentToResponse } from './MessageConverter.js';
import { getResponseId, getResponsesStored } from './responseIdCarrier.js';

describe('Issue 207: metadata.id carried as responseId @issue:207', () => {
  it('sets responseId when metadata.id is present', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello.' }],
      metadata: { id: 'resp_abc' },
    };

    const response = convertIContentToResponse(icontent);

    expect(getResponseId(response)).toBe('resp_abc');
  });

  it('does not set responseId when metadata.id is absent', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello.' }],
      metadata: {
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      },
    };

    const response = convertIContentToResponse(icontent);

    expect(getResponseId(response)).toBeUndefined();
  });

  it('sets both responseId and usageMetadata when both are present', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello.' }],
      metadata: {
        id: 'resp_xyz',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
    };

    const response = convertIContentToResponse(icontent);

    expect(getResponseId(response)).toBe('resp_xyz');
    expect(response.usageMetadata).toBeDefined();
    expect(response.usageMetadata?.promptTokenCount).toBe(10);
  });

  it('does not set responseId when metadata.id is an empty string', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello.' }],
      metadata: { id: '' },
    };

    const response = convertIContentToResponse(icontent);

    expect(getResponseId(response)).toBeUndefined();
  });

  it('carries responsesStored=true onto the synthetic response', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello.' }],
      metadata: { id: 'resp_stored', responsesStored: true },
    };

    const response = convertIContentToResponse(icontent);

    expect(getResponseId(response)).toBe('resp_stored');
    expect(getResponsesStored(response)).toBe(true);
  });

  it('sets responseId but not responsesStored when only metadata.id is present', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello.' }],
      metadata: { id: 'resp_plain' },
    };

    const response = convertIContentToResponse(icontent);

    expect(getResponseId(response)).toBe('resp_plain');
    expect(getResponsesStored(response)).toBeUndefined();
  });
});
