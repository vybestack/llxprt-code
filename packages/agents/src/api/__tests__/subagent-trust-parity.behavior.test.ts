/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { Agent } from '../agent.js';
import { createAgent } from '../createAgent.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

interface OpenedAgent {
  readonly agent: Agent;
  readonly close: () => Promise<void>;
}

type OpenAgent = (
  authority: CredentialAuthority,
  root: string,
  extensions: readonly LlxprtExtension[],
) => Promise<OpenedAgent>;

const extensionWorker: LlxprtExtension = {
  name: 'worker-extension',
  version: '1.0',
  path: 'memory://worker-extension',
  isActive: true,
  contextFiles: [],
  subagents: [
    {
      name: 'extension-worker',
      profile: 'route',
      systemPrompt: 'Extension prompt',
    },
  ],
};

const paths: ReadonlyArray<readonly [string, OpenAgent]> = [
  [
    'createAgent without adoption',
    async (authority, root, extensions) => {
      const agent = await createAgent({
        provider: 'fake',
        model: 'fake-model',
        workingDir: root,
        credentialAuthority: authority,
        extensions,
      });
      return { agent, close: () => agent.dispose() };
    },
  ],
  [
    'fromConfig',
    async (authority, _root, extensions) => {
      const opened = await openRouteAAgent({
        authority,
        config: { extensions },
      });
      return { agent: opened.agent, close: opened.close };
    },
  ],
  [
    'foreground preflight',
    async (authority, _root, extensions) => {
      const route = await openRouteBPreflight({
        authority,
        config: { extensions },
      });
      try {
        await route.prepare();
        const agent = await route.createAgent();
        return {
          agent,
          close: async () => {
            await agent.dispose();
            await route.close();
          },
        };
      } catch (primary) {
        await route.close().catch(() => undefined);
        throw primary;
      }
    },
  ],
];

describe('subagent listing follows workspace trust on every construction path', () => {
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
  const credentials = useOwnedCredentials();

  let root: string;
  let previousHome: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'subagent-trust-parity-'));
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = join(root, 'config');
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  });

  it.each(paths)(
    '%s lists extension subagents only while the workspace is trusted',
    async (_name, open) => {
      const { agent, close } = await open(credentials().authority, root, [
        extensionWorker,
      ]);
      try {
        await agent.workspace.profileWrites.saveProfile('route', {
          version: 1,
          provider: 'fake',
          model: 'fake-model',
          modelParams: {},
          ephemeralSettings: {},
        });
        await agent.workspace.subagentWrites.saveSubagent(
          'user-worker',
          'route',
          'User prompt',
        );
        const definitions = agent.workspace.subagentDefinitions;

        await agent.ide.setTrustedFolderLive(false);
        expect(await definitions.listSubagents()).toStrictEqual([
          'user-worker',
        ]);
        expect(await definitions.subagentExists('extension-worker')).toBe(
          false,
        );
        await expect(
          definitions.loadSubagent('extension-worker'),
        ).rejects.toThrow('not found');

        await agent.ide.setTrustedFolderLive(true);
        expect((await definitions.listSubagents()).sort()).toStrictEqual([
          'extension-worker',
          'user-worker',
        ]);
        expect(await definitions.subagentExists('extension-worker')).toBe(true);
      } finally {
        await close();
      }
    },
    30000,
  );
});
