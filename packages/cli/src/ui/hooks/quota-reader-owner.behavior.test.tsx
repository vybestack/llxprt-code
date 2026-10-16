/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NetworkFetch } from '@vybestack/llxprt-code-core';
import { renderHook } from '../../__tests__/render.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { RuntimeContextProvider } from '../contexts/RuntimeContext.js';
import { OAuthControlProvider } from '../contexts/OAuthControlContext.js';
import { useQuotaReader } from './useQuotaReader.js';

describe('quota reader mounted ownership', () => {
  const makeOwner = useCommandOwners();
  it('reads captured credential files and follows replacement after the old owner retires', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quota-reader-owner-'));
    const owner = await makeOwner('quota-reader-owner');
    const peer = await makeOwner('quota-reader-peer');
    const context = createMockCommandContext();
    const request: NetworkFetch = async (_url, init) => {
      const key = new Headers(init?.headers).get('authorization');
      return Response.json({
        subscription: {
          limit: 100,
          requests: key === 'Bearer captured-first' ? 25 : 50,
          renewsAt: null,
        },
        search: null,
        toolCallDiscounts: null,
      });
    };
    try {
      for (const { agent, token } of [
        { agent: owner, token: 'captured-first' },
        { agent: peer, token: 'captured-second' },
      ]) {
        const file = join(root, token);
        await writeFile(file, ` ${token}\n`);
        agent.setEphemeralSetting('auth-keyfile', file);
        agent.setEphemeralSetting('base-url', 'https://api.synthetic.new/v2');
      }
      const hook = renderHook(
        ({ current }) =>
          useQuotaReader(
            current.getEphemeralSetting.bind(current),
            current.getProvider.bind(current),
            () => undefined,
            request,
            () => false,
            async () => new Map(),
            async () => new Map(),
          ),
        {
          initialProps: { current: owner },
          wrapper: ({ children }) => (
            <RuntimeContextProvider
              agent={peer}
              owner={context.runtimeApi}
              requestFetch={request}
            >
              <OAuthControlProvider control={context.oauthControl}>
                {children}
              </OAuthControlProvider>
            </RuntimeContextProvider>
          ),
        },
      );
      try {
        expect((await hook.result.current()).join('\n')).toContain(
          '25/100 used',
        );
        await owner.dispose();
        hook.rerender({ current: peer });
        expect((await hook.result.current()).join('\n')).toContain(
          '50/100 used',
        );
        peer.setEphemeralSetting('base-url', undefined);
        expect(await hook.result.current()).toStrictEqual([]);
      } finally {
        hook.unmount();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
