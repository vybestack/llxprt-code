import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { blockTextOrEmpty } from '@vybestack/llxprt-code-test-utils';
import { AgentProfilePreflight } from '../profile-preflight.js';
import type { ProviderActivationIntent } from '../config-types.js';
import { openClientOwner } from './helpers/client-owner-session.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for declarative provider-activation / auth intent (#2374,
 * part of #1595). These assert on RESULTING STATE (active provider name,
 * ephemeral values, authFailed flag, config auth state), never on mock call
 * counts. The first scenario runs the foreground preflight route a host takes;
 * the second takes the domain-level form because its subject is the session
 * client owner's content generator.
 */

async function activatedReply(client: AgentClientContract): Promise<string> {
  const output = await client.generateDirectMessage(
    { message: 'Generate after provider activation' },
    'activation-proof',
  );
  return output.content.blocks.map(blockTextOrEmpty).join('');
}

describe('provider-or-oauth branches on fresh post-switch state (#2374 finding 2)', () => {
  const useFixture = useFakeResponsesReplay('plain-text.jsonl');

  const builtCredentials = useOwnedCredentials();

  it('intent with provider + provider-or-oauth takes the provider branch after successful activation', async () => {
    useFixture('plain-text-two-turns.jsonl');
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
      // The FakeProvider is registered and active after the first activation.
      // An intent that re-activates 'fake' in provider-or-oauth mode must take
      // the provider branch (refreshAuth('provider') +
      // ensureProviderManagerOnConfig), NOT the oauth branch.
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'provider-or-oauth',
      };
      const result = await route.preflight.preflight(intent);
      expect(result.authFailed).toBe(false);
      expect(result.activeProvider).toBe('fake');
      expect(route.preflight.getActiveProviderName()).toBe('fake');
      if (result.token === undefined)
        throw new Error('Preflight did not accept the activation');
      const agent = await AgentProfilePreflight.createForegroundAgent(
        route.preflight,
        result.token,
        intent,
        {},
      );
      try {
        // Provider-branch distinguishing observable: refreshAuth('provider') ran,
        // so the content generator config is populated AND carries the provider
        // manager (the provider-branch ensureProviderManagerOnConfig wired it).
        expect(await agent.generate('Generate after provider activation')).toBe(
          'a plain text reply',
        );
        // A following turn starts the chat on the initialized session client.
        expect((await agent.chat('Continue after activation')).text).toBe(
          'a plain text reply',
        );
      } finally {
        await agent.dispose();
      }
    } finally {
      await route.close();
    }
  });

  it('provider-or-oauth provider branch binds the activated manager to the session generator', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'activation-owner-4-')),
    );
    const opened = await openClientOwner(
      builtCredentials().authority,
      { provider: 'fake', model: 'fake-model', workingDir: directory },
      { provider: 'fake', authMode: 'provider-or-oauth' },
    ).catch(async (error: unknown) => {
      await rm(directory, { recursive: true, force: true });
      throw error;
    });
    try {
      // The provider branch calls ensureProviderManagerOnConfig +
      // attachProviderManagerToContentConfig, so the content generator config
      // carries the provider manager. This is the provider-branch-only side
      // effect that distinguishes it from a hypothetical no-manager path.
      expect(await activatedReply(opened.client)).toBe('a plain text reply');
      await opened.client.startChat();
      expect(
        await opened.client.getContentGenerator().countTokens({
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'model admission boundary' }],
            },
          ],
        }),
      ).toStrictEqual({ totalTokens: 6 });
    } finally {
      await opened.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
