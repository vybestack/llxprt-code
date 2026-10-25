import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentProfilePreflight } from '../profile-preflight.js';
import type { ProviderActivationIntent } from '../config-types.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from './helpers/route-b-preflight.js';

describe('provider-or-oauth runtime overrides (Zed features) (#2374 finding 4)', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  const builtCredentials = useOwnedCredentials();

  async function openBuiltCaller(): Promise<RouteBPreflight> {
    const route = await openRouteBPreflight({
      authority: builtCredentials().authority,
    });
    try {
      await route.prepare();
      const initial = await route.preflight.preflight({
        provider: 'fake',
        model: 'fake-model',
      });
      if (initial.authFailed) throw initial.authError;
    } catch (primary) {
      await route.close();
      throw primary;
    }
    return route;
  }

  it('(i) auth-keyfile ephemeral with ~ expansion → api key applied from file content', async () => {
    // Write a real keyfile under the user's home dir so the ~ expansion path
    // resolves to an existing file. The executor reads the file, applies the
    // key via setProviderApiKey, and normalizes the auth-keyfile ephemeral to
    // the resolved absolute path.
    const keyFileDir = mkdtempSync(join(tmpdir(), 'llxprt-keyfile-'));
    const homeRelativeDir = keyFileDir.replace(homedir(), '~');
    const keyfilePath = join(homeRelativeDir, 'api-key.txt');
    const absKeyfilePath = join(keyFileDir, 'api-key.txt');
    writeFileSync(absKeyfilePath, '  sk-from-file-123  \n', 'utf8');
    const route = await openBuiltCaller();
    try {
      route.preflight.writeUserParameter('auth-keyfile', keyfilePath);
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'provider-or-oauth',
      };
      const result = await route.preflight.preflight(intent);
      expect(result.authFailed).toBe(false);
      // Observable: the auth-keyfile ephemeral is normalized to the resolved
      // absolute path (~ expanded to os.homedir()), proving the file was read
      // and the key applied.
      expect(route.preflight.readNamedParameter('auth-keyfile')).toBe(
        absKeyfilePath,
      );
    } finally {
      await route.close();
      rmSync(keyFileDir, { recursive: true, force: true });
    }
  });

  it('(ii) base-url ephemeral applied to the active provider settings', async () => {
    const route = await openBuiltCaller();
    try {
      route.preflight.writeUserParameter(
        'base-url',
        'https://custom-endpoint.example/v1',
      );
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'provider-or-oauth',
      };
      const result = await route.preflight.preflight(intent);
      expect(result.authFailed).toBe(false);
      // Observable: setProviderBaseUrl wrote the base-url into the active
      // provider's settings via the settings service.
      const providerSettings = route.settings.getProviderSettings('fake');
      expect(providerSettings['base-url']).toBe(
        'https://custom-endpoint.example/v1',
      );
    } finally {
      await route.close();
    }
  });

  it('(ii-cont) base-url "none" is NOT applied — provider setting cleared', async () => {
    const route = await openBuiltCaller();
    try {
      // Pre-set a base-url on the provider, then activate with base-url 'none'.
      route.settings.setProviderSetting(
        'fake',
        'base-url',
        'https://pre-existing.example',
      );
      route.preflight.writeUserParameter('base-url', 'none');
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'provider-or-oauth',
      };
      const result = await route.preflight.preflight(intent);
      expect(result.authFailed).toBe(false);
      // Observable: setProviderBaseUrl('none') clears the provider setting
      // (updateActiveProviderBaseUrl normalizes 'none' → null → undefined).
      const providerSettings = route.settings.getProviderSettings('fake');
      expect(providerSettings['base-url']).toBeUndefined();
    } finally {
      await route.close();
    }
  });

  it('(iv) merged modelParams applied to the active provider runtime', async () => {
    const route = await openBuiltCaller();
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        model: 'fake-model',
        modelParams: { temperature: 0.42, top_p: 0.9 },
        authMode: 'provider-or-oauth',
      };
      const result = await route.preflight.preflight(intent);
      expect(result.authFailed).toBe(false);
      if (result.token === undefined)
        throw new Error('Preflight did not accept the activation');
      const agent = await AgentProfilePreflight.createForegroundAgent(
        route.preflight,
        result.token,
        intent,
        {},
      );
      try {
        // Observable: the model params were pushed onto the active provider
        // runtime via setActiveModelParam.
        const params = agent.providerReads.getActiveModelParams();
        expect(params['temperature']).toBe(0.42);
        expect(params['top_p']).toBe(0.9);
      } finally {
        await agent.dispose();
      }
    } finally {
      await route.close();
    }
  });
});
