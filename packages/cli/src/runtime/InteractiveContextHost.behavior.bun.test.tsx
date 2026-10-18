/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { Text } from 'ink';
import { Colors } from '../ui/colors.js';
import { act, useCallback } from 'react';
import { Config, SessionSettingsOwner } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { useCommandOwners } from '../__tests__/command-owner-fixture.js';
import { render } from '../__tests__/render.js';
import { InteractiveContextHost } from './InteractiveContextHost.js';
import {
  useGetActiveModelName,
  useGetEphemeralSetting,
  useHasActiveProvider,
  useSetEphemeralSetting,
  useSaveProfileSnapshot,
} from '../ui/contexts/RuntimeContext.js';

describe('interactive context acquisition host', () => {
  const makeOwner = useCommandOwners();
  it('binds selected operations to independent roots with the same identity across sibling retirement', async () => {
    const owner = await makeOwner(
      'context-host-owner',
      undefined,
      undefined,
      true,
    );
    const peer = await makeOwner(
      'context-host-peer',
      undefined,
      undefined,
      true,
    );
    const settings = new SettingsService();
    const selected = new SessionSettingsOwner(settings);
    const config = new Config({
      sessionId: 'same-context-host-label',
      cwd: owner.workspace.getWorkingDirectory(),
      targetDir: owner.workspace.getWorkingDirectory(),
      debugMode: false,
      model: 'unused-host-config-model',
    });
    const primary = new InteractiveContextHost(owner, () =>
      selected.readDefaultProfileName(),
    );
    const secondary = new InteractiveContextHost(peer, () =>
      selected.readDefaultProfileName(),
    );
    const capture: {
      primary?: ReturnType<typeof useSelected>;
      peer?: ReturnType<typeof useSelected>;
    } = {};
    function PrimaryView() {
      const onRead = useCallback((value: ReturnType<typeof useSelected>) => {
        capture.primary = value;
      }, []);
      return <Selected onRead={onRead} />;
    }
    function PeerView() {
      const onRead = useCallback((value: ReturnType<typeof useSelected>) => {
        capture.peer = value;
      }, []);
      return <Selected onRead={onRead} />;
    }
    function renderPrimary() {
      return <>{primary.renderRuntime(<PrimaryView />)}</>;
    }
    const peerTree = <>{secondary.renderRuntime(<PeerView />)}</>;
    const left = render(renderPrimary());
    const right = render(peerTree);
    try {
      expect(owner.getRuntimeId()).toBe(peer.getRuntimeId());
      if (!capture.primary || !capture.peer)
        throw new Error('Selected operations unavailable');
      const first = capture.primary;
      const second = capture.peer;
      expect(first.hasActiveProvider()).toBe(true);
      expect(second.hasActiveProvider()).toBe(true);
      first.write('context-owner-setting', 'owner');
      second.write('context-owner-setting', 'peer');
      expect(first.read('context-owner-setting')).toBe('owner');
      expect(second.read('context-owner-setting')).toBe('peer');
      expect(left.lastFrame()).toContain('context-host-owner-initial');
      expect(right.lastFrame()).toContain('context-host-peer-initial');
      act(() => left.rerender(renderPrimary()));
      expect(capture.primary.read).toBe(first.read);
      expect(capture.primary.write).toBe(first.write);
      right.unmount();
      await peer.dispose();
      owner.setModelParam('temperature', 0.625);
      await first.save('host-selected-profile');
      expect(
        await owner.workspace.profileDefinitions.loadProfile(
          'host-selected-profile',
        ),
      ).toMatchObject({ modelParams: { temperature: 0.625 } });
      first.write('context-owner-setting', 'after-retirement');
      expect(owner.getEphemeralSetting('context-owner-setting')).toBe(
        'after-retirement',
      );
    } finally {
      left.unmount();
      right.unmount();
      await config.dispose();
    }
  });
});

function useSelected() {
  return {
    read: useGetEphemeralSetting(),
    write: useSetEphemeralSetting(),
    save: useSaveProfileSnapshot(),
    hasActiveProvider: useHasActiveProvider(),
    model: useGetActiveModelName(),
  };
}
function Selected({
  onRead,
}: {
  onRead: (value: ReturnType<typeof useSelected>) => void;
}) {
  const selected = useSelected();
  onRead(selected);
  return <Text color={Colors.Foreground}>{selected.model()}</Text>;
}
