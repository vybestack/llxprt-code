/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { buildAgent } from './helpers/agentHarness.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { updateActiveProviderApiKey } from '../providerMutations.js';
import { AuthKeysControl } from '../control/authKeysControl.js';
import { createAgentAuthState } from '../control/authState.js';

describe('agent raw credential mutations', () => {
  it.each([
    'agentImpl.ts',
    'profileApplication.ts',
    'providerMutations.ts',
    'providerConfigUtils.ts',
    'settingsResolver.ts',
    'keyResolution.ts',
  ])('keeps %s independent of provider runtime policy', async (file) => {
    const source = await readFile(
      new URL(`../${file}`, import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('@vybestack/llxprt-code-providers/runtime');
  });

  it('returns Gemini paid-mode transitions from the real credential mutation', async () => {
    const settings = new SettingsService();
    const state = createAgentAuthState();
    const keys = new AuthKeysControl({
      authState: state,
      getKeyName: () => undefined,
      setKeyName: () => {},
      updateProviderApiKey: (key) =>
        updateActiveProviderApiKey(
          key,
          { setEphemeralSetting: (name, value) => settings.set(name, value) },
          settings,
          {
            name: 'gemini',
            isPaidMode: () =>
              typeof settings.getProviderSettings('gemini')['auth-key'] ===
              'string',
          },
        ),
    });
    const updated = await keys.setRaw(' gemini-secret ');
    expect(updated.isPaidMode).toBe(true);
    expect(updated.message).toContain('WARNING: Gemini now runs in paid mode.');
    const cleared = await keys.setRaw(null);
    expect(cleared.isPaidMode).toBe(false);
    expect(cleared.message).toContain(
      'You are now using OAuth (no paid usage).',
    );
    expect(state.rawKeyPresent).toBe(false);
  });

  it('propagates a real mutator failure and retains the previous raw-key state', async () => {
    const settings = new SettingsService();
    const state = createAgentAuthState();
    const keys = new AuthKeysControl({
      authState: state,
      getKeyName: () => undefined,
      setKeyName: () => {},
      updateProviderApiKey: (key) =>
        updateActiveProviderApiKey(
          key,
          { setEphemeralSetting: (name, value) => settings.set(name, value) },
          settings,
          undefined,
        ),
    });
    await expect(keys.setRaw('rejected-secret')).rejects.toThrow(
      'No active provider is available.',
    );
    expect(state.rawKeyPresent).toBe(false);
    expect(settings.get('auth-key')).toBeUndefined();
  });

  it('keeps profile persistence independent of provider runtime mutations', async () => {
    const source = await readFile(
      new URL('../profilePersistenceAssembly.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('@vybestack/llxprt-code-providers/runtime');
    expect(source).not.toContain('setAgentSelectedModel');
  });

  it('returns the committed provider result and clears competing credential references', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      agent.settings.setEphemeralSetting('auth-keyfile', '/unused/key');
      agent.settings.setEphemeralSetting('auth-key-name', 'unused-key');
      const updated = await agent.auth.keys.setRaw('  session-secret  ');
      expect(updated).toMatchObject({
        changed: true,
        providerName: 'fake',
        message: "API key updated for provider 'fake'",
      });
      expect(agent.settings.getEphemeralSetting('auth-key')).toBe(
        'session-secret',
      );
      expect(
        agent.settings.getEphemeralSetting('auth-keyfile'),
      ).toBeUndefined();
      expect(
        agent.settings.getEphemeralSetting('auth-key-name'),
      ).toBeUndefined();
      expect(agent.auth.status('fake')).toBe('authenticated');
      const cleared = await agent.auth.keys.setRaw('   ');
      expect(cleared).toMatchObject({
        changed: true,
        providerName: 'fake',
        message: "API key removed for provider 'fake'",
      });
      expect(agent.settings.getEphemeralSetting('auth-key')).toBeUndefined();
      expect(agent.auth.status('fake')).toBe('unauthenticated');
    } finally {
      await cleanup();
    }
  });

  it('propagates rejected writes without publishing a successful auth state', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await agent.dispose();
      await expect(agent.auth.keys.setRaw('rejected-secret')).rejects.toThrow(
        'Session settings owner is closed',
      );
      expect(agent.auth.status('fake')).toBe('unauthenticated');
    } finally {
      await cleanup();
    }
  });
});
