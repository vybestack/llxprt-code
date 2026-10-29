import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import {
  afterAll,
  afterEach as afterFixtureTest,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useEffect } from 'react';
import { useFakeResponsesReplay } from '../../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { runCleanupSteps } from '../../../../agents/src/core/subagent-cleanup.js';
import {
  openBridgeRoot,
  type BridgeRoot,
  type BridgeRootOptions,
} from '../../__tests__/runtime-owner-bridge-route-b-root-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { Colors } from '../colors.js';
import {
  OAuthControlProvider,
  useOAuthControl,
  type OAuthControl,
} from './OAuthControlContext.js';
import { createAuthCommand } from '../commands/authCommand.js';
import type {
  SlashCommand,
  SlashCommandActionReturn,
} from '../commands/types.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

installTestWorkspaceFilesystem();

describe('interactive runtime owner bridge', () => {
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

  const firstCredentials = useOwnedCredentials();

  const secondCredentials = useOwnedCredentials();

  useFakeResponsesReplay('multi-turn-text.jsonl');

  const acquiredCleanup: Array<() => void | Promise<void>> = [];
  afterFixtureTest(async () => {
    await runCleanupSteps(acquiredCleanup.splice(0).reverse());
  });
  it('isolates interleaved OAuth auth status in two same-label roots after one owner is disposed', async () => {
    const first = await openRootWithOAuthSettings(
      acquiredCleanup,
      firstCredentials().authority,
    );
    const second = await openRootWithOAuthSettings(
      acquiredCleanup,
      secondCredentials().authority,
    );
    const a = first.agent;
    const b = second.agent;
    const captured: { left?: OAuthControl; right?: OAuthControl } = {};
    function OAuthView({
      side,
    }: {
      side: 'left' | 'right';
    }): React.JSX.Element {
      const control = useOAuthControl();
      useEffect(() => {
        captured[side] = control;
      }, [control, side]);
      return <Text color={Colors.Foreground}>oauth:{side}</Text>;
    }
    const left = render(
      <OAuthControlProvider control={a.authentication}>
        <OAuthView side="left" />
      </OAuthControlProvider>,
    );
    const right = render(
      <OAuthControlProvider control={b.authentication}>
        <OAuthView side="right" />
      </OAuthControlProvider>,
    );
    try {
      if (!captured.left || !captured.right)
        throw new Error('OAuth root unavailable');
      const leftControl = captured.left;
      const rightControl = captured.right;
      const initialLeft = await leftControl.getAuthStatus();
      const initialRight = await rightControl.getAuthStatus();
      expect(initialLeft).toStrictEqual(initialRight);
      const [enabledLeft, enabledRight] = await Promise.all([
        leftControl.toggleOAuthEnabled('codex'),
        rightControl.toggleOAuthEnabled('claudecode'),
      ]);
      expect(enabledLeft).toBe(true);
      expect(enabledRight).toBe(true);
      const [leftStatus, rightStatus] = await Promise.all([
        leftControl.getAuthStatus(),
        rightControl.getAuthStatus(),
      ]);
      expect(
        leftStatus.find((status) => status.provider === 'codex')?.oauthEnabled,
      ).toBe(true);
      expect(
        leftStatus.find((status) => status.provider === 'claudecode')
          ?.oauthEnabled,
      ).not.toBe(true);
      expect(
        rightStatus.find((status) => status.provider === 'claudecode')
          ?.oauthEnabled,
      ).toBe(true);
      expect(
        rightStatus.find((status) => status.provider === 'codex')?.oauthEnabled,
      ).not.toBe(true);
      // The command is registered against the right owner. Invoking it with
      // a context carrying the left owner's control (which must not be
      // consulted) and with the right owner's own control must both report
      // the right owner's status.
      const authCommand = createAuthCommand(rightControl, () => true);
      for (const invocationControl of [leftControl, rightControl]) {
        const statusResult = await runAuthStatus(
          authCommand,
          invocationControl,
        );
        expect(statusResult).toMatchObject({
          type: 'message',
          messageType: 'info',
          content: expect.stringContaining('ENABLED'),
        });
        expect(JSON.stringify(statusResult)).not.toContain('access_token');
      }
      expect(JSON.stringify(leftStatus)).not.toContain('access_token');
      expect(JSON.stringify(rightStatus)).not.toContain('access_token');
      left.unmount();
      await a.dispose();
      await first.close();
      const statusAfterDisposal = await rightControl.getAuthStatus();
      expect(
        statusAfterDisposal.find((status) => status.provider === 'claudecode')
          ?.oauthEnabled,
      ).toBe(true);
      expect(
        statusAfterDisposal.find((status) => status.provider === 'codex')
          ?.oauthEnabled,
      ).not.toBe(true);
    } finally {
      right.unmount();
      await b.dispose();
      await second.close();
    }
  }, 30000);
});

async function runAuthStatus(
  authCommand: SlashCommand,
  invocationControl: OAuthControl,
): Promise<void | SlashCommandActionReturn> {
  if (!authCommand.action) throw new Error('auth command has no action');
  const invocationContext = createMockCommandContext({
    oauthControl: invocationControl,
  });
  Object.defineProperty(invocationContext, 'runtimeApi', {
    get: () => {
      throw new Error('OAuth status must not resolve a generic runtime API');
    },
  });
  return authCommand.action(invocationContext, 'claudecode');
}

/**
 * The OAuth manager binds its user settings file when the preflight is built,
 * from the config home in effect then. Each root is opened under its own
 * config home holding an empty `oauthEnabledProviders`, so the two roots keep
 * separate enablement files the way two hosts with separate homes would.
 */
async function openRootWithOAuthSettings(
  cleanup: Array<() => void | Promise<void>>,
  authority: BridgeRootOptions['authority'],
): Promise<BridgeRoot> {
  const home = await mkdtemp(join(tmpdir(), 'oauth-root-home-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  await writeFile(
    join(home, 'settings.json'),
    JSON.stringify({ oauthEnabledProviders: {} }),
  );
  const previousHome = process.env.LLXPRT_CONFIG_HOME;
  process.env.LLXPRT_CONFIG_HOME = home;
  try {
    const root = await openBridgeRoot({
      authority,
      label: 'shared-oauth-label',
    });
    cleanup.push(root.close, () => root.agent.dispose());
    return root;
  } finally {
    if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousHome;
  }
}
