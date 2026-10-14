/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
import React, { useEffect } from 'react';
import { Text } from 'ink';
import { Colors } from '../colors.js';
import { render } from 'ink-testing-library';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { buildCliStyleConfig } from '../../../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createOAuthControl } from '../../runtime/createOAuthControl.js';
import {
  OAuthControlProvider,
  useOAuthControl,
} from './OAuthControlContext.js';
import { createAuthCommand } from '../commands/authCommand.js';

installTestWorkspaceFilesystem();
installWorkspaceRuntimeFixture();

describe('interactive runtime owner bridge OAuth status', () => {
  it('isolates interleaved OAuth auth status in two same-label roots after one owner is disposed', async () => {
    const first = await buildCliStyleConfig('multi-turn-text.jsonl');
    const second = await buildCliStyleConfig('multi-turn-text.jsonl');
    const a = await fromConfig({
      settingsOwner: first.settingsOwner,
      settingsService: first.settingsService,
      providerManager: first.providerManager,
      config: first.config,
      messageBus: first.messageBus,
      mcpRuntime: first.mcpRuntime,
      sessionId: 'shared-oauth-label',
    });
    const b = await fromConfig({
      settingsOwner: second.settingsOwner,
      settingsService: second.settingsService,
      providerManager: second.providerManager,
      config: second.config,
      messageBus: second.messageBus,
      mcpRuntime: second.mcpRuntime,
      sessionId: 'shared-oauth-label',
    });
    const captured: {
      left?: ReturnType<typeof createOAuthControl>;
      right?: ReturnType<typeof createOAuthControl>;
    } = {};
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
      <OAuthControlProvider
        control={createOAuthControl(
          () => first.runtime.oauthManager,
          a.providerManager,
        )}
      >
        <OAuthView side="left" />
      </OAuthControlProvider>,
    );
    const right = render(
      <OAuthControlProvider
        control={createOAuthControl(
          () => second.runtime.oauthManager,
          b.providerManager,
        )}
      >
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
      // The command is registered against the right owner. The invocation
      // carries the left owner's control, which must not be consulted.
      const authCommand = createAuthCommand(rightControl);
      if (!authCommand.action) throw new Error('auth command has no action');
      const invocationContext = createMockCommandContext({
        oauthControl: leftControl,
      });
      Object.defineProperty(invocationContext, 'runtimeApi', {
        get: () => {
          throw new Error(
            'OAuth status must not resolve a generic runtime API',
          );
        },
      });
      const statusResult = await authCommand.action(
        invocationContext,
        'claudecode',
      );
      expect(statusResult).toMatchObject({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('ENABLED'),
      });
      expect(JSON.stringify(statusResult)).not.toContain('access_token');
      expect(JSON.stringify(leftStatus)).not.toContain('access_token');
      expect(JSON.stringify(rightStatus)).not.toContain('access_token');
      left.unmount();
      await a.dispose();
      await first.config.dispose();
      await first.cleanup();
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
      await second.config.dispose();
      await second.cleanup();
    }
  }, 30000);
});
