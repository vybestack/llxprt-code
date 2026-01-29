/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * TDD tests for reasoning.summary profile save/load
 * @issue #922 - GPT-5.2-Codex thinking blocks not visible
 */

import { describe, it, expect } from 'vitest';
import { PROFILE_EPHEMERAL_KEYS } from './runtimeSettings.js';

describe('reasoning.summary profile save/load @issue:922', () => {
  it('should include reasoning.summary in PROFILE_EPHEMERAL_KEYS', () => {
    expect(PROFILE_EPHEMERAL_KEYS).toContain('reasoning.summary');
  });

  it('should include all reasoning.* keys in PROFILE_EPHEMERAL_KEYS', () => {
    // Verify all reasoning settings are saveable
    expect(PROFILE_EPHEMERAL_KEYS).toContain('reasoning.enabled');
    expect(PROFILE_EPHEMERAL_KEYS).toContain('reasoning.includeInContext');
    expect(PROFILE_EPHEMERAL_KEYS).toContain('reasoning.includeInResponse');
    expect(PROFILE_EPHEMERAL_KEYS).toContain('reasoning.format');
    expect(PROFILE_EPHEMERAL_KEYS).toContain('reasoning.stripFromContext');
    expect(PROFILE_EPHEMERAL_KEYS).toContain('reasoning.effort');
    expect(PROFILE_EPHEMERAL_KEYS).toContain('reasoning.maxTokens');
    expect(PROFILE_EPHEMERAL_KEYS).toContain('reasoning.summary');
  });

  it('should include text.verbosity in PROFILE_EPHEMERAL_KEYS', () => {
    // text.verbosity is for OpenAI Responses API response verbosity control
    expect(PROFILE_EPHEMERAL_KEYS).toContain('text.verbosity');
  });
});
