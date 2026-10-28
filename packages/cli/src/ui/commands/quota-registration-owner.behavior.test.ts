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
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { fetchAllQuotaInfo } from './statsQuota.js';

describe('quota read operation ownership', () => {
  const makeOwner = useCommandOwners();
  it('formats quota from the captured live keyfile settings without reading an attached runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quota-registration-'));
    try {
      const owner = await makeOwner('quota-owner');
      const peer = await makeOwner('quota-peer');
      const keyfile = join(root, 'credential');
      await writeFile(keyfile, ' sk-owned-quota\n');
      owner.setEphemeralSetting('auth-keyfile', keyfile);
      owner.setEphemeralSetting('base-url', 'https://api.synthetic.new/v2');
      const request: NetworkFetch = async (_url, init) => {
        const authenticated =
          new Headers(init?.headers).get('authorization') ===
          'Bearer sk-owned-quota';
        return Response.json(
          {
            subscription: { limit: 100, requests: 25, renewsAt: null },
            search: null,
            toolCallDiscounts: null,
          },
          { status: authenticated ? 200 : 401 },
        );
      };
      const settings = Object.assign(owner.getEphemeralSetting.bind(owner), {
        getEphemeralSetting: peer.getEphemeralSetting.bind(peer),
        getActiveProviderName: peer.getProvider.bind(peer),
        detectProviderQuota: () => null,
        fetch: request,
      });
      const provider = Object.assign(owner.getProvider.bind(owner), {
        isAvailable: () => false,
      });
      const read = () =>
        fetchAllQuotaInfo(
          settings,
          provider,
          () => undefined,
          request,
          () => false,
          async () => new Map(),
          async () => new Map(),
        );
      expect((await read()).join('\n')).toContain('25/100 used');
      owner.setEphemeralSetting('base-url', undefined);
      expect(await read()).toStrictEqual([]);
      expect(peer.getEphemeralSetting('auth-keyfile')).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
