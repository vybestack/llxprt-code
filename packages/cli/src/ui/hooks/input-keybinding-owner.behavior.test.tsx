/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { render, waitFor } from '../../__tests__/render.js';
import { KeypressProvider } from '../contexts/KeypressContext.js';
import { createTerminalStore } from '../stores/terminal/terminalStore.js';
import { createSettingsProfileStore } from '../stores/settings/settingsStore.js';
import { createTurnStore } from '../stores/turn/turnStore.js';
import { useInputKeybindings } from '../containers/AppContainer/hooks/useInputKeybindings.js';

describe('input keybinding operation ownership', () => {
  const makeOwner = useCommandOwners();
  it('uses captured live mode and replacement callbacks instead of attached runtime data', async () => {
    const owner = await makeOwner('input-keybinding-owner', {});
    const peer = await makeOwner('input-keybinding-peer', {});
    await owner.ide.setTrustedFolderLive(true);
    await peer.ide.setTrustedFolderLive(false);
    const terminalStore = createTerminalStore();
    const settingsStore = createSettingsProfileStore({
      currentModel: owner.getModel(),
    });
    const turnStore = createTurnStore();
    settingsStore.commands.setIdeContextState({
      workspaceState: { isTrusted: true },
    });
    const commands: string[] = [];
    function Harness({ readMode }: { readMode: () => boolean }): null {
      useInputKeybindings(
        Object.assign(
          {
            terminalStore,
            settingsStore,
            turnStore,
            buffer: { text: '' },
            requestCtrlCExit: () => {},
            requestCtrlDExit: () => {},
            cancelOngoingRequest: () => {},
            handleSlashCommand: async (command: string) => {
              commands.push(command);
            },
            readIdeMode: readMode,
            readInteractiveShellEnabled: () => false,
            readMcpServers: () => ({}),
          },
          {
            uiRuntime: {
              ide: { getIdeMode: () => false },
              shell: { getEnableInteractiveShell: () => false },
              mcp: { getMcpServers: () => ({}) },
            },
          },
        ),
      );
      return null;
    }
    const rendered = render(
      <KeypressProvider>
        <Harness readMode={() => owner.ide.isTrustedFolder()} />
      </KeypressProvider>,
    );
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      rendered.stdin.write('\x07');
      await waitFor(() => expect(commands).toStrictEqual(['/ide status']));
      await owner.ide.setTrustedFolderLive(false);
      rendered.stdin.write('\x07');
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(commands).toHaveLength(1);
      await owner.dispose();
      await peer.ide.setTrustedFolderLive(true);
      rendered.rerender(
        <KeypressProvider>
          <Harness readMode={() => peer.ide.isTrustedFolder()} />
        </KeypressProvider>,
      );
      rendered.stdin.write('\x07');
      await waitFor(() =>
        expect(commands).toStrictEqual(['/ide status', '/ide status']),
      );
    } finally {
      rendered.unmount();
    }
  });
});
