/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CodexOAuthToken } from '@vybestack/llxprt-code-auth';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { startLocalForwardProxy } from '@vybestack/llxprt-code-test-utils/network/local-forward-proxy.js';
import { afterEach, describe, expect, it } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { Config } from '@vybestack/llxprt-code-core';
import type { Agent } from '../agent.js';
import type { AgentActivationOperation } from '../activationPreflightState.js';
import type { ProviderActivationIntent } from '../config-types.js';
import { AgentProfilePreflight } from '../profile-preflight.js';
import { gate } from './helpers/async-child-disposal-join-fixture.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

const HOST = 'codex-images.invalid';
const IMAGE_PATH = '/chatgpt.com/backend-api/codex/images/generations';
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const intent = {
  provider: 'openai',
  model: 'gpt-4o',
  authMode: 'auto',
  cliOverrides: {
    key: 'test-key',
    baseUrl: `http://${HOST}/chatgpt.com/backend-api/codex`,
  },
} as const;

/**
 * The live media store directories under the project temp dir. A store creates
 * its directory when it first admits media and removes it when it closes, so
 * the listing is only informative after the test admitted media into the
 * session under test.
 */
async function liveMediaStores(config: Config): Promise<readonly string[]> {
  try {
    return await readdir(join(config.projectTempDir, 'media-live'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** Admits real media into the agent's store through the public history API. */
async function admitMedia(agent: Agent): Promise<void> {
  await agent.setHistory([
    {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: PNG_BASE64,
        },
      ],
    },
  ]);
}

describe('adoption publication barrier', () => {
  const credentials = useOwnedCredentials();
  const cleanups: Array<() => Promise<unknown> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function acquireBarrier(succeed: boolean) {
    const entered = gate();
    const release = gate();
    cleanups.push(() => release.release());
    const proxy = await startLocalForwardProxy({
      [HOST]: async (request) => {
        if (request.path !== IMAGE_PATH)
          return new Response('unexpected path', { status: 404 });
        entered.release();
        await release.promise;
        return succeed
          ? Response.json({ data: [{ b64_json: PNG_BASE64 }] })
          : new Response('accepted image transport failed', { status: 500 });
      },
    });
    cleanups.push(() => proxy.close());
    const token: CodexOAuthToken = {
      access_token: 'image-access',
      refresh_token: 'image-refresh',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      account_id: 'image-account',
    };
    const route = await openRouteBPreflight({
      authority: credentials().authority,
      proxy: proxy.url,
      config: {
        provider: 'openai',
        model: 'gpt-4o',
        folderTrust: true,
        mcpEnabled: false,
        skillsSupport: false,
        telemetry: { enabled: false },
        recording: { enabled: false },
      },
    });
    const selected = new SessionSettingsOwner(route.settings);
    selected.bindTelemetry(route.config);
    cleanups.push(() => selected.dispose());
    cleanups.push(() => route.close());
    await credentials().saveToken(0, 'codex', token);
    await route.prepare({ settingsOwner: selected });
    const result = await route.preflight.preflight(intent);
    if (result.token === undefined)
      throw new Error('Missing preflight receipt');
    const receipt = result.token;
    const image = route.preflight
      .runImageOperation({
        prompt: 'accepted before adoption',
        outputPath: 'accepted.png',
      })
      .catch((error: unknown) => error);
    await entered.promise;
    const transfer = (): AgentActivationOperation => {
      let transferred: AgentActivationOperation | undefined;
      route.preflight.transferActivation((operation) => {
        transferred = operation;
      });
      if (transferred === undefined)
        throw new Error('Missing transferred activation');
      return transferred;
    };
    const adopt = (adoptedIntent: ProviderActivationIntent = intent) =>
      AgentProfilePreflight.createForegroundAgent(
        route.preflight,
        receipt,
        adoptedIntent,
        {},
      );
    return { route, selected, image, release, transfer, adopt };
  }
  it('closes preflight admission before construction and joins accepted images before publishing', async () => {
    const { route, selected, image, release, transfer, adopt } =
      await acquireBarrier(false);
    const operation = transfer();
    let settled = false;
    const adopting = adopt().then(
      (agent) => {
        settled = true;
        return agent;
      },
      (error: unknown) => {
        settled = true;
        throw error;
      },
    );
    let published: Agent | undefined;
    try {
      await expect(operation.sessionClient.refreshAuth()).rejects.toThrow(
        /disposed/,
      );
      await Promise.resolve();
      expect(settled).toBe(false);
      release.release();
      expect(await image).toBeInstanceOf(Error);
      published = await adopting;
      // The transferred media store is still open after the join: it admits
      // media and shows its live directory.
      await admitMedia(published);
      expect(await liveMediaStores(route.config)).toHaveLength(1);
      await published.dispose();
      published = undefined;
      expect(await liveMediaStores(route.config)).toHaveLength(0);
      expect(() => route.filesystem.paths.directories()).toThrow(/disposed/);
      selected.writeUserParameter('survived-adoption', true);
      expect(selected.readNamedParameter('survived-adoption')).toBe(true);
    } finally {
      release.release();
      await image;
      await published?.dispose();
      await adopting.catch(() => undefined);
    }
  });
  it('publishes a ready agent only after accepted image work has settled', async () => {
    const built = await acquireBarrier(true);
    const operation = built.transfer();
    let published = false;
    const adopting = built.adopt().then((agent) => {
      published = true;
      return agent;
    });
    await expect(operation.sessionClient.refreshAuth()).rejects.toThrow(
      /disposed/,
    );
    await Promise.resolve();
    expect(published).toBe(false);
    built.release.release();
    expect(await built.image).not.toBeInstanceOf(Error);
    const agent = await adopting;
    try {
      expect(published).toBe(true);
      expect(agent.workspace.getDirectories()).toContain(
        built.route.filesystem.paths.directories()[0],
      );
      expect(await agent.session.getHistory()).toStrictEqual([]);
      expect(agent.listTools().length).toBeGreaterThan(0);
      await admitMedia(agent);
      expect(await liveMediaStores(built.route.config)).toHaveLength(1);
    } finally {
      await agent.dispose();
    }
    expect(await liveMediaStores(built.route.config)).toHaveLength(0);
    expect(() => built.route.filesystem.paths.directories()).toThrow(
      /disposed/,
    );
    built.selected.writeUserParameter('borrowed-after-ready', 1);
    expect(built.selected.readNamedParameter('borrowed-after-ready')).toBe(1);
  });

  it('joins accepted work before cancelled adoption releases its owned resources', async () => {
    const built = await acquireBarrier(true);
    let published = false;
    const adopting = built.adopt().then(
      async (agent) => {
        published = true;
        await agent.dispose();
        return undefined;
      },
      (error: unknown) => error,
    );
    let closed = false;
    const closing = built.route.disposePreflight().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    built.release.release();
    expect(await built.image).not.toBeInstanceOf(Error);
    expect(await adopting).toBeInstanceOf(Error);
    await closing;
    expect(published).toBe(false);
    expect(closed).toBe(true);
    expect(() => built.route.filesystem.paths.directories()).toThrow(
      /disposed/,
    );
    built.selected.writeUserParameter('borrowed-after-cancel', 2);
    expect(built.selected.readNamedParameter('borrowed-after-cancel')).toBe(2);
  });

  it('rejects a mismatched activation intent before acquisition and joins accepted work during rollback', async () => {
    const built = await acquireBarrier(true);
    const rejected = await built
      .adopt({ ...intent, model: 'gpt-4o-mini' })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(rejected).toBeInstanceOf(Error);
    expect(String(rejected)).toContain(
      'Activation preflight intent mismatch or missing activation intent',
    );
    let closed = false;
    const closing = built.route.disposePreflight().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    built.release.release();
    expect(await built.image).not.toBeInstanceOf(Error);
    await closing;
    expect(closed).toBe(true);
    expect(() => built.route.filesystem.paths.directories()).toThrow(
      /disposed/,
    );
    built.selected.writeUserParameter('borrowed-after-identity-rejection', 3);
    expect(
      built.selected.readNamedParameter('borrowed-after-identity-rejection'),
    ).toBe(3);
  });
});
