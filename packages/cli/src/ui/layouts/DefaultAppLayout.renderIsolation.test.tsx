/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, cloneElement, useState } from 'react';
import { describe, expect, it, vi } from 'bun:test';
import { setEnv, restoreEnv } from '@vybestack/llxprt-code-test-utils';

interface Fiber {
  readonly type?: { readonly name?: string } | string | null;
  readonly flags: number;
  readonly child: Fiber | null;
  readonly sibling: Fiber | null;
}
const renders = new Map<string, number>();
function countRenderedFibers(fiber: Fiber | null): void {
  if (!fiber) return;
  const name =
    typeof fiber.type === 'function' || typeof fiber.type === 'object'
      ? fiber.type?.name
      : undefined;
  if (name && (fiber.flags & 1) !== 0) {
    renders.set(name, (renders.get(name) ?? 0) + 1);
  }
  countRenderedFibers(fiber.child);
  countRenderedFibers(fiber.sibling);
}
// Observe the real reconciler's performed-work flags, without replacing the
// transcript, its selectors, or the layout with render probes.
Reflect.set(globalThis, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
  supportsFiber: true,
  inject: () => 1,
  onCommitFiberRoot: (_id: number, root: { current: Fiber }) =>
    countRenderedFibers(root.current),
  onCommitFiberUnmount: () => {},
});
await import('ink-testing-library');
const ink = await import('../../../test-utils/real-ink.js');
void vi.mock('ink', () => ink);
// Unrelated service-heavy leaves are not part of transcript isolation.
void vi.mock('../components/Composer.js', () => ({ Composer: () => null }));
void vi.mock('../components/DialogManager.js', () => ({
  DialogManager: () => null,
}));
void vi.mock('../components/BucketAuthConfirmation.js', () => ({
  BucketAuthConfirmation: () => null,
}));
void vi.mock('../components/Footer.js', () => ({ Footer: () => null }));
void vi.mock('../components/AppHeader.js', () => ({ AppHeader: () => null }));
void vi.mock('../components/LoadingIndicator.js', () => ({
  LoadingIndicator: () => null,
}));
const runtime = await import('@vybestack/llxprt-code-providers/runtime.js');
void vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
  ...runtime,
  getCliRuntimeContext: () => ({ messageBus: undefined }),
}));
const { renderWithProviders, createMockSettings } = await import(
  '../../test-utils/render.js'
);
const { DefaultAppLayout } = await import('./DefaultAppLayout.js');
const { buildSlashCommandRuntime, buildUiRuntimeFromSource } = await import(
  '../cliUiRuntime.js'
);
const { Config, MessageBus, MessageBusType, PolicyEngine } = await import(
  '@vybestack/llxprt-code-core'
);
const { TerminalProvider } = await import(
  '../stores/terminal/TerminalContext.js'
);
const { TurnProvider } = await import('../stores/turn/TurnContext.js');
const { DialogProvider } = await import('../stores/dialog/DialogContext.js');
const { createTerminalStore } = await import(
  '../stores/terminal/terminalStore.js'
);
const { createTurnStore } = await import('../stores/turn/turnStore.js');
const { createDialogStore } = await import('../stores/dialog/dialogStore.js');

function mountLayout(runtimeMessageBus?: InstanceType<typeof MessageBus>) {
  const terminal = createTerminalStore();
  const turn = createTurnStore({
    history: [{ id: 1, type: 'user', text: 'committed transcript' }],
  });
  const dialog = createDialogStore();
  const settings = createMockSettings({
    ui: {
      useAlternateBuffer: false,
      hideContextSummary: true,
      showTodoPanel: false,
    },
  });
  const config = new Config({
    sessionId: 'isolation-2536',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'test-model',
  });
  const layout = (
    <DefaultAppLayout
      runtimeMessageBus={runtimeMessageBus}
      uiRuntime={buildUiRuntimeFromSource(config)}
      slashCommandRuntime={buildSlashCommandRuntime(config)}
      settings={settings}
      startupWarnings={[]}
      version="test"
      nightly={false}
      mainControlsRef={{ current: null }}
      rootUiRef={{ current: null }}
      pendingHistoryItemRef={{ current: null }}
      contextFileNames={[]}
      updateInfo={null}
    />
  );
  let invalidateParent = () => {};
  function Parent() {
    const [, setRevision] = useState(0);
    invalidateParent = () => setRevision((n) => n + 1);
    return cloneElement(layout);
  }
  const view = renderWithProviders(
    <TerminalProvider store={terminal}>
      <TurnProvider store={turn}>
        <DialogProvider store={dialog}>
          <Parent />
        </DialogProvider>
      </TurnProvider>
    </TerminalProvider>,
    { settings },
  );
  return { terminal, turn, dialog, view, invalidateParent };
}

describe('production layout render isolation', () => {
  it('keeps the transcript and static parent idle on dialog, clock, and geometry updates', async () => {
    renders.clear();
    setEnv('DEV', 'true');
    const { terminal, turn, dialog, view, invalidateParent } = mountLayout();
    try {
      expect(view.lastFrame()).toContain('committed transcript');
      const initial = renders.get('DefaultAppLayout') ?? 0;
      const transcript = renders.get('TranscriptRegion') ?? 0;
      const viewport = renders.get('TranscriptViewport') ?? 0;
      expect(initial).toBeGreaterThan(0);
      expect(transcript).toBeGreaterThan(0);
      expect(viewport).toBeGreaterThan(0);
      await act(async () => {
        dialog.commands.openDialog({ kind: 'settings', payload: {} });
      });
      expect(renders.get('DefaultAppLayout')).toBe(initial);
      expect(renders.get('TranscriptRegion')).toBe(transcript);
      expect(renders.get('TranscriptViewport')).toBe(viewport);
      await act(async () => {
        dialog.commands.closeDialog('settings');
      });
      const composer = renders.get('ComposerContent') ?? 0;
      await act(async () => {
        turn.commands.setElapsedTime(1);
      });
      expect(renders.get('ComposerContent')).toBeGreaterThan(composer);
      expect(renders.get('DefaultAppLayout')).toBe(initial);
      expect(renders.get('TranscriptRegion')).toBe(transcript);
      expect(renders.get('TranscriptViewport')).toBe(viewport);
      await act(async () => {
        terminal.commands.setDimensions({
          terminalWidth: 100,
          terminalHeight: 30,
          inputWidth: 84,
          suggestionsWidth: 80,
        });
      });
      expect(renders.get('DefaultAppLayout')).toBe(initial);
      expect(renders.get('TranscriptRegion')).toBe(transcript);
      expect(renders.get('TranscriptViewport')).toBeGreaterThan(viewport);
      await act(async () => {
        invalidateParent();
      });
      expect(renders.get('DefaultAppLayout')).toBeGreaterThan(initial);
      expect(renders.get('TranscriptRegion')).toBe(transcript);
      await act(async () => {
        turn.commands.addItem({ type: 'user', text: 'next committed item' });
      });
      expect(renders.get('TranscriptRegion')).toBeGreaterThan(transcript);
    } finally {
      view.unmount();
      restoreEnv();
    }
  });
});

describe('store migration regressions', () => {
  it('renders runtime hook activity and clears it after completion', async () => {
    const bus = new MessageBus(new PolicyEngine(), false);
    const { view } = mountLayout(bus);
    try {
      await act(async () => {
        bus.publish({
          type: MessageBusType.HOOK_EXECUTION_REQUEST,
          payload: { eventName: 'BeforeTool', correlationId: 'layout-hook' },
        });
      });
      expect(view.lastFrame()).toContain('Executing Hook');
      await act(async () => {
        bus.publish({
          type: MessageBusType.HOOK_EXECUTION_RESPONSE,
          payload: { correlationId: 'layout-hook', success: true },
        });
      });
      expect(view.lastFrame()).not.toContain('Executing Hook');
    } finally {
      view.unmount();
    }
  });
});
