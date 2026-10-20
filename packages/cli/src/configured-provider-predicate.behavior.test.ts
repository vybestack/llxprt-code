/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'bun:test';
import { OutputFormat } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import {
  useCommandOwners,
  commandOwnerManager,
} from './__tests__/command-owner-fixture.js';
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

function clearProvider(agent: Agent): void {
  const manager = commandOwnerManager(agent);
  if (!(manager instanceof ProviderManager)) {
    throw new Error('Expected the real Agent provider manager');
  }
  manager.clearActiveProvider();
}

const config = {
  getProvider: () => 'fake',
  getOutputFormat: () => OutputFormat.TEXT,
  isInteractive: () => false,
};

describe('configured-provider predicate ownership', () => {
  const makeOwner = useCommandOwners();
  afterEach(() => vi.restoreAllMocks());

  it('reads a captured Agent predicate live without borrowing a sibling provider state', async () => {
    const owner = await makeOwner('predicate-owner');
    const peer = await makeOwner('predicate-peer');
    const hasActiveProvider = owner.hasActiveProvider;
    const peerHasActiveProvider = peer.hasActiveProvider;
    clearProvider(peer);

    expect(isProviderConfigured(hasActiveProvider)).toBe(true);
    expect(isProviderConfigured(peerHasActiveProvider)).toBe(false);
    clearProvider(owner);
    expect(isProviderConfigured(hasActiveProvider)).toBe(false);
    await commandOwnerManager(peer).setActiveProvider('fake');
    expect(isProviderConfigured(hasActiveProvider)).toBe(false);
    expect(isProviderConfigured(peerHasActiveProvider)).toBe(true);
    await commandOwnerManager(owner).setActiveProvider('fake');
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
    const hasActiveProvider = owner.hasActiveProvider;
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
        owner.setEphemeralSetting(key, value);
      },
    );

    expect(applied).toStrictEqual([]);
    expect(await validation).toBe(config);
    expect(applied).toStrictEqual(['compression-threshold', 'context-limit']);
    expect(owner.getEphemeralSetting('compression-threshold')).toBe(0.5);
    expect(owner.getEphemeralSetting('context-limit')).toBe(100000);
    expect(peer.getEphemeralSetting('compression-threshold')).toBeUndefined();
    expect(peer.getEphemeralSetting('context-limit')).toBeUndefined();
  });

  it('observes owner deactivation after predicate capture and reports then cleans up before exit 52 without compression', async () => {
    const owner = await makeOwner('unconfigured-owner');
    await makeOwner('configured-peer');
    const hasActiveProvider = owner.hasActiveProvider;
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
      (key, value) => owner.setEphemeralSetting(key, value),
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
    expect(owner.getEphemeralSetting('compression-threshold')).toBeUndefined();
    expect(owner.getEphemeralSetting('context-limit')).toBeUndefined();
  });
});
