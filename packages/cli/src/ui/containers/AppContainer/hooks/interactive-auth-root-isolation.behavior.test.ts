/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import {
  MemoryTokenStore,
  makeToken,
} from '../../../../../../providers/src/auth/__tests__/behavioral/test-utils.js';
import { assembleSessionAuthentication } from '@vybestack/llxprt-code-agents';
import { renderHook } from '../../../../__tests__/render.js';
import { useUpdateAndOAuthBridges } from './useUpdateAndOAuthBridges.js';

function heldLogin() {
  const store = new MemoryTokenStore();
  const manager = new OAuthManager(store, undefined, {
    readAuthIdentity: () => ({
      runtimeId: 'same-label',
      runtimeKind: 'subagent',
    }),
  });
  let signal: AbortSignal | undefined;
  let finish: () => void = () => {
    throw new Error('Login has not started');
  };
  manager.registerProvider({
    name: 'same-provider',
    initiateAuth: async (input) => {
      signal = input;
      await new Promise<void>((resolve, reject) => {
        finish = resolve;
        input?.addEventListener('abort', () => reject(input.reason), {
          once: true,
        });
      });
      return makeToken('completed-login');
    },
    getToken: async () => null,
    refreshToken: async () => null,
  });
  const messages: string[] = [];
  const providers = new ProviderManager(
    undefined,
    undefined,
    undefined,
    undefined,
    new SettingsService(),
  );
  const control = assembleSessionAuthentication(manager, (provider) => {
    const instance = providers.getProviderByName(provider);
    if (
      instance &&
      'clearClientCache' in instance &&
      typeof instance.clearClientCache === 'function'
    )
      instance.clearClientCache();
  });
  return {
    manager,
    messages,
    store,
    providers,
    control,
    signal: () => signal,
    finish: () => finish(),
  };
}

describe('interactive OAuth root ownership', () => {
  it('keeps identical live challenges separate and lets B finish after A CLI unmounts', async () => {
    const a = heldLogin();
    const b = heldLogin();
    await a.manager.toggleOAuthEnabled('same-provider');
    await b.manager.toggleOAuthEnabled('same-provider');
    const mount = (root: ReturnType<typeof heldLogin>) =>
      renderHook(() =>
        useUpdateAndOAuthBridges({
          addItem: (item) => {
            if ('text' in item && typeof item.text === 'string')
              root.messages.push(item.text);
            return 1;
          },
          setUpdateInfo: () => undefined,
          oauthControl: root.control,
        }),
      );
    const aHost = mount(a);
    const bHost = mount(b);
    const child = new OAuthManager(b.store, undefined, {
      readAuthIdentity: () => ({
        runtimeId: 'child-b',
        runtimeKind: 'subagent',
      }),
      requestInteractiveAuth: (prompt) =>
        b.manager.requestInteractiveAuth(prompt),
    });
    child.registerProvider({
      name: 'same-provider',
      initiateAuth: async () => {
        throw new Error('Child cannot launch browser');
      },
      getToken: async () => null,
      refreshToken: async () => null,
    });
    await child.toggleOAuthEnabled('same-provider');
    const aRequest = a.manager
      .getToken('same-provider', 'same-bucket')
      .catch((error: unknown) => error);
    const bRequest = child
      .getToken('same-provider', 'same-bucket')
      .catch((error: unknown) => error);
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(a.signal()).toBeInstanceOf(AbortSignal);
      expect(b.signal()).toBeInstanceOf(AbortSignal);
      expect(a.signal()).not.toBe(b.signal());
      expect(
        a.messages.filter((text) => text.startsWith('Waiting for')),
      ).toHaveLength(1);
      expect(
        b.messages.filter((text) => text.startsWith('Waiting for')),
      ).toHaveLength(1);
      aHost.unmount();
      expect(a.signal()?.aborted).toBe(true);
      expect(b.signal()?.aborted).toBe(false);
      expect(await aRequest).toMatchObject({ outcomeKind: 'cancelled' });
      await a.manager.dispose();
      b.finish();
      expect(await bRequest).toBe('completed-login');
      expect(await b.manager.getToken('same-provider', 'same-bucket')).toBe(
        'completed-login',
      );
      const later = child.getToken('same-provider', 'later-bucket');
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(b.signal()?.aborted).toBe(false);
      b.finish();
      expect(await later).toBe('completed-login');
      expect(
        b.messages.some(
          (text) => text.includes('later-bucket') && text.includes('completed'),
        ),
      ).toBe(true);
      expect(a.messages.some((text) => text.includes('later-bucket'))).toBe(
        false,
      );
    } finally {
      aHost.unmount();
      bHost.unmount();
      await Promise.all([aRequest, bRequest]);
      await Promise.all([
        a.manager.dispose(),
        b.manager.dispose(),
        child.dispose(),
      ]);
      a.providers.dispose();
      b.providers.dispose();
    }
  });
});
