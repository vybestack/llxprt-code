/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { createGatedKeyStorage } from './helpers/gated-key-storage.js';
import { OwnedCredentialFixture } from './helpers/owned-credential-fixture.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from './helpers/route-b-preflight.js';
import type { AgentActivationOperation } from '../activationPreflightState.js';

const intent = { provider: 'fake', authMode: 'auto' } as const;

function transferActivation(route: RouteBPreflight): AgentActivationOperation {
  let transferred: AgentActivationOperation | undefined;
  route.preflight.transferActivation((selected) => {
    transferred = selected;
  });
  if (transferred === undefined)
    throw new Error('Missing transferred activation');
  return transferred;
}

describe('activation bootstrap ownership and queued work', () => {
  const selectReplay = useFakeResponsesReplay('plain-text.jsonl');
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
  });

  async function openRoot(
    options: Parameters<typeof openRouteBPreflight>[0],
  ): Promise<{ route: RouteBPreflight; owner: SessionSettingsOwner }> {
    const route = await openRouteBPreflight(options);
    closers.push(() => route.close());
    const owner = new SessionSettingsOwner(route.settings);
    closers.push(() => owner.dispose());
    owner.initializeProviderSelection(
      route.config.getProvider(),
      route.config.getModel(),
    );
    await route.prepare({ settingsOwner: owner });
    return { route, owner };
  }

  it('allows an independent owner to finish while another is blocked', async () => {
    const credentialCheck = await createGatedKeyStorage('held-key', 'secret');
    const credentials = await OwnedCredentialFixture.create(
      undefined,
      credentialCheck.storage,
    );
    closers.push(() => credentials.dispose());

    delete process.env.LLXPRT_FAKE_RESPONSES;
    const blocked = await openRoot({
      authority: credentials.authority,
      config: { interactive: true, provider: 'openai', model: 'gpt-4o' },
    });
    blocked.route.settings.set('auth-key-name', 'held-key');
    const blocked_operation = transferActivation(blocked.route);
    closers.push(async () => {
      credentialCheck.release();
      await blocked_operation.dispose();
    });

    selectReplay('plain-text.jsonl');
    const independent = await openRoot({ config: { interactive: true } });
    const independent_operation = transferActivation(independent.route);
    closers.push(() => Promise.resolve(independent_operation.dispose()));

    independent.owner.writeUserParameter('auth-key', 'independent-key');
    blocked.route.settings.setProviderSetting('claudecode', 'top_p', 0.3);
    const first = blocked_operation.preflight({
      provider: 'claudecode',
      authMode: 'none',
      model: 'blocked-model',
      modelParams: { temperature: 0.2 },
    });
    await credentialCheck.entered;
    blocked.owner.writeUserParameter('auth-key', 'blocked-key');
    const second = await independent_operation.preflight({
      ...intent,
      model: 'independent-model',
      modelParams: { temperature: 0.8, top_p: 0.9 },
    });
    expect(second.token).toBeDefined();
    expect(independent.owner.readSelectedModel()).toBe('independent-model');
    credentialCheck.release();
    expect((await first).token).toBeDefined();
    expect(blocked.route.preflight.getActiveProviderName()).toBe('claudecode');
    expect(blocked.owner.readSelectedModel()).toBe('blocked-model');
    expect(independent.owner.readSelectedModel()).toBe('independent-model');
    const blockedSettings =
      blocked.route.settings.getProviderSettings('claudecode');
    const independentSettings =
      independent.route.settings.getProviderSettings('fake');
    expect(blockedSettings.temperature).toBe(0.2);
    expect(blockedSettings.top_p).toBeUndefined();
    expect(independentSettings.temperature).toBe(0.8);
    expect(independentSettings.top_p).toBe(0.9);
    expect(blockedSettings['auth-key']).toBe('blocked-key');
    expect(independent.owner.readNamedParameter('auth-key')).toBe(
      'independent-key',
    );
    expect(independentSettings['auth-key']).not.toBe('blocked-key');
  });
});
