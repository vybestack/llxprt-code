/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { AgentEventType } from '@vybestack/llxprt-code-core/core/turn.js';
import { buildCitationEvent, shouldShowCitations } from '../turnCitations.js';

async function citationPolicy(setting?: boolean): Promise<boolean> {
  const settings = new SettingsService();
  if (setting !== undefined) settings.set('ui.showCitations', setting);
  const owner = new SessionSettingsOwner(settings);
  try {
    return owner.readRuntimePolicy().showCitations === true;
  } finally {
    await owner.dispose();
  }
}

describe('shouldShowCitations (settings-only)', () => {
  it('returns true when ui.showCitations is true', async () => {
    expect(shouldShowCitations(await citationPolicy(true))).toBe(true);
  });

  it('returns false when ui.showCitations is false', async () => {
    expect(shouldShowCitations(await citationPolicy(false))).toBe(false);
  });

  it('returns false when the settings are absent', async () => {
    expect(shouldShowCitations(await citationPolicy())).toBe(false);
  });

  it('returns false when the finite citation policy is disabled', async () => {
    expect(shouldShowCitations(false)).toBe(false);
  });
});

describe('buildCitationEvent', () => {
  it('builds a citation event when citations are enabled', async () => {
    const event = buildCitationEvent(await citationPolicy(true), 'source text');
    expect(event).not.toBeNull();
    expect(event?.value).toBe('source text');
    expect(event?.type).toBe(AgentEventType.Citation);
  });

  it('returns null when citations are disabled', async () => {
    expect(
      buildCitationEvent(await citationPolicy(false), 'source text'),
    ).toBeNull();
  });
});
