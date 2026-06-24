/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P12
 * @requirement:REQ-008
 * @requirement:REQ-004
 *
 * getProviderStatus() winner-projection behavior (REQ-008 precedence). The
 * status object surfaces keyName ONLY when the resolved winner is 'keyName',
 * keyFile ONLY when the winner is 'keyfile', and baseUrl whenever a baseUrl is
 * configured — independent of the auth winner. Behavioral integration tests
 * against a real public Agent over a real FakeProvider (LLXPRT_FAKE_RESPONSES
 * seam). No mock theater — only value assertions on the public ProviderStatus.
 */

import { describe, it, expect } from 'vitest';
import { buildAgent } from './helpers/agentHarness.js';

describe('getProviderStatus winner projection @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', () => {
  it('a raw key masks a still-resolved named key: keyName is suppressed in status while retained internally @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      auth: { keyName: 'cli-named-key' },
    });
    try {
      // Resolve the named key so it becomes the keyName winner and is surfaced.
      await agent.auth.keys.use('cli-named-key', { provider: 'openai' });
      const withName = agent.getProviderStatus();
      expect(withName.keyName).toBe('cli-named-key');
      expect(withName.authStatus).toBe('authenticated');

      // Set a raw key. Raw is highest precedence, so the WINNER is no longer
      // 'keyName' even though the named key is still resolved internally. The
      // status must therefore NOT surface keyName — keyName is gated on
      // (winner === 'keyName' AND keyName present). An OR/always-true mutant on
      // that guard would wrongly leak the masked name.
      await agent.auth.keys.setRaw('sk-raw-masks-name', { provider: 'openai' });
      const masked = agent.getProviderStatus();
      expect(masked.authStatus).toBe('authenticated');
      // the keyName property is entirely ABSENT (not present-with-undefined):
      // an always-true guard mutant would inject the key, so assert on presence.
      expect('keyName' in masked).toBe(false);

      // Clearing the raw key restores the named key as the surfaced winner,
      // proving the name was retained (not destroyed) while masked.
      await agent.auth.keys.setRaw(null, { provider: 'openai' });
      const restored = agent.getProviderStatus();
      expect(restored.keyName).toBe('cli-named-key');
      expect(restored.authStatus).toBe('authenticated');
    } finally {
      await cleanup();
    }
  });

  it('a keyfile winner surfaces BOTH the keyFile and a configured baseUrl together and omits keyName @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      auth: {
        apiKeyFile: '/tmp/keyfile-with-base.txt',
        baseUrl: 'https://gw.example/v1',
      },
    });
    try {
      const status = agent.getProviderStatus();
      // keyfile is the winner → keyFile is surfaced verbatim
      expect(status.keyFile).toBe('/tmp/keyfile-with-base.txt');
      // a configured baseUrl is surfaced independently of the auth winner
      expect(status.baseUrl).toBe('https://gw.example/v1');
      // keyfile (not keyName) is the winner → keyName must be absent
      expect(status.keyName).toBeUndefined();
      expect(status.authStatus).toBe('authenticated');
    } finally {
      await cleanup();
    }
  });

  it('a raw key masks a configured keyfile: keyFile is absent from status while the keyfile remains configured @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      auth: { apiKeyFile: '/tmp/masked-keyfile.txt' },
    });
    try {
      // keyfile is the sole source → it is the winner and is surfaced.
      const baseline = agent.getProviderStatus();
      expect(baseline.keyFile).toBe('/tmp/masked-keyfile.txt');

      // A raw key outranks the keyfile. The winner is no longer 'keyfile', so
      // keyFile must be ABSENT (not present-with-undefined). An always-true
      // guard mutant would inject the masked keyfile path.
      await agent.auth.keys.setRaw('sk-raw-masks-file', { provider: 'openai' });
      const masked = agent.getProviderStatus();
      expect('keyFile' in masked).toBe(false);

      // Clearing the raw key restores the keyfile as the surfaced winner,
      // proving the keyfile config was retained while masked.
      await agent.auth.keys.setRaw(null, { provider: 'openai' });
      const restored = agent.getProviderStatus();
      expect(restored.keyFile).toBe('/tmp/masked-keyfile.txt');
    } finally {
      await cleanup();
    }
  });

  it('with no auth source the status is unauthenticated and omits keyName, keyFile, and baseUrl entirely @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-004 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
    });
    try {
      const status = agent.getProviderStatus();
      expect(status.provider).toBe('openai');
      expect(status.authStatus).toBe('unauthenticated');
      // none of the optional winner fields are present (each is gated on a
      // `x !== undefined` guard; an always-true mutant would inject the key).
      expect('keyName' in status).toBe(false);
      expect('keyFile' in status).toBe(false);
      expect('baseUrl' in status).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('seedAuthState: an inline apiKey alone authenticates the provider without surfacing any keyName/keyFile/baseUrl @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      auth: { apiKey: 'sk-inline-secret' },
    });
    try {
      // The inline key is recorded as present (inlineKeyPresent) at seed time,
      // making the provider authenticated. A mutant that drops the inline-key
      // seeding (or flips the `apiKey !== undefined` guard) would report
      // 'unauthenticated' here.
      const status = agent.getProviderStatus();
      expect(status.authStatus).toBe('authenticated');
      // the inline key is a raw secret, never echoed as a named/file source
      expect('keyName' in status).toBe(false);
      expect('keyFile' in status).toBe(false);
      // the auth status() control surface agrees
      expect(agent.auth.status('openai')).toBe('authenticated');
    } finally {
      await cleanup();
    }
  });

  it('seedAuthState: a configured apiKeyFile authenticates and is surfaced verbatim as keyFile @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      auth: { apiKeyFile: '/seed/keyfile.txt' },
    });
    try {
      // seedAuthState assigns authState.keyFile from auth.apiKeyFile; the
      // keyfile becomes the winner and is surfaced verbatim. A mutant that
      // skips the keyFile seed would leave the provider unauthenticated and
      // omit the keyFile field.
      const status = agent.getProviderStatus();
      expect(status.authStatus).toBe('authenticated');
      expect(status.keyFile).toBe('/seed/keyfile.txt');
    } finally {
      await cleanup();
    }
  });

  it('seedAuthState: a configured keyName is seeded onto provider state and surfaced once resolved as the winner @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      auth: { keyName: 'seeded-name', baseUrl: 'https://seed.example/v1' },
    });
    try {
      // seedAuthState assigns providerState.keyName from auth.keyName (L376)
      // and authState.baseUrl from auth.baseUrl (L372). The named key is the
      // winner, so both keyName and baseUrl are surfaced. A mutant that skips
      // the keyName seed (or flips the `keyName !== undefined` guard) would
      // omit keyName; a mutant that drops the baseUrl seed would omit baseUrl.
      const status = agent.getProviderStatus();
      expect(status.keyName).toBe('seeded-name');
      expect(status.baseUrl).toBe('https://seed.example/v1');
      expect(status.authStatus).toBe('authenticated');
    } finally {
      await cleanup();
    }
  });
});
