import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import type { AgentActivationOperation } from '../activation-types.js';
import type { AgentActivationBootstrap } from '../activationPreflightState.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from './helpers/route-b-preflight.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Counts `SessionClientOwner.dispose` calls on the activation's own session
 * client through a delegating wrapper on that production-built instance. The
 * activation the host receives is the `AgentActivationBootstrap`; no public
 * read reports how often it retires its protected `ownedSessionClient`.
 */
function countSessionClientRetirements(
  activation: AgentActivationOperation,
): () => number {
  const owner = (activation as AgentActivationBootstrap)['ownedSessionClient'];
  const dispose = owner.dispose.bind(owner);
  let retirements = 0;
  owner.dispose = () => {
    retirements += 1;
    return dispose();
  };
  return () => retirements;
}

describe('failed adopted session binding', () => {
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
  useFakeResponsesReplay('multi-turn-text.jsonl');
  const credentials = useOwnedCredentials();
  const routes: RouteBPreflight[] = [];

  afterEach(async () => {
    for (const route of routes.splice(0).reverse()) await route.close();
  });

  it('retires the created session client while retaining caller authority', async () => {
    const route = await openRouteBPreflight({
      authority: credentials().authority,
    });
    routes.push(route);
    const callerSettingsOwner = new SessionSettingsOwner(route.settings);
    await route.prepare({ settingsOwner: callerSettingsOwner });
    let activation: AgentActivationOperation | undefined;
    route.preflight.transferActivation((selected) => {
      activation = selected;
    });
    if (activation === undefined) throw new Error('Missing activation');
    const created = activation;
    const retirements = countSessionClientRetirements(created);

    await route.memory.dispose();
    const failure = await route.createAgent().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({
      message: 'Workspace memory is disposed',
    });
    await expect(created.sessionClient.refreshAuth()).rejects.toThrow(
      'disposed',
    );
    expect(retirements()).toBe(1);
    expect(credentials().snapshot()).toStrictEqual([1]);
    callerSettingsOwner.writeUserParameter('maxOutputTokens', 37);
    expect(route.settings.get('maxOutputTokens')).toBe(37);
  });
});
