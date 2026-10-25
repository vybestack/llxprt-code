/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'bun:test';
import { OutputFormat } from '@vybestack/llxprt-code-core';
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from '../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import {
  openRouteAAgent,
  type RouteAAgent,
} from '../../agents/src/api/__tests__/helpers/route-a-agent.js';
import { LoadedSettings } from './config/settings.js';
import { validateNonInteractiveAuth } from './validateNonInteractiveAuth.js';
import {
  guardUnconfiguredProvider,
  isProviderConfigured,
  UNCONFIGURED_PROVIDER_MESSAGE,
} from './unconfiguredProviderGuard.js';

function compressionSettings(): LoadedSettings {
  const file = {
    path: '',
    settings: {
      useExternalAuth: false,
      'compression-threshold': 0.5,
      'context-limit': 100000,
    },
  };
  return new LoadedSettings(file, file, file, file, true);
}

// The host owns the SettingsService it hands to fromConfig; blanking its
// activeProvider entry is the stored state ProviderManager.clearActiveProvider
// writes, so the agent reports no active provider afterwards.
function clearProvider(root: RouteAAgent): void {
  root.settings.set('activeProvider', '');
}

const config = {
  getProvider: () => 'fake',
  getOutputFormat: () => OutputFormat.TEXT,
  isInteractive: () => false,
};

describe('configured-provider predicate ownership', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  const credentials = useOwnedCredentials();
  const roots: RouteAAgent[] = [];
  const makeOwner = async (label: string): Promise<RouteAAgent> => {
    const root = await openRouteAAgent({
      authority: credentials().authority,
      config: { model: `${label}-initial`, lsp: false },
      intent: {
        sessionId: 'same-command-owner-label',
        activation: { provider: 'fake', model: `${label}-initial` },
      },
    });
    roots.push(root);
    return root;
  };
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) await root.close();
  });

  it('reads a captured Agent predicate live without borrowing a sibling provider state', async () => {
    const owner = await makeOwner('predicate-owner');
    const peer = await makeOwner('predicate-peer');
    const hasActiveProvider = owner.agent.hasActiveProvider;
    const peerHasActiveProvider = peer.agent.hasActiveProvider;
    clearProvider(peer);

    expect(isProviderConfigured(hasActiveProvider)).toBe(true);
    expect(isProviderConfigured(peerHasActiveProvider)).toBe(false);
    clearProvider(owner);
    expect(isProviderConfigured(hasActiveProvider)).toBe(false);
    await peer.agent.setProvider('fake');
    expect(isProviderConfigured(hasActiveProvider)).toBe(false);
    expect(isProviderConfigured(peerHasActiveProvider)).toBe(true);
    await owner.agent.setProvider('fake');
    await guardUnconfiguredProvider(
      config,
      async () => {
        throw new Error('Configured owner must not run exit cleanup');
      },
      hasActiveProvider,
    );
  });

  it('applies compression only after the live owner gate while a sibling is unconfigured', async () => {
    const owner = await makeOwner('compression-owner');
    const peer = await makeOwner('compression-peer');
    const hasActiveProvider = owner.agent.hasActiveProvider;
    clearProvider(peer);
    const applied: string[] = [];
    const validation = validateNonInteractiveAuth(
      undefined,
      config,
      compressionSettings(),
      async () => {
        throw new Error('Configured owner must not run exit cleanup');
      },
      hasActiveProvider,
      (key, value) => {
        applied.push(key);
        owner.agent.setEphemeralSetting(key, value);
      },
    );

    expect(applied).toStrictEqual([]);
    expect(await validation).toBe(config);
    expect(applied).toStrictEqual(['compression-threshold', 'context-limit']);
    expect(owner.agent.getEphemeralSetting('compression-threshold')).toBe(0.5);
    expect(owner.agent.getEphemeralSetting('context-limit')).toBe(100000);
    expect(
      peer.agent.getEphemeralSetting('compression-threshold'),
    ).toBeUndefined();
    expect(peer.agent.getEphemeralSetting('context-limit')).toBeUndefined();
  });

  it('observes owner deactivation after predicate capture and reports then cleans up before exit 52 without compression', async () => {
    const owner = await makeOwner('unconfigured-owner');
    await makeOwner('configured-peer');
    const hasActiveProvider = owner.agent.hasActiveProvider;
    clearProvider(owner);
    const events: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk));
      events.push('report');
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      events.push(`exit:${code}`);
      throw new Error(`process.exit(${code}) called`);
    });

    const validation = validateNonInteractiveAuth(
      true,
      config,
      compressionSettings(),
      async () => {
        events.push('cleanup-start');
        await Promise.resolve();
        events.push('cleanup-finished');
      },
      hasActiveProvider,
      (key, value) => owner.agent.setEphemeralSetting(key, value),
    );

    expect(events).toStrictEqual(['report', 'cleanup-start']);
    await expect(validation).rejects.toThrow('process.exit(52) called');
    expect(stderr.join('')).toBe(UNCONFIGURED_PROVIDER_MESSAGE + '\n');
    expect(events).toStrictEqual([
      'report',
      'cleanup-start',
      'cleanup-finished',
      'exit:52',
    ]);
    expect(
      owner.agent.getEphemeralSetting('compression-threshold'),
    ).toBeUndefined();
    expect(owner.agent.getEphemeralSetting('context-limit')).toBeUndefined();
  });
});
