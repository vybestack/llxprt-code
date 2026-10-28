/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from './SettingsService.js';
import { captureSettingsSnapshot } from './settings-snapshot-input.js';

describe('external settings snapshot capture', () => {
  it('retains private provider credentials, tools and explicit undefined while separating nested caller data', () => {
    const source = new SettingsService();
    source.set('activeProvider', 'openai');
    source.setProviderSetting('openai', 'model', 'captured-model');
    source.setProviderSetting('openai', 'auth-key', 'private-owner-key');
    source.setProviderSetting('openai', 'modelParams', { temperature: 0.37 });
    source.set('tools.allowed', ['read_file']);
    const input = {
      ...source.exportForStateSnapshot(),
      tools: {
        allowed: ['read_file'],
        disabled: ['run_shell_command'],
        apiKeys: { report: 'private-tool-key' },
      },
    };
    input.global['explicit-undefined'] = undefined;
    const captured = captureSettingsSnapshot(input);
    source.setProviderSetting('openai', 'auth-key', 'later-source-key');
    input.global['activeProvider'] = 'gemini';
    input.providers.openai = undefined;
    input.tools.allowed.push('run_shell_command');
    const restored = new SettingsService();
    restored.restoreFromStateSnapshot(captured);
    expect(restored.get('activeProvider')).toBe('openai');
    expect(restored.getProviderSettings('openai')['auth-key']).toBe(
      'private-owner-key',
    );
    expect(restored.getProviderSettings('openai').modelParams).toStrictEqual({
      temperature: 0.37,
    });
    expect(restored.exportForStateSnapshot().tools?.allowed).toStrictEqual([
      'read_file',
    ]);
    expect(
      Object.prototype.hasOwnProperty.call(
        restored.exportForStateSnapshot().global,
        'explicit-undefined',
      ),
    ).toBe(true);
    expect(restored.exportForStateSnapshot().tools?.apiKeys?.report).toBe(
      'private-tool-key',
    );
    restored.setProviderSetting('openai', 'model', 'restored-only');
    expect(source.getProviderSettings('openai').model).toBe('captured-model');
  });
  it.each([
    null,
    { global: {}, providers: [] },
    { global: { callback: () => undefined }, providers: {} },
    { global: {}, providers: { openai: 'not-a-record' } },
    { global: {}, providers: {}, tools: { allowed: 'read_file' } },
    { global: JSON.parse('{"__proto__":{"polluted":true}}'), providers: {} },
    { global: { nested: new Date() }, providers: {} },
  ])('rejects malformed or executable external settings data %#', (input) => {
    expect(() => captureSettingsSnapshot(input)).toThrow(
      'Invalid settings snapshot',
    );
  });
  it('rejects cycles without overflowing and preserves missing provider records', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      captureSettingsSnapshot({ global: cyclic, providers: {} }),
    ).toThrow('Invalid settings snapshot');
    const captured = captureSettingsSnapshot({
      global: {},
      providers: { absent: undefined },
    });
    expect(
      Object.prototype.hasOwnProperty.call(captured.providers, 'absent'),
    ).toBe(true);
    expect(captured.providers.absent).toBeUndefined();
  });
});
