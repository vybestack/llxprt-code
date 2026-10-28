import { createTerminalHost } from './terminalHost.js';
let terminalHost = createTerminalHost();
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The key handle an interactive UI root receives from `launchInteractive` has
 * exactly one closer in each window: the pre-commit catch of
 * `startInteractiveUI`, the rollback of `commitInteractiveStartup`, and the
 * published instance's teardown.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { useCommandOwners as installCommandOwners } from '../__tests__/command-owner-fixture.js';
import { createLoadedSettings } from '../__tests__/loaded-settings-fixture.js';
import { InMemoryProviderKeyHandle } from '../__tests__/provider-key-handle-fixture.js';
import {
  __resetCleanupStateForTesting,
  runExitCleanup,
} from '../utils/cleanup.js';
import { AppWrapper } from '../ui/App.js';
import type { SlashCommand } from '../ui/commands/types.js';
import { createMockCommandContext } from '../__tests__/mockCommandContext.js';
import {
  __setRenderForTesting,
  commitInteractiveStartup,
  startInteractiveUI,
  type InteractiveProviderKeys,
} from './interactiveUI.js';

const makeAgent = installCommandOwners();

type RenderFn = NonNullable<Parameters<typeof __setRenderForTesting>[0]>;

function stubInstance() {
  return { clear: () => {}, unmount: () => {}, cleanup: () => {} };
}

function installRender(
  onRender: (node: React.ReactElement) => void = () => {},
) {
  const rendered: React.ReactElement[] = [];
  __setRenderForTesting(((node: React.ReactElement) => {
    rendered.push(node);
    onRender(node);
    return stubInstance();
  }) as unknown as RenderFn);
  return rendered;
}

function keyCommandsOf(root: React.ReactElement): SlashCommand {
  let node: React.ReactNode = root;
  while (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    if (node.type === AppWrapper) {
      return (
        node.props as React.ComponentProps<typeof AppWrapper>
      ).registerCredentials(
        () => 0,
        () => {},
        undefined,
        'agent',
      ).keyCommand;
    }
    node = node.props.children;
  }
  throw new Error('rendered tree has no AppWrapper');
}

describe('interactive UI key handle ownership', () => {
  let dir: string;
  let config: Config;
  let agent: Agent;
  let runtimeSettings: SessionSettingsOwner;
  const settings = createLoadedSettings({ ui: { hideWindowTitle: true } });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'interactive-keys-'));
    agent = await makeAgent(crypto.randomUUID());
    config = new Config({
      sessionId: 'sess-keys',
      targetDir: dir,
      cwd: dir,
      model: 'test-model',
      debugMode: false,
    });
    runtimeSettings = new SessionSettingsOwner(new SettingsService());
    terminalHost = createTerminalHost();
  });

  afterEach(async () => {
    __setRenderForTesting(null);
    terminalHost = createTerminalHost();
    await runExitCleanup();
    __resetCleanupStateForTesting();
    await runtimeSettings.dispose();
    await config.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  function start(providerKeys: InteractiveProviderKeys) {
    return startInteractiveUI(config, agent, settings, [], dir, {
      recordingOwner: 'agent',
      runtimeSettings,
      terminalHost,
      providerKeys,
    });
  }

  it('closes the handle once when a stage before commit fails, and never renders', async () => {
    const rendered = installRender();
    const sentinel = new Error('previous-owner-dispose-failed');
    terminalHost.publish(undefined, {
      dispose: () => Promise.reject(sentinel),
    });
    const keys = new InMemoryProviderKeyHandle();

    const failure = await start(keys).catch((error: unknown) => error);

    expect(failure).toBe(sentinel);
    expect(keys.closeCount).toBe(1);
    expect(rendered).toHaveLength(0);
  });

  describe('raw startup without its own session persistence', () => {
    const requirement =
      'Raw interactive startup requires its own CLI session persistence';

    function startRaw(providerKeys: InteractiveProviderKeys) {
      return startInteractiveUI(config, agent, settings, [], dir, {
        recordingOwner: 'raw',
        runtimeSettings,
        sessionPersistence: undefined,
        terminalHost,
        providerKeys,
      });
    }

    it('closes the handle once, rejects with the requirement and never renders', async () => {
      const rendered = installRender();
      const keys = new InMemoryProviderKeyHandle();

      const failure = await startRaw(keys).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(requirement);
      expect(keys.closeCount).toBe(1);
      expect(rendered).toHaveLength(0);
    });

    it('reports a close failure behind the requirement failure', async () => {
      const rendered = installRender();
      const closeFailure = new Error('close-failed');
      const keys = new InMemoryProviderKeyHandle(closeFailure);

      const failure = await startRaw(keys).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AggregateError);
      const errors = (failure as AggregateError).errors as Error[];
      expect(errors[0].message).toBe(requirement);
      expect(errors).toContain(closeFailure);
      expect(keys.closeCount).toBe(1);
      expect(rendered).toHaveLength(0);
    });
  });

  it('closes the handle once when the commit fails after it started', async () => {
    const renderFailure = new Error('render-failed');
    __setRenderForTesting((() => {
      throw renderFailure;
    }) as unknown as RenderFn);
    const keys = new InMemoryProviderKeyHandle();

    const failure = await start(keys).catch((error: unknown) => error);

    expect(failure).toBe(renderFailure);
    expect(keys.closeCount).toBe(1);
  });

  it('reports a close failure behind the primary error during rollback', async () => {
    const renderFailure = new Error('render-failed');
    __setRenderForTesting((() => {
      throw renderFailure;
    }) as unknown as RenderFn);
    const closeFailure = new Error('close-failed');
    const keys = new InMemoryProviderKeyHandle(closeFailure);

    const failure = await start(keys).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    const errors = (failure as AggregateError).errors as unknown[];
    expect(errors[0]).toBe(renderFailure);
    expect(errors).toContain(closeFailure);
    expect(keys.closeCount).toBe(1);
  });

  it('closes the first handle once when a second start replaces it, and the second at exit', async () => {
    installRender();
    const first = new InMemoryProviderKeyHandle();
    const second = new InMemoryProviderKeyHandle();

    await start(first);
    expect(first.closeCount).toBe(0);
    await start(second);

    expect(first.closeCount).toBe(1);
    expect(second.closeCount).toBe(0);
    await runExitCleanup();
    expect(first.closeCount).toBe(1);
    expect(second.closeCount).toBe(1);
  });

  it('gives each root its own key store, and closing one root leaves the other usable', async () => {
    const roots: React.ReactElement[] = installRender();
    const storeA = new InMemoryProviderKeyHandle();
    const storeB = new InMemoryProviderKeyHandle();
    const commit = (providerKeys: InteractiveProviderKeys) =>
      commitInteractiveStartup({
        config,
        agent,
        settings,
        runtimeSettings,
        perfOwner: null,
        version: 'test',
        startupWarnings: [],
        recordingOwner: 'agent',
        terminalHost,
        providerKeys,
      });

    await commit(storeA);
    const commandsA = keyCommandsOf(roots[0]);
    if (!commandsA.action) throw new Error('Missing key command action');
    await commandsA.action(
      createMockCommandContext(),
      'save only-in-a secret-a',
    );
    expect(await storeA.listKeys()).toStrictEqual(['only-in-a']);

    await terminalHost.cleanup();
    expect(storeA.closeCount).toBe(1);

    await commit(storeB);
    const commandsB = keyCommandsOf(roots[1]);
    expect(await storeB.listKeys()).toStrictEqual([]);
    if (!commandsB.action) throw new Error('Missing key command action');
    await commandsB.action(
      createMockCommandContext(),
      'save only-in-b secret-b',
    );
    expect(await storeB.listKeys()).toStrictEqual(['only-in-b']);
    expect(await storeA.listKeys()).toStrictEqual(['only-in-a']);
    expect(storeB.closeCount).toBe(0);
  });
});
