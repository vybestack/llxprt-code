import { adoptFixture as fromConfig } from '../../../agents/src/api/__tests__/helpers/adoption-fixture.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PromptService } from '@vybestack/llxprt-code-core/prompt-config/index.js';
import {
  type Agent,
  type AgentProfilePreflight,
} from '@vybestack/llxprt-code-agents';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { Config } from '@vybestack/llxprt-code-core';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { parseArguments } from './cliArgParser.js';
import { ExtensionEnablementManager } from './extensions/extensionEnablement.js';
import type { Settings } from './settings.js';
import { loadCliConfigWithPreflight } from '../__tests__/load-cli-config-fixture.js';

function streamReply(text: string): string {
  const chunk = {
    id: 'cli-kimi-chat',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'kimi-k3',
    choices: [
      {
        index: 0,
        delta: { role: 'assistant', content: text },
        finish_reason: 'stop',
      },
    ],
  };
  return `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;
}

async function loadOwner(
  key: string,
  endpoint: string,
): Promise<{
  config: Config;
  agent: Agent;
  registration: AgentProfilePreflight;
}> {
  process.argv = [
    'bun',
    'cli',
    '--provider',
    'kimi',
    '--model',
    'kimi-k3',
    '--key',
    key,
    '--baseurl',
    endpoint,
  ];
  const argv = await parseArguments({} as Settings);
  let registration: AgentProfilePreflight | undefined;
  const credentialAuthority = new CredentialAuthority();
  const settingsService = new SettingsService();
  const settingsOwner = new SessionSettingsOwner(settingsService);
  const config = await loadCliConfigWithPreflight({
    settings: {},
    extensions: [],
    extensionEnablementManager: new ExtensionEnablementManager(
      join(endpoint, 'extensions'),
      {
        enabledOverride: [],
      },
    ),
    sessionId: 'same-label-cli',
    argv,
    cwd: process.cwd(),
    settingsService,
    settingsOwner,
    authority: credentialAuthority,
    onActivationBootstrapReady: () => undefined,
    onPreflightReady: (owner) => {
      registration = owner;
    },
  });
  if (!registration) throw new Error('CLI did not provide its owner handle');
  return {
    config,
    agent: await fromConfig(
      config,
      settingsService,
      {},
      settingsOwner,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      credentialAuthority,
    ),
    registration,
  };
}

describe('same-label CLI Kimi HTTP ownership', () => {
  it('preserves the second CLI request when the first owner closes during its response', async () => {
    const priorArgv = process.argv;
    const priorHome = process.env.LLXPRT_CONFIG_HOME;
    const home = await mkdtemp(join(tmpdir(), 'cli-kimi-owner-'));
    process.env.LLXPRT_CONFIG_HOME = home;
    await new PromptService().initialize();
    let enteredHeld: () => void = () => undefined;
    let releaseHeld: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      enteredHeld = resolve;
    });
    const credentials: string[] = [];
    const server = createServer((request, reply) => {
      request.resume();
      request.on('end', () => {
        const credential = request.headers.authorization ?? '';
        credentials.push(credential);
        void (async (): Promise<void> => {
          if (credential === 'Bearer cli-key-b') {
            enteredHeld();
            await held;
          }
          reply.writeHead(200, { 'content-type': 'text/event-stream' });
          reply.end(
            streamReply(credential.endsWith('-a') ? 'first' : 'second'),
          );
        })();
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing server port');
    const owners: Array<Awaited<ReturnType<typeof loadOwner>>> = [];
    const windowDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'window',
    );
    try {
      const endpoint = `http://127.0.0.1:${address.port}/v1`;
      owners.push(await loadOwner('cli-key-a', endpoint));
      owners.push(await loadOwner('cli-key-b', endpoint));
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: undefined,
      });
      const first = owners[0].agent.generate('hello');
      const second = owners[1].agent.generate('hello');
      await entered;
      expect(await first).toBe('first');
      await owners[0].agent.dispose();
      await owners[0].config.dispose();
      await owners[0].registration.dispose();
      expect(owners[1].registration.captureInput().runtimeId).toBe(
        'cli.runtime.bootstrap',
      );
      releaseHeld();
      expect(await second).toBe('second');
      expect([...credentials].sort()).toStrictEqual([
        'Bearer cli-key-a',
        'Bearer cli-key-b',
      ]);
    } finally {
      releaseHeld();
      if (windowDescriptor)
        Object.defineProperty(globalThis, 'window', windowDescriptor);
      else Reflect.deleteProperty(globalThis, 'window');
      for (const owner of owners) {
        await owner.agent.dispose();
        await owner.config.dispose();
        await owner.registration.dispose();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      process.argv = priorArgv;
      if (priorHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = priorHome;
      await rm(home, { recursive: true, force: true });
    }
  });
});
