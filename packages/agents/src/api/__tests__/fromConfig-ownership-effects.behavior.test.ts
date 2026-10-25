/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentConfig } from '../config-types.js';
import { makeToken } from './helpers/provider-auth-fixtures.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { writeProviderFile } from './helpers/provider-file-input.js';
import { openRouteAAgent, type RouteAAgent } from './helpers/route-a-agent.js';

const CALLER_CONFIG: Partial<AgentConfig> = {
  sessionId: 'caller-config-scope',
  folderTrust: true,
  mcpEnabled: false,
  skillsSupport: false,
  recording: { enabled: false },
  telemetry: { enabled: false },
  settings: { jitContextEnabled: false },
};

describe('fromConfig ownership effects', () => {
  useFakeResponsesReplay('plain-text.jsonl');
  const credentials = useOwnedCredentials();
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function open(sessionId: string): Promise<RouteAAgent> {
    const built = await openRouteAAgent({
      config: CALLER_CONFIG,
      intent: { sessionId },
      authority: credentials().authority,
    });
    cleanups.push(built.close);
    return built;
  }

  it("closes only the agent's own token transport on dispose", async () => {
    const callerStore = credentials().authority.createTokenStore();
    const { agent } = await open('token-transport-scope');
    await callerStore.saveToken('fake', makeToken('caller-owned'));
    expect(await callerStore.listProviders()).toContain('fake');

    await agent.dispose();

    expect(credentials().snapshot()).toStrictEqual([0, 1]);
    await callerStore.removeToken('fake');
    expect(await callerStore.listProviders()).not.toContain('fake');
    await callerStore.saveToken('fake', makeToken('after-disposal'));
    expect(await callerStore.getToken('fake')).toMatchObject({
      access_token: 'after-disposal',
    });
  });

  it('uses intent.sessionId as the runtime id and releases its provider files on dispose', async () => {
    const { agent, config, directory } = await open('adopted-runtime-scope');
    const files = join(directory, 'provider-files');
    await mkdir(files);
    expect(agent.getRuntimeId()).toBe('adopted-runtime-scope');
    expect(agent.getRuntimeId()).not.toBe(config.getSessionId());
    for (const input of [
      await writeProviderFile(files, 'owned-runtime'),
      await writeProviderFile(files, 'owned-runtime-retained', 'retain'),
      await writeProviderFile(files, 'workspace-file', 'delete', 'workspace'),
    ])
      await (await agent.retainProviderFile(input)).lease.release();
    expect(agent.captureProviderFiles().retainedFiles).toBe(3);

    await agent.dispose();

    expect((await readdir(files)).sort()).toStrictEqual([
      'owned-runtime-retained',
      'workspace-file',
    ]);
    expect(agent.captureProviderFiles().retainedFiles).toBe(1);
    expect(config.getSessionId()).toBe('caller-config-scope');
  });

  it('joins concurrent disposal while a real file lease delays exactly-once owned token closure', async () => {
    const { agent, directory } = await open('concurrent-adoption-scope');
    const lease = (
      await agent.retainProviderFile(
        await writeProviderFile(directory, 'held-file'),
      )
    ).lease;
    cleanups.push(() => lease.release());
    await credentials().saveToken(0, 'fake', makeToken('owned'));
    let settled = 0;
    const disposals = Array.from({ length: 3 }, () =>
      agent.dispose().then(() => {
        settled += 1;
      }),
    );
    const deadline = Date.now() + 5_000;
    while (
      agent.captureProviderFiles().pendingDeletions === 0 &&
      Date.now() < deadline
    ) {
      await delay(10);
    }
    expect(agent.captureProviderFiles().pendingDeletions).toBe(1);

    expect(settled).toBe(0);
    expect(credentials().snapshot()).toStrictEqual([0]);
    expect(await credentials().listProviders(0)).toContain('fake');
    await expect(agent.generate('after closed admission')).rejects.toThrow(
      'Agent is closed',
    );

    await lease.release();
    await Promise.all(disposals);
    await agent.dispose();

    expect(settled).toBe(3);
    expect(agent.captureProviderFiles().retainedFiles).toBe(0);
    expect(await readdir(directory)).not.toContain('held-file');
    expect(credentials().snapshot()).toStrictEqual([1]);
  });
});
