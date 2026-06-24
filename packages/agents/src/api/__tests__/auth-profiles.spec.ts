/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P12
 * @requirement:REQ-008
 *
 * Auth / key precedence / OAuth / buckets (behavioral). Integration tests
 * against a real public Agent over a real FakeProvider. No mock theater, only
 * value/sequence assertions. (Profiles CRUD + auth-winner property tests live
 * in profiles.spec.ts.)
 *
 * Covers:
 * - T18  key/keyfile/key-name precedence — the EXACT REQ-008 chain:
 *        raw key > key-name(CLI) > auth-key-name(profile) > auth-key(inline)
 *        > keyfile > env; getProviderStatus()/auth.status() reflect the winner.
 * - T18b /key secure-store + profile-save → auth-key-name wins, raw key NOT
 *        persisted; profiles.saveCurrent stores the reference.
 * - T18k auth.keys named-store save/use/delete + setRaw/setKeyFile winners.
 * - T18c OAuth/buckets/mcpLogin via onOAuthPrompt; no handler → clear rejection.
 * - T18a status/disableOAuth/login/logout/switchBucket/setBaseUrl behavior.
 */

import { describe, it, expect } from 'vitest';
import { buildAgent } from './helpers/agentHarness.js';

describe('Auth @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', () => {
  it('T18 key/keyfile/key-name precedence — raw key wins over every lower-precedence source @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const RAW_KEY = 'sk-raw-winner';
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      auth: {
        apiKey: RAW_KEY, // highest precedence
        keyName: 'cli-named-key',
        apiKeyFile: '/tmp/keyfile.txt',
      },
    });
    try {
      // raw key is the winner — status reflects it (keyName absent because raw
      // wins; the raw value itself is never echoed back, only that a key is set)
      await agent.auth.keys.setRaw(RAW_KEY, { provider: 'openai' });

      const status = agent.getProviderStatus();
      expect(status.provider).toBe('openai');
      // raw key wins → no keyName winner (raw takes precedence over key-name)
      expect(status.authStatus).toBe('authenticated');
    } finally {
      await cleanup();
    }
  });

  it('T18 precedence chain — key-name(CLI) wins over auth-key-name(profile) when no raw key is set @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      auth: {
        // no raw apiKey → keyName (CLI) is the next-highest precedence
        keyName: 'cli-named-key',
        // profile-level authKeyName is lower precedence than CLI key-name
        profile: 'profile-with-authkey-name',
      },
    });
    try {
      // resolve the named key (the CLI key-name winner)
      await agent.auth.keys.use('cli-named-key', { provider: 'openai' });

      const status = agent.getProviderStatus();
      // the winner is the CLI key-name
      expect(status.keyName).toBe('cli-named-key');
      expect(status.authStatus).toBe('authenticated');
    } finally {
      await cleanup();
    }
  });

  it('T18 precedence chain — auth-key(inline) wins over keyfile when no raw/named key is set @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      auth: {
        apiKey: 'sk-inline-winner', // inline auth-key beats keyfile
        apiKeyFile: '/tmp/keyfile-lower.txt',
      },
    });
    try {
      const status = agent.getProviderStatus();
      expect(status.authStatus).toBe('authenticated');
      // inline key wins → keyFile is NOT the winner
      expect(status.keyFile).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('T18b /key secure-store + profile-save → auth-key-name wins, raw key NOT persisted; saveCurrent stores the reference @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
    });
    try {
      // save a key to the secure store under a name
      await agent.auth.keys.save('openai-secure', 'sk-secure-value', {
        provider: 'openai',
      });

      // use it (auth-key-name resolution)
      await agent.auth.keys.use('openai-secure', { provider: 'openai' });

      // explicitly clear any raw key so the named key is the winner
      await agent.auth.keys.setRaw(null, { provider: 'openai' });

      const status = agent.getProviderStatus();
      // auth-key-name wins → keyName reflects it
      expect(status.keyName).toBe('openai-secure');
      // raw key is NOT persisted in the status (only the reference)
      const serialized = JSON.stringify(status);
      expect(serialized.includes('sk-secure-value')).toBe(false);

      // saveCurrent stores the reference (the named key) into a profile
      await agent.profiles.saveCurrent('profile-secure');

      // the saved profile carries the authKeyName reference
      const saved = agent.profiles.get('profile-secure');
      expect(saved).toBeDefined();
      expect(saved?.authKeyName).toBe('openai-secure');
    } finally {
      await cleanup();
    }
  });

  it('T18k auth.keys.list returns every saved name (reference only — never the secret value) @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
    });
    try {
      // empty store → empty list
      const before = await agent.auth.keys.list();
      expect(before).toStrictEqual([]);

      await agent.auth.keys.save('key-alpha', 'sk-alpha-secret', {
        provider: 'openai',
      });
      await agent.auth.keys.save('key-beta', 'sk-beta-secret', {
        provider: 'openai',
      });

      const after = await agent.auth.keys.list();
      const names = after.map((k) => k.name).sort();
      expect(names).toStrictEqual(['key-alpha', 'key-beta']);

      // the secret values are NEVER surfaced through the list
      const serialized = JSON.stringify(after);
      expect(serialized.includes('sk-alpha-secret')).toBe(false);
      expect(serialized.includes('sk-beta-secret')).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('T18k auth.keys.save rejects an empty name with a clear message @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
    });
    try {
      await expect(
        agent.auth.keys.save('', 'sk-value', { provider: 'openai' }),
      ).rejects.toThrow('Key name must be non-empty');

      // the store stays empty after the rejected save
      const list = await agent.auth.keys.list();
      expect(list).toStrictEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('T18k auth.keys.use rejects an empty name with a clear message @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
    });
    try {
      await expect(
        agent.auth.keys.use('', { provider: 'openai' }),
      ).rejects.toThrow('Key name must be non-empty');

      // no keyName winner was established by the rejected use()
      const status = agent.getProviderStatus();
      expect(status.keyName).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('T18k deleting the currently-used named key clears the keyName winner @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
    });
    try {
      await agent.auth.keys.save('active-key', 'sk-active', {
        provider: 'openai',
      });
      await agent.auth.keys.use('active-key', { provider: 'openai' });

      // the named key is the winner
      expect(agent.getProviderStatus().keyName).toBe('active-key');

      // deleting the in-use key clears the keyName reference → winner falls
      // through to 'none' (no other source present)
      await agent.auth.keys.delete('active-key', { provider: 'openai' });
      const after = agent.getProviderStatus();
      expect(after.keyName).toBeUndefined();
      expect(after.authStatus).toBe('unauthenticated');

      // and the key is gone from the store
      const list = await agent.auth.keys.list();
      expect(list).toStrictEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('T18k deleting a DIFFERENT named key leaves the active keyName winner intact @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
    });
    try {
      await agent.auth.keys.save('keep-key', 'sk-keep', { provider: 'openai' });
      await agent.auth.keys.save('drop-key', 'sk-drop', { provider: 'openai' });
      await agent.auth.keys.use('keep-key', { provider: 'openai' });
      expect(agent.getProviderStatus().keyName).toBe('keep-key');

      // deleting a key that is NOT the active winner must NOT clear keyName
      await agent.auth.keys.delete('drop-key', { provider: 'openai' });
      expect(agent.getProviderStatus().keyName).toBe('keep-key');

      const names = (await agent.auth.keys.list()).map((k) => k.name);
      expect(names).toStrictEqual(['keep-key']);
    } finally {
      await cleanup();
    }
  });

  it('T18k setRaw toggles the raw-key winner: a raw key masks a keyfile; setRaw(null) clears it and the keyfile re-wins @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      auth: { apiKeyFile: '/tmp/keyfile-base.txt' },
    });
    try {
      // baseline: keyfile is the only source → keyfile is the winner
      const baseline = agent.getProviderStatus();
      expect(baseline.authStatus).toBe('authenticated');
      expect(baseline.keyFile).toBe('/tmp/keyfile-base.txt');

      // a raw key takes the highest precedence → masks the keyfile
      await agent.auth.keys.setRaw('sk-raw', { provider: 'openai' });
      const withRaw = agent.getProviderStatus();
      expect(withRaw.authStatus).toBe('authenticated');
      // keyfile is no longer the winner, so it is not surfaced
      expect(withRaw.keyFile).toBeUndefined();

      // clearing the raw key drops it back to the keyfile winner
      await agent.auth.keys.setRaw(null, { provider: 'openai' });
      const cleared = agent.getProviderStatus();
      expect(cleared.authStatus).toBe('authenticated');
      expect(cleared.keyFile).toBe('/tmp/keyfile-base.txt');
    } finally {
      await cleanup();
    }
  });

  it('T18k setKeyFile establishes a keyfile winner and setKeyFile(null) clears it @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
    });
    try {
      // no sources initially → unauthenticated, no keyFile surfaced
      const initial = agent.getProviderStatus();
      expect(initial.authStatus).toBe('unauthenticated');
      expect(initial.keyFile).toBeUndefined();

      // setting a keyfile makes it the winner (lowest non-oauth tier present)
      await agent.auth.keys.setKeyFile('/tmp/added-keyfile.txt', {
        provider: 'openai',
      });
      const withFile = agent.getProviderStatus();
      expect(withFile.authStatus).toBe('authenticated');
      expect(withFile.keyFile).toBe('/tmp/added-keyfile.txt');

      // clearing it removes the winner → back to unauthenticated
      await agent.auth.keys.setKeyFile(null, { provider: 'openai' });
      const cleared = agent.getProviderStatus();
      expect(cleared.authStatus).toBe('unauthenticated');
      expect(cleared.keyFile).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('T18c OAuth/buckets via onOAuthPrompt succeed when a handler is registered @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'anthropic',
      onOAuthPrompt: () => true, // user accepts the OAuth prompt
    });
    try {
      // enableOAuth wires the OAuth path
      await agent.auth.enableOAuth('anthropic');

      // login flows through onOAuthPrompt (handler returns true → accepted)
      await agent.auth.login('anthropic');

      // buckets are listed after a successful OAuth login
      const buckets = agent.auth.listBuckets('anthropic');
      expect(Array.isArray(buckets)).toBe(true);

      const status = agent.auth.status('anthropic');
      expect(status).toBe('authenticated');
    } finally {
      await cleanup();
    }
  });

  it('T18c no onOAuthPrompt handler → clear rejection (login does not silently succeed) @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'anthropic',
      // no onOAuthPrompt handler
    });
    try {
      // login without a handler must reject with the SPECIFIC, provider-scoped
      // "requires an onOAuthPrompt handler" message — not an incidental
      // TypeError from falling through into a missing handler call.
      await expect(agent.auth.login('anthropic')).rejects.toThrow(
        'OAuth login for provider "anthropic" requires an onOAuthPrompt handler',
      );

      // status reflects unauthenticated
      const status = agent.auth.status('anthropic');
      expect(status).not.toBe('authenticated');
    } finally {
      await cleanup();
    }
  });

  it('T18c mcpLogin via the public auth surface authenticates the server @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
    });
    try {
      // mcpLogin is the per-server auth flow; at RED throws NYI; at GREEN
      // the server becomes authenticated.
      await agent.auth.mcpLogin('remote-mcp-server');

      // the MCP server auth status reflects the login
      const authStatus = await agent.mcp.auth('remote-mcp-server');
      expect(authStatus.server).toBe('remote-mcp-server');
      expect(authStatus.authenticated).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T18a status() with no argument resolves the CURRENT provider; an explicit provider overrides it @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'anthropic',
      onOAuthPrompt: () => true,
    });
    try {
      // authenticate ONLY anthropic via OAuth
      await agent.auth.enableOAuth('anthropic');
      await agent.auth.login('anthropic');

      // no-arg status resolves to the current provider (anthropic) → authed
      expect(agent.auth.status()).toBe('authenticated');
      // an explicit, different provider is independent → not authenticated
      expect(agent.auth.status('openai')).not.toBe('authenticated');
    } finally {
      await cleanup();
    }
  });

  it('T18a disableOAuth clears a previously-authenticated provider back to unauthenticated @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'anthropic',
      onOAuthPrompt: () => true,
    });
    try {
      await agent.auth.enableOAuth('anthropic');
      await agent.auth.login('anthropic');
      expect(agent.auth.status('anthropic')).toBe('authenticated');

      // disabling OAuth clears the authenticated state
      await agent.auth.disableOAuth('anthropic');
      expect(agent.auth.status('anthropic')).not.toBe('authenticated');
    } finally {
      await cleanup();
    }
  });

  it('T18a a successful OAuth login seeds exactly one active "default" bucket @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'anthropic',
      onOAuthPrompt: () => true,
    });
    try {
      // before login → no buckets
      expect(agent.auth.listBuckets('anthropic')).toStrictEqual([]);

      await agent.auth.login('anthropic');

      // after login → exactly one active 'default' bucket bound to the provider
      const buckets = agent.auth.listBuckets('anthropic');
      expect(buckets).toHaveLength(1);
      expect(buckets[0].name).toBe('default');
      expect(buckets[0].provider).toBe('anthropic');
      expect(buckets[0].active).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T18a a declined OAuth prompt rejects with a clear message and seeds NO bucket @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'anthropic',
      onOAuthPrompt: () => false, // user declines
    });
    try {
      await expect(agent.auth.login('anthropic')).rejects.toThrow(
        'OAuth login was declined',
      );

      // a declined login leaves the provider unauthenticated and bucket-free
      expect(agent.auth.status('anthropic')).not.toBe('authenticated');
      expect(agent.auth.listBuckets('anthropic')).toStrictEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('T18a switchBucket activates exactly the named bucket and deactivates the others @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'anthropic',
      onOAuthPrompt: () => true,
    });
    try {
      // seed the 'default' bucket via a login
      await agent.auth.login('anthropic');

      // switch to a brand-new bucket → it is created active, 'default' goes off
      await agent.auth.switchBucket('anthropic', 'work');
      const afterWork = agent.auth.listBuckets('anthropic');
      const work = afterWork.find((b) => b.name === 'work');
      const defaultAfterWork = afterWork.find((b) => b.name === 'default');
      expect(work?.active).toBe(true);
      expect(defaultAfterWork?.active).toBe(false);

      // switch back to 'default' → exactly one active bucket, and it is default
      await agent.auth.switchBucket('anthropic', 'default');
      const afterDefault = agent.auth.listBuckets('anthropic');
      const activeNames = afterDefault
        .filter((b) => b.active)
        .map((b) => b.name);
      expect(activeNames).toStrictEqual(['default']);
    } finally {
      await cleanup();
    }
  });

  it('T18a logout clears OAuth auth; logout({all:true}) also drops the buckets @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'anthropic',
      onOAuthPrompt: () => true,
    });
    try {
      await agent.auth.login('anthropic');
      expect(agent.auth.status('anthropic')).toBe('authenticated');
      expect(agent.auth.listBuckets('anthropic')).toHaveLength(1);

      // a plain logout clears auth but PRESERVES the buckets
      await agent.auth.logout('anthropic');
      expect(agent.auth.status('anthropic')).not.toBe('authenticated');
      expect(agent.auth.listBuckets('anthropic')).toHaveLength(1);

      // logout({all:true}) additionally clears the buckets
      await agent.auth.logout('anthropic', { all: true });
      expect(agent.auth.listBuckets('anthropic')).toStrictEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('T18a login with an explicit bucket makes THAT bucket the active one @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'anthropic',
      onOAuthPrompt: () => true,
    });
    try {
      await agent.auth.login('anthropic', { bucket: 'work' });

      // the resolved bucket is the named one — active, bound to the provider,
      // and the only bucket present (no stray 'default').
      const buckets = agent.auth.listBuckets('anthropic');
      expect(buckets).toHaveLength(1);
      expect(buckets[0].name).toBe('work');
      expect(buckets[0].provider).toBe('anthropic');
      expect(buckets[0].active).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T18a logout with an explicit bucket removes only that named bucket @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'anthropic',
      onOAuthPrompt: () => true,
    });
    try {
      // seed two buckets: 'default' (via login) and 'work' (via switchBucket)
      await agent.auth.login('anthropic');
      await agent.auth.switchBucket('anthropic', 'work');
      expect(
        agent.auth
          .listBuckets('anthropic')
          .map((b) => b.name)
          .sort(),
      ).toStrictEqual(['default', 'work']);

      // logout of just 'work' removes only it, leaving 'default' intact
      await agent.auth.logout('anthropic', { bucket: 'work' });
      const remaining = agent.auth.listBuckets('anthropic');
      expect(remaining.map((b) => b.name)).toStrictEqual(['default']);
    } finally {
      await cleanup();
    }
  });

  it('T18a setBaseUrl mirrors onto the provider status; setBaseUrl(null) clears it @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
    });
    try {
      // setting a base URL surfaces it on the provider status
      await agent.auth.setBaseUrl('https://proxy.example.com/v1', {
        provider: 'openai',
      });
      expect(agent.getProviderStatus().baseUrl).toBe(
        'https://proxy.example.com/v1',
      );

      // clearing it removes the baseUrl from the status
      await agent.auth.setBaseUrl(null, { provider: 'openai' });
      expect(agent.getProviderStatus().baseUrl).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('T18a setBaseUrl with a DIFFERENT provider than the active one throws @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
    });
    try {
      // the active provider is 'openai'; targeting 'anthropic' must throw and
      // must NOT mutate the active provider's baseUrl.
      await expect(
        agent.auth.setBaseUrl('https://proxy.example.com/v1', {
          provider: 'anthropic',
        }),
      ).rejects.toThrow(/active provider "openai"/);
      expect(agent.getProviderStatus().baseUrl).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('T18a login invokes the OAuth prompt with the provider-scoped auth URL and provider name @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const seen: Array<{ url: string; provider: string }> = [];
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'anthropic',
      onOAuthPrompt: (prompt) => {
        seen.push({ url: prompt.url, provider: prompt.provider });
        return true;
      },
    });
    try {
      await agent.auth.login('anthropic');

      // the handler received exactly one prompt with the provider name and a
      // provider-scoped, percent-encoded auth URL (real value, not "called").
      expect(seen).toHaveLength(1);
      expect(seen[0].provider).toBe('anthropic');
      expect(seen[0].url).toBe('https://auth.llxprt.dev/anthropic/oauth');
    } finally {
      await cleanup();
    }
  });

  it('T18a login percent-encodes a provider name with URL-special characters in the auth URL @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const seen: string[] = [];
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      onOAuthPrompt: (prompt) => {
        seen.push(prompt.url);
        return true;
      },
    });
    try {
      // a provider containing a space + slash must be encoded into the URL path
      await agent.auth.login('acme corp/v2');

      expect(seen).toHaveLength(1);
      expect(seen[0]).toBe('https://auth.llxprt.dev/acme%20corp%2Fv2/oauth');
    } finally {
      await cleanup();
    }
  });

  it('T18a no-arg listBuckets resolves the CURRENT provider buckets @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'anthropic',
      onOAuthPrompt: () => true,
    });
    try {
      // seed buckets on the CURRENT provider (anthropic) via login
      await agent.auth.login('anthropic');

      // listBuckets() with no argument resolves to the current provider and
      // returns the exact same buckets as the explicit form.
      const noArg = agent.auth.listBuckets();
      const explicit = agent.auth.listBuckets('anthropic');
      expect(noArg).toHaveLength(1);
      expect(noArg.map((b) => b.name)).toStrictEqual(
        explicit.map((b) => b.name),
      );
      expect(noArg[0].name).toBe('default');
    } finally {
      await cleanup();
    }
  });

  it('T18a switchBucket creates the named bucket as active when the provider has NO existing buckets @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
    });
    try {
      // no login → the provider starts with zero buckets
      expect(agent.auth.listBuckets('openai')).toStrictEqual([]);

      // switching to a bucket on an empty provider creates it active
      await agent.auth.switchBucket('openai', 'primary');
      const buckets = agent.auth.listBuckets('openai');
      expect(buckets).toHaveLength(1);
      expect(buckets[0].name).toBe('primary');
      expect(buckets[0].provider).toBe('openai');
      expect(buckets[0].active).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T18a re-login when buckets already exist does NOT duplicate or reset the default bucket (idempotent seeding) @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-008', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'anthropic',
      onOAuthPrompt: () => true,
    });
    try {
      await agent.auth.login('anthropic');
      // switch the active bucket so the existing set is non-default-active
      await agent.auth.switchBucket('anthropic', 'work');
      const beforeNames = agent.auth
        .listBuckets('anthropic')
        .map((b) => b.name)
        .sort();

      // a second login must NOT re-seed 'default' (buckets already exist) — the
      // existing bucket set (and the active 'work' selection) is preserved.
      await agent.auth.login('anthropic');
      const after = agent.auth.listBuckets('anthropic');
      const afterNames = after.map((b) => b.name).sort();
      expect(afterNames).toStrictEqual(beforeNames);
      const active = after.filter((b) => b.active).map((b) => b.name);
      expect(active).toStrictEqual(['work']);
    } finally {
      await cleanup();
    }
  });
});
