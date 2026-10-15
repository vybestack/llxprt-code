/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useBrowserCatalogCommands } from '../hooks/useBrowserCatalogCommands.js';
import { join } from 'node:path';
import { getProjectHash } from '@vybestack/llxprt-code-core';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { CommandContext } from '../commands/types.js';
import { createAppCommandBindings } from '../../__tests__/appCommandBindings.js';
import {
  AppCommandsProvider,
  useAppCommands,
} from '../contexts/AppCommandsContext.js';
import { useTextBuffer } from './shared/text-buffer.js';
import {
  bindOwnerBrowserCatalog,
  bindRawBrowserCatalog,
  type BrowserCatalogReader,
} from '../hooks/browserCatalogHost.js';
import { describe, expect, it } from 'bun:test';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import {
  renderWithProviders,
  waitFor,
  wrapWithProviders,
} from '../../__tests__/render.js';
import { renderSessionBrowserDialog } from './DialogManagerRenderers.js';

describe('browser catalog application owner', () => {
  it('lists the bound owner recording despite a retired invocation Agent', async () => {
    await withRecordingLifetimeFixture(
      async ({ agent, borrow, chatsDir, config }) => {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [
              { type: 'text', text: 'catalog source from actual owner' },
            ],
          },
        ]);
        await agent.session.setRecording({ enabled: true });
        await agent.session.setRecording({ enabled: false });
        const owner = await borrow();
        await agent.dispose();
        const context = createMockCommandContext({
          services: {
            agent,
            config: {
              getProjectTempDir: () => chatsDir.replace(/[/\\]chats$/, ''),
              getProjectRoot: () => config.getProjectRoot(),
              getSessionId: () => config.getSessionId(),
            },
          },
          recordingOwner: 'agent',
        });
        const runtime = context.services.config;
        if (!runtime) throw new Error('Missing catalog display data');
        const OwnerCatalog = () => {
          const commands = useBrowserCatalogCommands(
            owner.session,
            'agent',
            runtime,
            undefined,
            undefined,
          );
          return renderSessionBrowserDialog(
            runtime,
            context,
            async () => ({ ok: true }),
            () => {},
            commands.readBrowserCatalog,
            commands.deleteBrowserTarget,
          );
        };
        const view = renderWithProviders(<OwnerCatalog />);
        await waitFor(() =>
          expect(view.lastFrame()).toContain(
            'catalog source from actual owner',
          ),
        );
        view.unmount();
      },
    );
  }, 30000);
});

function CatalogView({
  runtime,
  context,
}: {
  runtime: CliUiRuntime;
  context: CommandContext;
}) {
  const commands = useAppCommands();
  return renderSessionBrowserDialog(
    runtime,
    context,
    async () => ({ ok: true }),
    () => {},
    commands.readBrowserCatalog,
    commands.deleteBrowserTarget,
  );
}
function CatalogApplication({
  runtime,
  context,
  read,
}: {
  runtime: CliUiRuntime;
  context: CommandContext;
  read: BrowserCatalogReader;
}) {
  const buffer = useTextBuffer({
    initialText: '',
    viewport: { width: 80, height: 20 },
    isValidPath: () => false,
    onChange: () => {},
  });
  const value = createAppCommandBindings(
    'catalog application',
    {
      buffer,
      commandContext: context,
      inputHistory: [],
      generatePromptContent: null,
    },
    { readBrowserCatalog: read, deleteBrowserTarget: async () => {} },
  );
  return (
    <AppCommandsProvider value={value}>
      <CatalogView runtime={runtime} context={context} />
    </AppCommandsProvider>
  );
}
describe('browser catalog application replacement', () => {
  it('reloads the visible catalog when its application reader changes', async () => {
    await withRecordingLifetimeFixture(async ({ agent, config, chatsDir }) => {
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'catalog before owner replacement' }],
        },
      ]);
      await agent.session.setRecording({ enabled: true });
      await agent.session.setRecording({ enabled: false });
      const context = createMockCommandContext({
        services: {
          config: {
            getProjectTempDir: () => chatsDir.replace(/[/\\]chats$/, ''),
            getProjectRoot: () => config.getProjectRoot(),
            getSessionId: () => config.getSessionId(),
          },
        },
      });
      const runtime = context.services.config;
      if (!runtime) throw new Error('Missing catalog display data');
      const first = bindOwnerBrowserCatalog(
        () => agent.session.listBrowserTargetsDetailed(),
        () => agent.session.getRecording().path,
        () => config.getSessionId(),
      );
      const next = bindRawBrowserCatalog(
        join(chatsDir, 'empty'),
        getProjectHash(config.getProjectRoot()),
        () => config.getSessionId(),
        undefined,
      );
      const view = renderWithProviders(
        <CatalogApplication runtime={runtime} context={context} read={first} />,
      );
      try {
        await waitFor(() =>
          expect(view.lastFrame()).toContain(
            'catalog before owner replacement',
          ),
        );
        view.rerender(
          wrapWithProviders(
            <CatalogApplication
              runtime={runtime}
              context={context}
              read={next}
            />,
          ),
        );
        await waitFor(() =>
          expect(view.lastFrame()).toContain(
            'No sessions found for this project.',
          ),
        );
      } finally {
        view.unmount();
      }
    });
  }, 30000);
});
