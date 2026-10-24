/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodexOAuthToken } from '@vybestack/llxprt-code-auth';
import {
  startLocalForwardProxy,
  type LocalForwardProxy,
} from '@vybestack/llxprt-code-test-utils/network/local-forward-proxy.js';
import type { Agent } from '../agent.js';
import { createAgent } from '../createAgent.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { usePromptFixture } from './helpers/prompt-fixture.js';

const HOST_A = 'codex-images-a.invalid';
const HOST_B = 'codex-images-b.invalid';
const IMAGE_PATH = '/chatgpt.com/backend-api/codex/images/generations';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

interface ImageRoot {
  readonly agent: Agent;
  readonly proxy: LocalForwardProxy;
}

describe('image generation owner transport per root', () => {
  const credentials = useOwnedCredentials();
  usePromptFixture();
  const proxies: LocalForwardProxy[] = [];
  const agents: Agent[] = [];
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'image-owner-transport-'));
  });

  afterEach(async () => {
    for (const agent of agents.splice(0).reverse()) await agent.dispose();
    for (const proxy of proxies.splice(0)) await proxy.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function createImageRoot(host: string): Promise<ImageRoot> {
    const proxy = await startLocalForwardProxy({
      [host]: (request) =>
        request.path === IMAGE_PATH
          ? Response.json({ data: [{ b64_json: PNG.toString('base64') }] })
          : new Response('unexpected path', { status: 404 }),
    });
    proxies.push(proxy);
    const agent = await createAgent({
      provider: 'openai',
      model: 'gpt-4o',
      auth: {
        apiKey: 'test-key',
        baseUrl: `http://${host}/chatgpt.com/backend-api/codex`,
      },
      proxy: proxy.url,
      workingDir: directory,
      credentialAuthority: credentials().authority,
      harness: { includeProcessCwd: false },
    });
    agents.push(agent);
    return { agent, proxy };
  }

  async function saveCodexToken(): Promise<void> {
    const token: CodexOAuthToken = {
      access_token: 'image-access',
      refresh_token: 'image-refresh',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      account_id: 'image-account',
    };
    await credentials().saveToken(0, 'codex', token);
  }

  it('sends each root image generation through its own proxy only', async () => {
    const left = await createImageRoot(HOST_A);
    const right = await createImageRoot(HOST_B);
    await saveCodexToken();

    await left.agent.sessionClient.runImageOperation({
      prompt: 'a lighthouse',
      outputPath: 'left.png',
    });
    await right.agent.sessionClient.runImageOperation({
      prompt: 'a harbor',
      outputPath: 'right.png',
    });

    expect((await readFile(join(directory, 'left.png'))).equals(PNG)).toBe(
      true,
    );
    expect((await readFile(join(directory, 'right.png'))).equals(PNG)).toBe(
      true,
    );
    expect(left.proxy.requestsTo(HOST_A).map(({ path }) => path)).toStrictEqual(
      [IMAGE_PATH],
    );
    expect(left.proxy.requestsTo(HOST_B)).toHaveLength(0);
    expect(
      right.proxy.requestsTo(HOST_B).map(({ path }) => path),
    ).toStrictEqual([IMAGE_PATH]);
    expect(right.proxy.requestsTo(HOST_A)).toHaveLength(0);
  }, 30_000);
});
