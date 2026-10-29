import { withFetchPreconnect } from '@vybestack/llxprt-code-test-utils/fetch-test-helpers.js';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  afterEach,
  beforeEach,
  spyOn,
} from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { get } from 'node:http';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  return { promise, release };
}

async function authorize(authorization: string): Promise<void> {
  const url = new URL(authorization);
  const callback = new URL(url.searchParams.get('redirect_uri') ?? '');
  callback.searchParams.set('state', url.searchParams.get('state') ?? '');
  callback.searchParams.set('code', 'connected-owner-code');
  await new Promise<void>((resolveRequest, reject) => {
    const request = get(callback, (response) => {
      response.resume();
      response.on('end', resolveRequest);
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

function serverConfig(evidence: string) {
  return {
    command: process.execPath,
    args: [
      resolveRepositoryFixture(
        import.meta.url,
        'scripts/tests/mcp-standalone-stdio-fixture.ts',
      ),
      evidence,
    ],
    oauth: {
      enabled: true,
      clientId: 'connected-owner',
      authorizationUrl: 'https://connected-owner.test/authorize',
      tokenUrl: 'https://connected-owner.test/token',
    },
  };
}

describe('connected MCP disposal', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  useFakeResponsesReplay('plain-text.jsonl');

  let directory = '';
  const evidence = (): string => directory;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-connected-disposal-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function connectedAgent(): Promise<Agent> {
    const workingDir = join(evidence(), 'work');
    await mkdir(workingDir);
    return createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: await realpath(workingDir),
      folderTrust: true,
      mcpServers: { local: serverConfig(evidence()) },
      mcpHost: { openBrowser: authorize },
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
  }

  function localTools(agent: Agent): number {
    return agent.tools.list().filter((tool) => tool.server === 'local').length;
  }

  async function awaitReadiness(agent: Agent): Promise<void> {
    const readiness = [];
    for await (const event of agent.stream('unused', {
      signal: AbortSignal.abort(),
    })) {
      readiness.push(event);
    }
    expect(readiness).toStrictEqual([{ type: 'done', reason: 'aborted' }]);
  }

  it('stops owned connected MCP before joining a manual authentication request', async () => {
    const entered = gate();
    const released = gate();
    const agent = await connectedAgent();
    await awaitReadiness(agent);
    const network = spyOn(globalThis, 'fetch').mockImplementation(
      withFetchPreconnect(async () => {
        entered.release();
        await released.promise;
        return new Response(null, { status: 401 });
      }),
    );
    let authentication: Promise<unknown> | undefined;
    let disposal: Promise<void> | undefined;
    try {
      expect(localTools(agent)).toBe(1);
      authentication = agent.mcp
        .authenticate('local')
        .catch((error: unknown) => error);
      await Promise.race([
        entered.promise,
        authentication.then(() => {
          throw new Error('Authentication did not reach token request');
        }),
      ]);
      disposal = agent.dispose();
      expect(agent.dispose()).toBe(disposal);
      expect(() => agent.tools.list()).toThrow('closed');
      released.release();
      expect(await authentication).toHaveProperty('name', 'AbortError');
      await disposal;
    } finally {
      released.release();
      await authentication;
      await disposal;
      await agent.dispose();
      network.mockRestore();
    }
  }, 30000);

  it('discovers one connected catalog at construction and leaves it unchanged by reads and disposal', async () => {
    const agent = await connectedAgent();
    try {
      await awaitReadiness(agent);
      const before = await readFile(join(evidence(), 'requests'), 'utf8');
      expect(
        before.split('\n').filter((line) => line === 'tools/list'),
      ).toHaveLength(1);
      expect(localTools(agent)).toBe(1);
      expect(await readFile(join(evidence(), 'requests'), 'utf8')).toBe(before);
      await agent.dispose();
      expect(await readFile(join(evidence(), 'requests'), 'utf8')).toBe(before);
    } finally {
      await agent.dispose();
    }
  }, 30000);
});
