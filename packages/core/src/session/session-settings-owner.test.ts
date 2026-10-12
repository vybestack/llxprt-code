/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from './session-settings-owner.js';
describe('session default classification', () => {
  it('captures user siblings without persisting nested model and provider defaults', async () => {
    const settings = new SettingsService();
    const owner = new SessionSettingsOwner(settings);
    try {
      settings.set('reasoning.enabled', true);
      settings.set('reasoning.maxTokens', 2048);
      settings.set('reasoning.includeInResponse', false);
      owner.recordProviderDefaults([['reasoning.maxTokens', 2048]]);
      owner.recordModelDefaults(['reasoning.enabled']);
      expect(owner.captureUserParameters()).toStrictEqual({
        reasoning: { includeInResponse: false },
      });
      owner.writeUserParameter('reasoning.enabled', false);
      expect(owner.captureUserParameters()).toStrictEqual({
        reasoning: { enabled: false, includeInResponse: false },
      });
      expect(settings.get('reasoning.maxTokens')).toBe(2048);
    } finally {
      await owner.dispose();
    }
  });
  it('restores provider and model default classifications without changing a peer', async () => {
    const first = new SessionSettingsOwner(new SettingsService());
    const peer = new SessionSettingsOwner(new SettingsService());
    try {
      first.recordProviderDefaults([['temperature', 0.2]]);
      first.recordModelDefaults(['reasoning.enabled']);
      peer.recordProviderDefaults([['temperature', 0.8]]);
      peer.recordModelDefaults(['maxOutputTokens']);
      const restore = first.checkpointDefaults();
      first.writeUserParameter('temperature', 0.5);
      first.recordModelDefaults(['context-limit']);
      expect(first.captureDefaultClassification()).toStrictEqual({
        modelKeys: ['context-limit'],
        providerEntries: [],
      });
      restore();
      expect(first.captureDefaultClassification()).toStrictEqual({
        modelKeys: ['reasoning.enabled'],
        providerEntries: [['temperature', 0.2]],
      });
      expect(peer.captureDefaultClassification()).toStrictEqual({
        modelKeys: ['maxOutputTokens'],
        providerEntries: [['temperature', 0.8]],
      });
    } finally {
      await first.dispose();
      await peer.dispose();
    }
  });
});

describe('session override authority', () => {
  it('distinguishes a local value from an explicit override after clearing', () => {
    const settings = new SettingsService();
    const owner = new SessionSettingsOwner(settings);
    settings.set('dumpcontext', 'error');
    expect(owner.readSessionOverride('dumpcontext')).toBeUndefined();
    expect(owner.readNamedParameter('dumpcontext')).toBe('error');
    owner.writeSessionOverride('dumpcontext', 'on');
    expect(owner.readSessionOverride('dumpcontext')).toBe('on');
    owner.clearSessionOverride('dumpcontext');
    expect(owner.readSessionOverride('dumpcontext')).toBeUndefined();
    expect(owner.readNamedParameter('dumpcontext')).toBe('error');
  });

  it('shares foreground overrides with child stores without granting mutation authority', () => {
    const parent = new SessionSettingsOwner(new SettingsService());
    const child = new SessionSettingsOwner(parent.createChildStore());
    child.writeNamedParameter('dumpcontext', 'off');
    parent.writeSessionOverride('dumpcontext', 'on');
    expect(child.readNamedParameter('dumpcontext')).toBe('on');
    expect(() => child.writeSessionOverride('dumpcontext', 'error')).toThrow(
      'foreground owner',
    );
    parent.clearSessionOverride('dumpcontext');
    expect(child.readSessionOverride('dumpcontext')).toBeUndefined();
    expect(child.readNamedParameter('dumpcontext')).toBe('off');
  });
});
