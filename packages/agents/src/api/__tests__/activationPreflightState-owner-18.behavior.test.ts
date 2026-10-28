/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { CodexOAuthToken } from '@vybestack/llxprt-code-auth';
import {
  startLocalForwardProxy,
  type LocalForwardProxy,
} from '@vybestack/llxprt-code-test-utils/network/local-forward-proxy.js';
import type { AgentActivationOperation } from '../activationPreflightState.js';
import type { AgentProfilePreflight } from '../profile-preflight.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from './helpers/route-b-preflight.js';

const HOST = 'codex-images.invalid';
const IMAGE_PATH = '/chatgpt.com/backend-api/codex/images/generations';
const TRANSPORT_FAILURE = 'Image transport failed';
// The Codex backend reports the proxy's 500 answer in this form.
const REPORTED_FAILURE = 'failed with status 500';
const intent = {
  provider: 'openai',
  model: 'gpt-4o',
  authMode: 'auto',
  cliOverrides: {
    key: 'test-key',
    baseUrl: `http://${HOST}/chatgpt.com/backend-api/codex`,
  },
} as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function transferred(
  preflight: AgentProfilePreflight,
): AgentActivationOperation {
  let activation: AgentActivationOperation | undefined;
  preflight.transferActivation((value) => {
    activation = value;
  });
  if (activation === undefined) throw new Error('Missing activation');
  return activation;
}

describe('activation public admission lifetime', () => {
  const credentials = useOwnedCredentials();

  it('joins a failing image request while closing only its facade admission', async () => {
    const entered = deferred();
    const released = deferred();
    const proxy: LocalForwardProxy = await startLocalForwardProxy({
      [HOST]: async (request) => {
        if (request.path !== IMAGE_PATH)
          return new Response('unexpected path', { status: 404 });
        entered.resolve();
        await released.promise;
        return new Response(TRANSPORT_FAILURE, { status: 500 });
      },
    });
    const token: CodexOAuthToken = {
      access_token: 'image-access',
      refresh_token: 'image-refresh',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      account_id: 'image-account',
    };
    const roots: RouteBPreflight[] = [];
    const open = async (proxyUrl?: string): Promise<RouteBPreflight> => {
      const root = await openRouteBPreflight({
        authority: credentials().authority,
        config: { provider: 'openai', model: 'gpt-4o' },
        ...(proxyUrl === undefined ? {} : { proxy: proxyUrl }),
      });
      roots.push(root);
      await root.prepare();
      return root;
    };
    let finished = false;
    let outcome: Promise<unknown> = Promise.resolve();
    let closed: Promise<void> = Promise.resolve();
    try {
      const imageRoot = await open(proxy.url);
      const otherRoot = await open();
      await credentials().saveToken(0, 'codex', token);
      const accepted = await imageRoot.preflight.preflight(intent);
      expect(accepted.authFailed).toBe(false);
      const operation = transferred(imageRoot.preflight);
      const request = operation.sessionClient.runImageOperation({
        prompt: 'held image',
        outputPath: 'held.png',
      });
      outcome = request.then(
        () => undefined,
        (error: unknown) => error,
      );
      await entered.promise;
      const closing = Promise.resolve(operation.dispose());
      closed = closing.then(
        () => {
          finished = true;
        },
        () => {
          finished = true;
        },
      );
      await expect(operation.sessionClient.refreshAuth()).rejects.toThrow(
        /disposed/,
      );
      await expect(
        operation.sessionClient.runImageOperation({
          prompt: 'late image',
          outputPath: 'late.png',
        }),
      ).rejects.toThrow(/disposed/);
      await Promise.resolve();
      expect(finished).toBe(false);
      expect(
        (await otherRoot.preflight.preflight({ provider: 'openai' }))
          .authFailed,
      ).toBe(false);
      released.resolve();
      const failure = await outcome;
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(REPORTED_FAILURE);
      expect((failure as Error).message).not.toMatch(/disposed/);
      await expect(closing).resolves.toBeUndefined();
    } finally {
      released.resolve();
      await outcome;
      await closed;
      for (const root of roots.reverse()) await root.close();
      await proxy.close();
    }
  });
});
