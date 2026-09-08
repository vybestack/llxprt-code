/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the settings-only citation gate (packages/agents/src/core/turnCitations.ts).
 *
 * Citations are controlled by the `ui.showCitations` setting alone. An absent
 * setting defaults to false. These tests exercise the real gate implementation.
 */

import { describe, expect, it } from 'bun:test';
import { AgentEventType } from '@vybestack/llxprt-code-core/core/turn.js';
import { buildCitationEvent, shouldShowCitations } from '../turnCitations.js';

describe('shouldShowCitations (settings-only)', () => {
  it('returns true when ui.showCitations is true', () => {
    const config = {
      getSettingsService: () => ({ get: () => true }),
    };
    expect(shouldShowCitations(config)).toBe(true);
  });

  it('returns false when ui.showCitations is false', () => {
    const config = {
      getSettingsService: () => ({ get: () => false }),
    };
    expect(shouldShowCitations(config)).toBe(false);
  });

  it('returns false when the settings are absent', () => {
    const config = {
      getSettingsService: () => ({ get: () => undefined }),
    };
    expect(shouldShowCitations(config)).toBe(false);
  });

  it('returns false when no settings service is available', () => {
    expect(shouldShowCitations(undefined)).toBe(false);
  });
});

describe('buildCitationEvent', () => {
  it('builds a citation event when citations are enabled', () => {
    const config = {
      getSettingsService: () => ({ get: () => true }),
    };
    const event = buildCitationEvent(config, 'source text');
    expect(event).not.toBeNull();
    expect(event?.value).toBe('source text');
    expect(event?.type).toBe(AgentEventType.Citation);
  });

  it('returns null when citations are disabled', () => {
    const config = {
      getSettingsService: () => ({ get: () => false }),
    };
    expect(buildCitationEvent(config, 'source text')).toBeNull();
  });
});
