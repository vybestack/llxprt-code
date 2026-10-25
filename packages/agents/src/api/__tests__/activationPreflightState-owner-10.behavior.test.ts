/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { createGatedKeyStorage } from './helpers/gated-key-storage.js';
import { OwnedCredentialFixture } from './helpers/owned-credential-fixture.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from './helpers/route-b-preflight.js';
import type { AgentActivationOperation } from '../activationPreflightState.js';

const intent = { provider: 'fake', authMode: 'auto' } as const;

describe('activation bootstrap ownership and queued work', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
  });

  it('disposes a running preflight without disposing the caller Config', async () => {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    delete process.env.LLXPRT_FAKE_RESPONSES;
    closers.push(async () => {
      if (previousReplay !== undefined)
        process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
    });
    const credentialCheck = await createGatedKeyStorage('held-key', 'secret');
    const credentials = await OwnedCredentialFixture.create(
      undefined,
      credentialCheck.storage,
    );
    closers.push(() => credentials.dispose());
    const route: RouteBPreflight = await openRouteBPreflight({
      authority: credentials.authority,
      config: { interactive: true, provider: 'openai', model: 'gpt-4o' },
    });
    closers.push(() => route.close());
    route.settings.set('auth-key-name', 'held-key');
    await route.prepare();
    let transferred: AgentActivationOperation | undefined;
    route.preflight.transferActivation((selected) => {
      transferred = selected;
    });
    if (transferred === undefined)
      throw new Error('Missing transferred activation');
    const operation = transferred;
    const sessionId = route.config.getSessionId();
    try {
      const pending = operation.preflight({
        provider: 'claudecode',
        authMode: 'none',
      });
      await credentialCheck.entered;
      let closed = false;
      const closing = Promise.resolve(operation.dispose()).then(() => {
        closed = true;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      credentialCheck.release();
      await closing;
      expect((await pending).token).toBeUndefined();
      expect(route.config.getSessionId()).toBe(sessionId);
      expect((await operation.preflight(intent)).authFailed).toBe(true);
    } finally {
      credentialCheck.release();
    }
  });
});
