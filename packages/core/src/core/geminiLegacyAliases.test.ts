/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { AgentEventType } from './turn.js';
import type { ServerAgentStreamEvent } from './turn.js';
import {
  GeminiEventType,
  type ServerGeminiStreamEvent,
} from './geminiLegacyAliases.js';
import * as legacy from './geminiLegacyAliases.js';

describe('geminiLegacyAliases (deprecated aliases)', () => {
  it('GeminiEventType is reference-equal to AgentEventType', () => {
    expect(GeminiEventType).toBe(AgentEventType);
  });

  it('GeminiEventType.Content === "content"', () => {
    expect(GeminiEventType.Content).toBe('content');
  });

  it('ServerGeminiStreamEvent is assignable from ServerAgentStreamEvent', () => {
    const event: ServerAgentStreamEvent = {
      type: AgentEventType.Content,
      value: 'hello',
    };
    // Type-level check: a ServerAgentStreamEvent must be assignable to the
    // deprecated ServerGeminiStreamEvent alias.
    const compat: ServerGeminiStreamEvent = event;
    expect(compat.type).toBe(AgentEventType.Content);
  });

  it('only GeminiEventType is exported as a value (no accidental runtime exports)', () => {
    // Type aliases are erased at runtime; the module's only value export is
    // GeminiEventType. This catches accidental value-export additions/removals.
    expect(Object.keys(legacy)).toStrictEqual(['GeminiEventType']);
  });
});
