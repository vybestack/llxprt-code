/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import { SessionProviderReads } from './session-provider-reads.js';

function root(provider: string, model: string) {
  const settings = new SettingsService();
  settings.set('activeProvider', provider);
  settings.setProviderSetting(provider, 'model', model);
  const selection = new SessionSettingsOwner(settings);
  const manager = new TestRuntimeProviderManager();
  manager.setActiveProvider('stale-cache');
  return {
    settings,
    selection,
    reads: new SessionProviderReads(
      selection,
      manager,
      () => '',
      (provider) => settings.getProviderSettings(provider),
    ),
  };
}

describe('session provider reads', () => {
  it('reads parameter changes from the selected owner and excludes provider configuration', () => {
    const first = root('first', 'first-model');
    const second = root('second', 'second-model');
    try {
      first.settings.setProviderSetting('first', 'temperature', 0.2);
      second.settings.setProviderSetting('second', 'temperature', 0.8);
      first.settings.setProviderSetting(
        'first',
        'base-url',
        'https://first.example',
      );
      expect(first.reads.getActiveModelParams()).toStrictEqual({
        temperature: 0.2,
      });
      expect(second.reads.getActiveModelParams()).toStrictEqual({
        temperature: 0.8,
      });
      first.settings.setProviderSetting('first', 'temperature', undefined);
      expect(first.reads.getActiveModelParams()).toStrictEqual({});
      expect(second.reads.getActiveModelParams()).toStrictEqual({
        temperature: 0.8,
      });
    } finally {
      first.selection.closeAdmission();
      second.selection.closeAdmission();
    }
  });

  it('keeps retained reads local across selection changes and sibling closure', () => {
    const first = root('first', 'first-model');
    const second = root('second', 'second-model');
    first.selection.chooseModel('changed-model');
    expect(first.reads.providerStatus().displayLabel).toBe(
      'first:changed-model',
    );
    expect(second.reads.providerStatus().displayLabel).toBe(
      'second:second-model',
    );
    first.selection.closeAdmission();
    expect(second.reads.getActiveModelName()).toBe('second-model');
    expect(() => first.reads.getActiveProviderName()).toThrow(
      'Session settings owner is closed',
    );
    second.selection.closeAdmission();
  });

  it('rejects missing ownership instead of selecting another root', () => {
    const first = root('first', 'first-model');
    try {
      expect(() => Reflect.construct(SessionProviderReads, [])).toThrow(
        'Provider reads require an explicit session owner',
      );
    } finally {
      first.selection.closeAdmission();
    }
  });

  it('returns an explicit empty state without adopting a neighboring selection', () => {
    const first = root('first', 'first-model');
    const owner = new SessionSettingsOwner(new SettingsService());
    const reads = new SessionProviderReads(
      owner,
      new TestRuntimeProviderManager(),
      () => '',
      () => ({}),
    );
    try {
      expect(reads.providerStatus()).toMatchObject({
        providerName: null,
        modelName: null,
        displayLabel: 'unknown',
      });
      expect(() => reads.getActiveProviderName()).toThrow(
        'No active provider is configured.',
      );
    } finally {
      first.selection.closeAdmission();
      owner.closeAdmission();
    }
  });
});
